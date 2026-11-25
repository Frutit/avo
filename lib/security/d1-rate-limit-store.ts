import { createHmac } from "node:crypto";
type RateLimitRule = { window: number; max: number };
type RateLimitDecision = { allowed: boolean; retryAfter: number | null };

type Value = string | number;
interface Statement {
  bind(...values: Value[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface Database {
  prepare(sql: string): Statement;
}

/** Atomic fixed-window counters scoped to a D1 binding. */
export function createD1RateLimitStore({
  database,
  secret,
  now = Date.now,
}: {
  database: Database;
  secret: string;
  now?: () => number;
}): { consume: (key: string, rule: RateLimitRule) => Promise<RateLimitDecision> } {
  let nextCleanup = 0;
  return {
    async consume(key, rule) {
      if (
        !Number.isSafeInteger(rule.window) ||
        rule.window < 1 ||
        rule.window > 900 ||
        !Number.isSafeInteger(rule.max) ||
        rule.max < 1 ||
        rule.max > 10_000
      )
        throw new Error("Invalid rate limit rule");
      const timestamp = now();
      const expiresAt = timestamp + rule.window * 1000;
      const digest = createHmac("sha256", secret).update(`avo-rate-limit:v1\0${key}`).digest("hex");
      const row = await database
        .prepare(
          `
        INSERT INTO runo_rate_limits (key, count, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN expires_at <= ? THEN 1 ELSE MIN(count + 1, ?) END,
          expires_at = CASE WHEN expires_at <= ? THEN ? ELSE expires_at END
        RETURNING count, expires_at
      `,
        )
        .bind(digest, expiresAt, timestamp, rule.max + 1, timestamp, expiresAt)
        .first<{ count: number; expires_at: number }>();
      if (!row) throw new Error("Rate limit store unavailable");
      if (timestamp >= nextCleanup) {
        await database.prepare("DELETE FROM runo_rate_limits WHERE expires_at <= ?").bind(timestamp).run();
        nextCleanup = timestamp + 60_000;
      }
      return row.count <= rule.max
        ? { allowed: true, retryAfter: null }
        : { allowed: false, retryAfter: Math.max(1, Math.ceil((row.expires_at - timestamp) / 1000)) };
    },
  };
}

const stores = new WeakMap<object, { secret: string; store: ReturnType<typeof createD1RateLimitStore> }>();

/** Reuse one cleanup clock per Worker binding between request-scoped handlers. */
export function d1RateLimitStore(database: object & Database, secret: string) {
  const cached = stores.get(database);
  if (cached?.secret === secret) return cached.store;
  const store = createD1RateLimitStore({ database, secret });
  stores.set(database, { secret, store });
  return store;
}
