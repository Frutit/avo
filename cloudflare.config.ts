import { bindings, defineConfig, defineWorker } from "cf/config";

// Resource identifiers are fixed so deployment always binds the restored database.
export const avoDatabase = { name: "avo", id: "db217b04-dce1-42f5-a2aa-8679b9c06998" };

export default defineConfig(({ mode, isPreview }) => {
  if (isPreview) throw new Error("Avo previews need a separate database before they can be enabled.");

  const local = mode === "development" || mode === "test";
  const attachDomain = mode === "production" && process.env.AVO_ENABLE_CUSTOM_DOMAIN === "true";

  return {
    accountId: "cb126d52852b6c1d131f26f3b83fef3b",
    worker: defineWorker({
      name: "avo",
      entrypoint: "./workers/app.ts",
      compatibilityDate: "2026-11-24",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: false,
      previewUrls: false,
      ...(attachDomain ? { domains: ["avo.frutit.app"] } : {}),
      assets: { runWorkerFirst: ["/api/*", "/robots.txt", "/sitemap.xml"] },
      env: {
        DB: bindings.d1(avoDatabase),
        ASSETS: bindings.assets(),
        BETTER_AUTH_URL: local ? bindings.secret() : bindings.text("https://avo.frutit.app"),
        BETTER_AUTH_SECRET: (local || attachDomain) && bindings.secret(),
        AVO_HMAC_SECRET: (local || attachDomain) && bindings.secret(),
        ...(local
          ? {
              GOOGLE_CLIENT_ID: bindings.secret(),
              GOOGLE_CLIENT_SECRET: bindings.secret(),
              FACEBOOK_CLIENT_ID: bindings.secret(),
              FACEBOOK_CLIENT_SECRET: bindings.secret(),
              AVO_LOCAL_TEST_AUTH: bindings.secret(),
            }
          : {}),
      },
    }),
  };
});
