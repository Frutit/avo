import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { d1ImportTableOrder, importD1Rows } from "./d1-import";

type Value = string | number | null;
class LocalStatement {
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
}
class LocalDatabase {
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new LocalStatement(this.db, sql);
  }
  async batch(statements: LocalStatement[]) {
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
let database: DatabaseSync;
const now = new Date("2026-01-01T00:00:00.123Z");
const user = {
  id: "auth-a",
  name: "A",
  email: "a@example.test",
  email_verified: true,
  image: null,
  created_at: now,
  updated_at: now,
};
const owner = { id: "account:a", auth_user_id: "auth-a", time_zone: "America/Mexico_City", created_at: now };
const pending = {
  id: "p",
  user_id: "account:a",
  title: "Pending",
  duration_min: 5,
  completed_at: null,
  deleted_at: null,
  revision: 1,
  created_at: now,
  updated_at: now,
};

function createDatabase() {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(
    readFileSync(new URL("../../drizzle-d1/0000_friendly_bullseye.sql", import.meta.url), "utf8"),
  );
  return new LocalDatabase(database);
}
afterEach(() => database?.close());

describe("D1 import batches", () => {
  it("can resume without duplicating an identical import and retains milliseconds", async () => {
    const db = createDatabase();
    expect(d1ImportTableOrder.indexOf("runo_auth_users")).toBeLessThan(
      d1ImportTableOrder.indexOf("runo_users"),
    );
    await importD1Rows(db, "runo_auth_users", [user]);
    await importD1Rows(db, "runo_users", [owner]);
    await importD1Rows(db, "runo_pendings", [pending]);
    await importD1Rows(db, "runo_pendings", [pending]);
    expect(
      database.prepare("SELECT COUNT(*) AS count, MIN(created_at) AS created FROM runo_pendings").get(),
    ).toEqual({ count: 1, created: now.getTime() });
  });
  it("rolls back the entire batch when a conflicting row differs", async () => {
    const db = createDatabase();
    await importD1Rows(db, "runo_auth_users", [user]);
    await importD1Rows(db, "runo_users", [owner]);
    await importD1Rows(db, "runo_pendings", [pending]);
    await expect(
      importD1Rows(db, "runo_pendings", [
        { ...pending, id: "new" },
        { ...pending, title: "Different" },
      ]),
    ).rejects.toThrow();
    expect(database.prepare("SELECT COUNT(*) AS count FROM runo_pendings").get()).toEqual({ count: 1 });
  });
  it("rejects a linked historical owner and metadata outside sync receipts", async () => {
    const db = createDatabase();
    await expect(importD1Rows(db, "runo_users", [{ ...owner, id: "owner" }])).rejects.toThrow("Legacy owner");
    await expect(
      importD1Rows(db, "runo_metadata", [{ user_id: "account:a", key: "other", value: {}, updated_at: now }]),
    ).rejects.toThrow("Only sync receipts");
  });
});
