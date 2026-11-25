import { spawnSync } from "node:child_process";
import { avoDatabase } from "../cloudflare.config.ts";

const result = spawnSync(
  "cf",
  ["d1", "migrations", "apply", avoDatabase.id, "--dir", "drizzle-d1", "--local"],
  { stdio: "inherit" },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
