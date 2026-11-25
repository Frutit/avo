import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import { authAdapterSchema } from "@/lib/db/d1-schema";
import { d1RateLimitStore } from "@/lib/security/d1-rate-limit-store";

export interface D1AuthConfig {
  database: AnyD1Database;
  secret: string;
  origin: string;
  enableEmailAndPassword?: boolean;
  google?: { clientId: string; clientSecret: string };
  facebook?: { clientId: string; clientSecret: string };
}

/** Build auth from request-scoped Worker bindings and secrets. */
export function createD1Auth(config: D1AuthConfig) {
  const { database, origin, secret } = config;
  if (secret.length < 32) throw new Error("Authentication secret is too short");
  const parsed = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.origin !== origin ||
    (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:"))
  ) {
    throw new Error("Invalid authentication origin");
  }
  const limiter = d1RateLimitStore(database, secret);
  const discardedTokens = () => ({
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
  });
  return betterAuth({
    baseURL: origin,
    secret,
    database: drizzleAdapter(drizzle(database), {
      provider: "sqlite",
      schema: authAdapterSchema,
      transaction: false,
    }),
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"], ipv6Subnet: 64 } },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      customRules: { "/sign-in/*": { window: 900, max: 10 }, "/callback/*": { window: 900, max: 20 } },
      customStorage: {
        consume: (key, rule) => {
          const ip = key.slice(0, key.indexOf("|"));
          return limiter.consume(`auth:${rule.window}:${rule.max}:${ip}`, rule);
        },
      },
    },
    account: {
      storeAccountCookie: false,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        trustedProviders: ["facebook"],
        updateUserInfoOnLink: false,
      },
    },
    emailAndPassword: { enabled: config.enableEmailAndPassword ?? false },
    socialProviders: {
      ...(config.google ? { google: config.google } : {}),
      ...(config.facebook ? { facebook: config.facebook } : {}),
    },
    databaseHooks: {
      account: {
        create: { before: async () => ({ data: discardedTokens() }) },
        update: { before: async () => ({ data: discardedTokens() }) },
      },
      user: {
        create: {
          before: async (user) =>
            user.email && !user.emailVerified ? { data: { emailVerified: true } } : undefined,
          after: async (user) => {
            await database
              .prepare(
                "INSERT INTO runo_users (id, auth_user_id, time_zone, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
              )
              .bind(user.id, user.id, "America/Mexico_City", Date.now())
              .run();
          },
        },
      },
    },
    onAPIError: {
      onError: async () => {
        console.error("Authentication unavailable");
      },
    },
  });
}
