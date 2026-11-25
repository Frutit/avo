import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Mutation } from "./protocol";
import { mutateD1Account, readD1Account } from "./d1-repository";

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
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async run() {
    return this.db.prepare(this.sql).run(...this.values);
  }
}
class LocalD1 {
  batchCalls = 0;
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    this.batchCalls += 1;
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) {
        const statement = this.db.prepare(s.sql);
        if (/^\s*select\b/i.test(s.sql)) {
          results.push({ changes: 0, results: statement.all(...s.values) });
        } else {
          results.push({ ...statement.run(...s.values), results: [] });
        }
      }
      this.db.exec("COMMIT");
      return results.map((r) => ({ meta: { changes: Number(r.changes) }, results: r.results }));
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
let raw: DatabaseSync;
function setup() {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  raw.exec(readFileSync(new URL("../../drizzle-d1/0000_friendly_bullseye.sql", import.meta.url), "utf8"));
  raw.exec(
    "INSERT INTO runo_auth_users(id,name,email,email_verified,created_at,updated_at) VALUES('auth','A','a@example.test',1,1,1); INSERT INTO runo_users(id,auth_user_id,created_at) VALUES('account:auth','auth',1)",
  );
  return new LocalD1(raw);
}
afterEach(() => raw?.close());
const mutation = (operationId: string, baseRevision: number, title: string, id = "p"): Mutation => ({
  operationId,
  kind: "pending",
  id,
  baseRevision,
  value: {
    id,
    title,
    durationMin: 5,
    createdAt: 100,
    updatedAt: 200,
    completedAt: null,
    deletedAt: null,
  },
});

describe("D1 account repository", () => {
  it("applies atomically, replays the same receipt, and rejects operation reuse", async () => {
    const db = setup();
    const first = await mutateD1Account(db, "auth", [mutation("op", 0, "One")], 1);
    expect(first[0].status).toBe("applied");
    expect((await mutateD1Account(db, "auth", [mutation("op", 0, "One")], 1))[0]).toEqual(first[0]);
    await expect(mutateD1Account(db, "auth", [mutation("op", 0, "Other")], 1)).rejects.toThrow(
      "operation_reused",
    );
    expect(raw.prepare("SELECT COUNT(*) n FROM runo_pendings").get()).toEqual({ n: 1 });
  });
  it("returns a revision conflict without recording a successful receipt", async () => {
    const db = setup();
    await mutateD1Account(db, "auth", [mutation("first", 0, "One")], 1);
    const result = await mutateD1Account(db, "auth", [mutation("stale", 0, "Two")], 1);
    expect(result[0].status).toBe("conflict");
    expect(raw.prepare("SELECT COUNT(*) n FROM runo_metadata WHERE key='sync:v1:stale'").get()).toEqual({
      n: 0,
    });
  });
  it("applies the maximum 40 mutations in one D1 batch", async () => {
    const db = setup();
    const changes = Array.from({ length: 40 }, (_, index) =>
      mutation(`op-${index}`, 0, `Pending ${index}`, `p-${index}`),
    );
    const results = await mutateD1Account(db, "auth", changes, 1);
    expect(results).toHaveLength(40);
    expect(results.every((result) => result.status === "applied")).toBe(true);
    expect(db.batchCalls).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM runo_pendings").get()).toEqual({ count: 40 });
  });
  it("builds a private snapshot and stable ETag", async () => {
    const db = setup();
    await mutateD1Account(db, "auth", [mutation("first", 0, "One")], 1);
    const snapshot = await readD1Account(db, "auth", 1);
    expect(snapshot.records).toHaveLength(1);
    expect(await readD1Account(db, "auth", 1, snapshot.etag)).toMatchObject({
      records: [],
      notModified: true,
      etag: snapshot.etag,
    });
  });
  it("links a legacy same-id owner without reading the separate legacy owner row", async () => {
    const db = setup();
    raw.exec("DELETE FROM runo_users WHERE id='account:auth'");
    raw.exec("INSERT INTO runo_users(id,auth_user_id,created_at) VALUES('auth',NULL,2)");
    raw.exec("INSERT INTO runo_users(id,auth_user_id,created_at) VALUES('legacy-anon',NULL,2)");
    raw.exec(
      "INSERT INTO runo_pendings(id,user_id,title,duration_min,revision,created_at,updated_at) VALUES('legacy-p','legacy-anon','Legacy',5,1,1,1)",
    );
    raw.exec(
      "INSERT INTO runo_pendings(id,user_id,title,duration_min,revision,created_at,updated_at) VALUES('auth-p','auth','Auth',5,1,1,1)",
    );
    const snapshot = await readD1Account(db, "auth", 1);
    expect(snapshot.records.map((record) => record.id)).toContain("auth-p");
    expect(snapshot.records.map((record) => record.id)).not.toContain("legacy-p");
    expect(raw.prepare("SELECT auth_user_id FROM runo_users WHERE id='auth'").get()).toEqual({
      auth_user_id: "auth",
    });
    expect(raw.prepare("SELECT auth_user_id FROM runo_users WHERE id='legacy-anon'").get()).toEqual({
      auth_user_id: null,
    });
  });
});
