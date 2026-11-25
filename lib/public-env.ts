import { z } from "zod";

/**
 * Values intentionally included in the browser bundle. Never add a secret.
 */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalOrigin = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url({ protocol: /^https?$/ }).optional(),
);

export const publicEnv = z
  .object({
    VITE_SITE_URL: optionalOrigin,
    VITE_PRIVACY_CONTROLLER_NAME: optionalText,
    VITE_PRIVACY_CONTROLLER_ADDRESS: optionalText,
  })
  .parse({
    VITE_SITE_URL: import.meta.env.VITE_SITE_URL,
    VITE_PRIVACY_CONTROLLER_NAME: import.meta.env.VITE_PRIVACY_CONTROLLER_NAME,
    VITE_PRIVACY_CONTROLLER_ADDRESS: import.meta.env.VITE_PRIVACY_CONTROLLER_ADDRESS,
  });
