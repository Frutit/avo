/// <reference types="@cloudflare/workers-types" />
import { createD1Auth } from "@/lib/auth-d1";
import { d1RateLimitStore } from "@/lib/security/d1-rate-limit-store";
import { MAX_BATCH, MAX_BODY_BYTES, ProtocolError, validMutation, object } from "./protocol";
import { d1PrivateHeaders, mutateD1Account, readD1Account } from "./d1-repository";
import type { Mutation } from "./protocol";

export interface AccountD1Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FACEBOOK_CLIENT_ID?: string;
  FACEBOOK_CLIENT_SECRET?: string;
  AVO_HMAC_SECRET: string;
  AVO_LOCAL_TEST_AUTH?: string;
}

function authFor(env: AccountD1Env) {
  return createD1Auth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    origin: env.BETTER_AUTH_URL,
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET
      ? { facebook: { clientId: env.FACEBOOK_CLIENT_ID, clientSecret: env.FACEBOOK_CLIENT_SECRET } }
      : {}),
    ...(env.AVO_LOCAL_TEST_AUTH === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.BETTER_AUTH_URL).hostname)
      ? { enableEmailAndPassword: true }
      : {}),
  });
}
function responseError(status: number, code: string, headers: Record<string, string> = {}) {
  return Response.json({ error: code }, { status, headers: { ...d1PrivateHeaders, ...headers } });
}
async function session(request: Request, env: AccountD1Env, intent: "probe" | "read" | "write") {
  const limiter = d1RateLimitStore(env.DB, env.AVO_HMAC_SECRET);
  const ip = request.headers.get("cf-connecting-ip") ?? "no-trusted-ip";
  const ipResult = await limiter.consume(`account:ip:${ip}`, { window: 60, max: 240 });
  if (!ipResult.allowed)
    throw Object.assign(new Error("rate_limited"), { status: 429, retryAfter: ipResult.retryAfter });
  const found = await authFor(env).api.getSession({ headers: request.headers });
  if (!found) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const limit = { probe: 120, read: 60, write: 30 }[intent];
  const result = await limiter.consume(`account:${intent}:${found.user.id}`, { window: 60, max: limit });
  if (!result.allowed)
    throw Object.assign(new Error("rate_limited"), { status: 429, retryAfter: result.retryAfter });
  return found;
}
async function failure(error: unknown) {
  const e = error as { status?: number; message?: string; retryAfter?: number };
  if (e.status === 429)
    return responseError(429, "rate_limited", { "Retry-After": String(e.retryAfter ?? 60) });
  if (e.status === 401) return responseError(401, "unauthorized");
  if (error instanceof ProtocolError) return responseError(400, error.message);
  return responseError(503, "temporarily_unavailable");
}
export async function handleD1Auth(request: Request, env: AccountD1Env) {
  try {
    return await authFor(env).handler(request);
  } catch {
    return responseError(503, "temporarily_unavailable");
  }
}
export async function handleD1AccountMe(request: Request, env: AccountD1Env) {
  try {
    const found = await session(request, env, "probe");
    return Response.json(
      {
        user: {
          id: found.user.id,
          name: found.user.name,
          email: found.user.email,
          image: found.user.image ?? null,
        },
      },
      { headers: d1PrivateHeaders },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function handleD1AccountData(request: Request, env: AccountD1Env) {
  try {
    if (request.method !== "GET" && request.method !== "POST")
      return responseError(405, "method_not_allowed", { Allow: "GET, POST" });
    const write = request.method === "POST";
    if (
      write &&
      (![env.BETTER_AUTH_URL].includes(request.headers.get("origin") ?? "") ||
        request.headers.get("sec-fetch-site") === "cross-site")
    )
      return responseError(403, "invalid_origin");
    const found = await session(request, env, write ? "write" : "read");
    const expected = request.headers.get("x-avo-account");
    if (expected !== found.user.id) return responseError(409, "account_changed");
    const rawVersion = request.headers.get("x-avo-sync-version");
    const version =
      rawVersion === null || rawVersion === "1"
        ? 1
        : rawVersion === "2"
          ? 2
          : (() => {
              throw new ProtocolError("invalid_version");
            })();
    if (!write) {
      const data = await readD1Account(
        env.DB,
        found.user.id,
        version,
        request.headers.get("if-none-match") ?? undefined,
      );
      const headers = { ...d1PrivateHeaders, ETag: data.etag };
      if (data.notModified) return new Response(null, { status: 304, headers });
      return Response.json(data, { headers });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return responseError(415, "json_required");
    const reader = request.body?.getReader();
    if (!reader) throw new ProtocolError("missing_body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return responseError(413, "body_too_large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ProtocolError("invalid_json");
    }
    const body = object(parsed);
    if (
      Object.keys(body).some((k) => !["version", "mutations"].includes(k)) ||
      body.version !== version ||
      !Array.isArray(body.mutations) ||
      body.mutations.length < 1 ||
      body.mutations.length > MAX_BATCH
    )
      throw new ProtocolError("invalid_batch");
    const mutations = body.mutations.map((m) => validMutation(m, version));
    if (new Set(mutations.map((m) => m.operationId)).size !== mutations.length)
      throw new ProtocolError("duplicate_mutation");
    const results = await mutateD1Account(env.DB, found.user.id, mutations as Mutation[], version);
    return Response.json({ version, accountId: found.user.id, results }, { headers: d1PrivateHeaders });
  } catch (error) {
    return failure(error);
  }
}
