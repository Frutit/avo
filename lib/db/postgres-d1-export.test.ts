import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { importD1Rows, reconcileD1Counts } from "./d1-import";
import { exportPostgresSnapshot } from "./postgres-d1-export";

type Value = string | number | null;
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
  run() {
    this.db.prepare(this.sql).run(...this.values);
  }
  async first() {
    return (this.db.prepare(this.sql).get() as { count: number } | undefined) ?? null;
  }
}
class Destination {
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      for (const statement of statements) statement.run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
let pg: PGlite;
let sqlite: DatabaseSync;
afterEach(async () => {
  await pg?.close();
  sqlite?.close();
});

describe("PostgreSQL to D1 export", () => {
  it("imports and retries a consistent snapshot without OAuth tokens or unrelated metadata", async () => {
    pg = new PGlite();
    await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
    await pg.exec(`
      INSERT INTO runo_auth_users (id,name,email,email_verified) VALUES ('a','A','a@example.test',true),('b','B','b@example.test',true);
      INSERT INTO runo_auth_accounts (id,account_id,provider_id,user_id,access_token) VALUES ('aa','provider-a','google','a','discard-me');
      INSERT INTO runo_users (id,auth_user_id) VALUES ('account:a','a'),('account:b','b');
      INSERT INTO runo_settings (user_id,locale,task_order) VALUES ('account:a','en','{"t1":1}');
      INSERT INTO runo_tasks (id,user_id,title,category,duration_min,priority,days) VALUES ('t1','account:a','First task','other',5,1,ARRAY[1,2]),('t2','account:a','Second task','other',5,1,ARRAY[1,2]);
      INSERT INTO runo_routines (id,user_id,title,task_ids) VALUES ('routine','account:a','Routine',ARRAY['t2','t1']);
      INSERT INTO runo_pendings (id,user_id,title,duration_min,completed_at) VALUES ('p','account:a','First',5,'2026-01-01T00:00:00.123Z'),('p','account:b','Second',10,NULL);
      INSERT INTO runo_metadata (user_id,key,value) VALUES ('account:a','sync:v2:op','{"hash":"h","result":{}}'),('account:a','unrelated','{}');
    `);
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(
      readFileSync(new URL("../../drizzle-d1/0000_friendly_bullseye.sql", import.meta.url), "utf8"),
    );
    const target = new Destination(sqlite);
    const client = {
      query: async (sql: string, params?: (string | number)[]) => ({
        rows: (await pg.query(sql, params)).rows as Record<string, unknown>[],
      }),
    };
    const run = () => exportPostgresSnapshot(client, (table, rows) => importD1Rows(target, table, rows));
    const counts = await run();
    expect(counts.runo_pendings).toBe(2);
    expect(counts.runo_metadata).toBe(1);
    expect(counts.runo_tasks).toBe(2);
    expect(sqlite.prepare("SELECT days FROM runo_tasks WHERE id = ?").get("t1")).toEqual({ days: "[1,2]" });
    expect(sqlite.prepare("SELECT task_ids FROM runo_routines WHERE id = ?").get("routine")).toEqual({
      task_ids: '["t2","t1"]',
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM runo_pendings").get()).toEqual({ count: 2 });
    expect(
      sqlite.prepare("SELECT completed_at FROM runo_pendings WHERE user_id = ?").get("account:a"),
    ).toEqual({ completed_at: 1767225600123 });
    expect(sqlite.prepare("SELECT access_token FROM runo_auth_accounts WHERE id = ?").get("aa")).toEqual({
      access_token: null,
    });
    expect(await run()).toEqual(counts);
    await reconcileD1Counts(target, counts);
    sqlite.exec("INSERT INTO runo_users(id, created_at) VALUES ('unexpected', 1)");
    await expect(reconcileD1Counts(target, counts)).rejects.toThrow("Import count mismatch: runo_users");
  });
});
