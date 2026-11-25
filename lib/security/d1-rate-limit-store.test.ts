import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createD1RateLimitStore } from "./d1-rate-limit-store";

type Value = string | number;
class Statement {
  values: Value[] = [];
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...values: Value[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async run() {
    return this.db.prepare(this.sql).run(...this.values);
  }
}
let db: DatabaseSync;
afterEach(() => db?.close());

describe("D1 rate limits", () => {
  it("enforces and resets a fixed window without storing the original identity", async () => {
    db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../drizzle-d1/0000_friendly_bullseye.sql", import.meta.url), "utf8"));
    let clock = 10_000;
    const store = createD1RateLimitStore({
      database: { prepare: (sql) => new Statement(db, sql) },
      secret: "test-secret",
      now: () => clock,
    });
    const rule = { window: 60, max: 2 };
    expect(await store.consume("private-account", rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await store.consume("private-account", rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await store.consume("private-account", rule)).toEqual({ allowed: false, retryAfter: 60 });
    const row = db.prepare("SELECT key, count FROM runo_rate_limits").get() as { key: string; count: number };
    expect(row.key).toMatch(/^[a-f0-9]{64}$/);
    expect(row.key).not.toContain("private-account");
    expect(row.count).toBe(3);
    clock += 60_000;
    expect(await store.consume("private-account", rule)).toEqual({ allowed: true, retryAfter: null });
  });
});
