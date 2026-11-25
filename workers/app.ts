import { createRequestHandler, RouterContextProvider } from "react-router";
import { environmentContext } from "../app/context";
import type { AccountD1Env } from "@/lib/sync/d1-routes";
import { reportOnlyCsp } from "@/lib/config/security";
const handler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);
export default {
  async fetch(request, env) {
    const context = new RouterContextProvider();
    context.set(environmentContext, env as unknown as AccountD1Env);
    const response = await handler(request, context);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp(false));
    if (new URL(request.url).protocol === "https:") {
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
} satisfies ExportedHandler<Env>;
