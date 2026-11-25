import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { d1ImportColumns, d1ImportTableOrder, importD1Rows, reconcileD1Counts } from "../lib/db/d1-import.ts";
import { exportPostgresSnapshot } from "../lib/db/postgres-d1-export.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const dateColumns = ["created_at", "updated_at", "archived_at", "completed_at", "deleted_at"];
const queries = d1ImportTableOrder.map(
  (table) => `SELECT ${d1ImportColumns[table].join(", ")} FROM ${table}`,
);
const transient = ["runo_auth_sessions", "runo_auth_verifications", "runo_rate_limits"];
const checks = [
  "PRAGMA foreign_key_check",
  ...transient.map((table) => `SELECT COUNT(*) AS count FROM ${table}`),
];

function command(binary, args, description, stdin = "ignore") {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    stdio: [stdin, "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(description);
  return result.stdout;
}

function fingerprint(tables) {
  return Object.fromEntries(
    d1ImportTableOrder.map((table, index) => {
      const rows = tables[index].map((row) =>
        JSON.stringify(d1ImportColumns[table].map((column) => row[column])),
      );
      return [
        table,
        {
          count: rows.length,
          sha256: createHash("sha256").update(JSON.stringify(rows.sort())).digest("hex"),
        },
      ];
    }),
  );
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
  throw new Error("Unexpected SQLite value.");
}

function insertStatements(tables) {
  return d1ImportTableOrder.flatMap((table, index) => {
    const columns = d1ImportColumns[table];
    return tables[index].map(
      (row) =>
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`,
    );
  });
}

async function buildRecovery(dump) {
  const source = realpathSync(dump);
  const parent = dirname(source);
  if (
    spawnSync("git", ["-C", parent, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" }).status === 0
  ) {
    throw new Error("Store the PostgreSQL backup outside Git before generating private recovery files.");
  }
  const name = "avo-d1-recovery-" + randomUUID();
  const db = new DatabaseSync(":memory:");
  let psql;
  try {
    db.exec(readFileSync(join(root, "drizzle-d1", "0000_friendly_bullseye.sql"), "utf8"));
    command(
      "docker",
      [
        "run",
        "--pull=never",
        "--detach",
        "--rm",
        "--network",
        "none",
        "--name",
        name,
        "--tmpfs",
        "/var/lib/postgresql",
        "--env",
        "POSTGRES_PASSWORD=disposable-recovery",
        "--env",
        "POSTGRES_USER=avo_restore",
        "postgres:19",
      ],
      "Could not start isolated PostgreSQL 19. Check Docker and the postgres:19 image.",
    );
    for (let tries = 0; ; tries++) {
      if (
        spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1"], { stdio: "ignore" }).status === 0
      )
        break;
      if (tries === 39) throw new Error("Isolated PostgreSQL did not start.");
      await sleep(500);
    }
    const file = openSync(source, "r");
    try {
      command(
        "docker",
        [
          "exec",
          "-i",
          name,
          "pg_restore",
          "-U",
          "avo_restore",
          "-d",
          "avo_restore",
          "--no-owner",
          "--no-privileges",
          "--single-transaction",
        ],
        "PostgreSQL rejected the backup. Confirm the dump version and format.",
        file,
      );
    } finally {
      closeSync(file);
    }

    psql = spawn(
      "docker",
      [
        "exec",
        "-i",
        name,
        "psql",
        "-U",
        "avo_restore",
        "-d",
        "avo_restore",
        "-XqAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    psql.stdin.on("error", () => {});
    const lines = createInterface({ input: psql.stdout })[Symbol.asyncIterator]();
    const boundary = randomUUID();
    const client = {
      async query(sql, parameters = []) {
        const statement = sql.startsWith("SELECT ")
          ? `SELECT row_to_json(source)::text FROM (${sql.replace("$1", String(parameters[0]))}) source`
          : sql;
        psql.stdin.write(statement + ";\n\\echo " + boundary + "\n");
        const rows = [];
        for (;;) {
          const line = await lines.next();
          if (line.done) throw new Error("Could not read the restored PostgreSQL snapshot.");
          if (line.value === boundary) return { rows };
          const row = JSON.parse(line.value);
          for (const column of dateColumns) if (row[column] != null) row[column] = new Date(row[column]);
          rows.push(row);
        }
      },
    };
    const importer = {
      prepare: (sql) => ({
        bind:
          (...values) =>
          () =>
            db.prepare(sql).run(...values),
      }),
      async batch(statements) {
        db.exec("BEGIN");
        try {
          for (const statement of statements) statement();
          db.exec("COMMIT");
        } catch {
          db.exec("ROLLBACK");
          throw new Error("The PostgreSQL rows did not fit the D1 schema.");
        }
      },
    };
    const counts = await exportPostgresSnapshot(client, (table, rows) => importD1Rows(importer, table, rows));
    await reconcileD1Counts({ prepare: (sql) => ({ first: async () => db.prepare(sql).get() }) }, counts);
    if (db.prepare(checks[0]).all().length) throw new Error("Foreign key check failed.");

    const tables = queries.map((sql) => db.prepare(sql).all());
    const inserts = insertStatements(tables);
    if (inserts.some((sql) => Buffer.byteLength(sql) > 100_000))
      throw new Error("A row exceeds D1's SQL limit.");
    const folder = mkdtempSync(join(parent, "avo-d1-recovery-"));
    writeFileSync(join(folder, "restore.sql"), inserts.join("\n") + "\n", { mode: 0o600, flag: "wx" });
    writeFileSync(join(folder, "manifest.json"), JSON.stringify(fingerprint(tables), null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    console.log("Private recovery folder:", folder);
    console.log("Rows by table:", counts);
  } finally {
    psql?.stdin.end();
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
    db.close();
  }
}

function d1Batch(target, statements, location, persistTo) {
  const local = location === "--local";
  const folder = mkdtempSync(join(tmpdir(), "avo-d1-batch-"));
  try {
    const file = join(folder, "queries.json");
    writeFileSync(file, JSON.stringify(statements.map((sql) => ({ sql }))), { mode: 0o600 });
    const output = command(
      join(root, "node_modules", ".bin", "cf"),
      [
        "d1",
        local ? "raw" : "query",
        target,
        "--batch",
        "@" + file,
        ...(local ? ["--local"] : []),
        ...(persistTo ? ["--persist-to", persistTo] : []),
      ],
      "D1 command failed. Confirm the database ID, account and migrations before retrying.",
    );
    const results = JSON.parse(output);
    if (
      !Array.isArray(results) ||
      results.length !== statements.length ||
      results.some((entry) => !entry.success)
    ) {
      throw new Error("D1 did not accept the batch.");
    }
    return results.map(({ results: rows }) =>
      local
        ? rows.rows.map((row) => Object.fromEntries(rows.columns.map((column, i) => [column, row[i]])))
        : rows,
    );
  } finally {
    rmSync(folder, { recursive: true });
  }
}

function checkRows(rows, expected) {
  const [foreignKeys, ...transientCounts] = rows.slice(queries.length);
  if (foreignKeys.length || transientCounts.some((result) => result[0]?.count !== 0)) {
    throw new Error("D1 has foreign key errors or unexpected session, verification or rate limit rows.");
  }
  const actual = fingerprint(rows.slice(0, queries.length));
  for (const table of d1ImportTableOrder) {
    if (actual[table].count !== expected[table]?.count || actual[table].sha256 !== expected[table]?.sha256) {
      throw new Error(`D1 reconciliation failed for ${table}.`);
    }
  }
}

function recoveryTarget(mode, file, target, location, persistTo) {
  if (!["--local", "--remote"].includes(location) || (persistTo && location !== "--local")) {
    throw new Error(
      "Specify --local or --remote explicitly. Only local mode accepts a persistence directory.",
    );
  }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target)) {
    throw new Error("Specify the database UUID.");
  }
  const read = () => d1Batch(target, [...queries, ...checks], location, persistTo);
  const empty = fingerprint(queries.map(() => []));
  const expected = JSON.parse(readFileSync(mode === "restore" ? join(file, "manifest.json") : file, "utf8"));
  if (mode === "restore") {
    checkRows(read(), empty);
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(join(root, "drizzle-d1", "0000_friendly_bullseye.sql"), "utf8"));
      try {
        db.exec(readFileSync(join(file, "restore.sql"), "utf8"));
      } catch {
        throw new Error("The private SQL backup could not be loaded.");
      }
      const rows = [...queries, ...checks].map((sql) => db.prepare(sql).all());
      checkRows(rows, expected);
      const inserts = insertStatements(rows.slice(0, queries.length));
      for (let offset = 0; offset < inserts.length; offset += 30) {
        d1Batch(target, inserts.slice(offset, offset + 30), location, persistTo);
      }
    } finally {
      db.close();
    }
  }
  checkRows(read(), expected);
  console.log("D1 row counts, hashes and foreign keys match.");
}

const [mode, input, target, location, persistTo] = process.argv.slice(2);
try {
  if (mode === "prepare" && input && !target) await buildRecovery(input);
  else if (["verify", "restore"].includes(mode) && input && target) {
    recoveryTarget(mode, input, target, location, persistTo);
  } else {
    throw new Error(
      "Usage: d1-recovery.mjs prepare <dump> | <verify|restore> <manifest-or-recovery-dir> <database-id> <--local|--remote> [persist-dir]",
    );
  }
} catch (error) {
  // Connection and engine errors may contain private rows or credentials.
  console.error(error instanceof SyntaxError ? "Could not parse recovery data." : error.message);
  process.exitCode = 1;
}
