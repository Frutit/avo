import { publicEnv } from "@/lib/public-env";

/** Canonical public origin. It stays unset in local development by default. */
export const siteUrl = (publicEnv.VITE_SITE_URL ?? "http://localhost:5173").replace(/\/$/, "");

export const siteName = "Avo";
