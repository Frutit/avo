import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const [accountId, databaseId] = process.argv.slice(2);
if (
  !/^[a-f0-9]{32}$/i.test(accountId ?? "") ||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId ?? "") ||
  databaseId === "00000000-0000-0000-0000-000000000000"
) {
  console.error("Usage: node scripts/prepare-cloudflare-production.mjs <account-id> <d1-id>");
  process.exit(1);
}

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const { config, error } = ts.parseConfigFileTextToJson("wrangler.jsonc", source);
if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
config.name = "avo";
config.account_id = accountId;
config.d1_databases[0].database_id = databaseId;
config.workers_dev = false;
config.preview_urls = false;
config.routes = [{ pattern: "avo.frutit.app", custom_domain: true }];
config.vars = { BETTER_AUTH_URL: "https://avo.frutit.app" };
config.secrets = { required: ["BETTER_AUTH_SECRET", "AVO_HMAC_SECRET"] };
writeFileSync(
  new URL("../wrangler.production.jsonc", import.meta.url),
  JSON.stringify(config, null, 2) + "\n",
  {
    flag: "wx",
    mode: 0o600,
  },
);
console.log("Created wrangler.production.jsonc for Avo.");
