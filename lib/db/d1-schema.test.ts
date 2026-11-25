import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle-d1/0000_friendly_bullseye.sql", import.meta.url),
  "utf8",
);
let db: DatabaseSync;

function createDatabase() {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration);
  db.exec(`
    INSERT INTO runo_auth_users (id, name, email, email_verified, created_at, updated_at)
      VALUES ('auth-a', 'A', 'A@example.test', 0, 1, 1);
    INSERT INTO runo_users (id, auth_user_id, created_at) VALUES ('account:a', 'auth-a', 1);
    INSERT INTO runo_users (id, auth_user_id, created_at) VALUES ('owner', NULL, 1);
  `);
  return db;
}

afterEach(() => db?.close());

describe("D1 account schema", () => {
  it("keeps the legacy owner separate and enforces ownership and durable-value constraints", () => {
    const database = createDatabase();
    expect(database.prepare("SELECT auth_user_id FROM runo_users WHERE id = ?").get("owner")).toEqual({
      auth_user_id: null,
    });
    expect(() =>
      database.exec(`
      INSERT INTO runo_pendings (id, user_id, title, duration_min, revision, created_at, updated_at)
      VALUES ('p', 'missing', 'Pending', 5, 1, 1, 1)
    `),
    ).toThrow();
    expect(() =>
      database.exec(`
      INSERT INTO runo_pendings (id, user_id, title, duration_min, revision, created_at, updated_at)
      VALUES ('p', 'account:a', 'Pending', 0, 1, 1, 1)
    `),
    ).toThrow();
  });

  it("rejects case and whitespace variants of an existing ASCII email", () => {
    const database = createDatabase();
    expect(() =>
      database.exec(`
      INSERT INTO runo_auth_users (id, name, email, email_verified, created_at, updated_at)
      VALUES ('auth-b', 'B', ' a@example.test ', 0, 1, 1)
    `),
    ).toThrow();
  });

  it("enforces composite ownership keys and preserves timestamp milliseconds", () => {
    const database = createDatabase();
    database.exec(`
      INSERT INTO runo_pendings (id, user_id, title, duration_min, revision, created_at, updated_at)
      VALUES ('p', 'account:a', 'Pending', 5, 1, 1700000000123, 1700000000123)
    `);
    expect(database.prepare("SELECT created_at FROM runo_pendings WHERE id = ?").get("p")).toEqual({
      created_at: 1700000000123,
    });
    expect(() =>
      database.exec(`
      INSERT INTO runo_pendings (id, user_id, title, duration_min, revision, created_at, updated_at)
      VALUES ('p', 'account:a', 'Duplicate', 5, 1, 1, 1)
    `),
    ).toThrow();
  });
});
