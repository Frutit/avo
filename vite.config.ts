import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";

const buildServiceWorker: Plugin = {
  name: "avo-service-worker",
  apply: "build",
  applyToEnvironment: (environment) => environment.name === "client",
  writeBundle: {
    order: "post",
    handler({ dir }) {
      if (!dir) throw new Error("The client output directory is required for the service worker.");
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("./scripts/create-service-worker.mjs", import.meta.url)), dir],
        { stdio: "inherit" },
      );
    },
  },
};

export default defineConfig(({ command, mode }) => {
  const siteUrl = loadEnv(mode, process.cwd(), "VITE_").VITE_SITE_URL;
  return {
    plugins: [
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tailwindcss(),
      reactRouter(),
      buildServiceWorker,
    ],
    ...(command === "build" && mode === "production" && !siteUrl
      ? { define: { "import.meta.env.VITE_SITE_URL": JSON.stringify("https://avo.frutit.app") } }
      : {}),
    resolve: {
      alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
      tsconfigPaths: true,
    },
  };
});
