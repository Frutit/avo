/** Explicit source columns for the durable-account import. Order also defines FK order. */
export const d1ImportColumns = {
  runo_auth_users: ["id", "name", "email", "email_verified", "image", "created_at", "updated_at"],
  runo_auth_accounts: ["id", "account_id", "provider_id", "user_id", "created_at", "updated_at"],
  runo_users: ["id", "auth_user_id", "time_zone", "created_at"],
  runo_settings: [
    "user_id",
    "audio_enabled",
    "sound",
    "max_tone",
    "theme",
    "show_wallet",
    "locale",
    "task_order",
    "revision",
    "updated_at",
  ],
  runo_tasks: [
    "id",
    "user_id",
    "title",
    "category",
    "duration_min",
    "priority",
    "days",
    "window_start",
    "window_end",
    "fixed_time",
    "short_step_title",
    "short_step_duration_min",
    "revision",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  runo_routines: [
    "id",
    "user_id",
    "title",
    "task_ids",
    "archived_at",
    "revision",
    "created_at",
    "updated_at",
  ],
  runo_pendings: [
    "id",
    "user_id",
    "title",
    "duration_min",
    "completed_at",
    "deleted_at",
    "revision",
    "created_at",
    "updated_at",
  ],
  runo_metadata: ["user_id", "key", "value", "updated_at"],
} as const;

export type ImportTable = keyof typeof d1ImportColumns;
type SqlValue = string | number | null;
interface PreparedStatement {
  bind(...values: SqlValue[]): PreparedStatement;
}
interface ImportDatabase {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<unknown>;
}

interface CountStatement {
  first(): Promise<{ count: number } | null>;
}

interface CountDatabase {
  prepare(sql: string): CountStatement;
}

const jsonColumns = new Set(["task_order", "days", "task_ids", "value"]);
const instantColumns = new Set(["created_at", "updated_at", "archived_at", "completed_at", "deleted_at"]);

function importValue(column: string, value: unknown): SqlValue {
  if (value === null) return null;
  if (value === undefined) throw new Error(`Missing import column: ${column}`);
  if (instantColumns.has(column)) {
    if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()))
      throw new Error(`Invalid date: ${column}`);
    return value.getTime();
  }
  if (jsonColumns.has(column)) {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error(`Invalid JSON: ${column}`);
    return json;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  throw new Error(`Invalid import value: ${column}`);
}

/**
 * Import an ordered batch while production writes are stopped. An existing row
 * is accepted only when every imported field matches. A mismatch fails the
 * whole D1 batch through the non-null identity column, allowing safe retry.
 */
export async function importD1Rows(
  db: ImportDatabase,
  table: ImportTable,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  if (rows.length > 100) throw new Error("Import batch exceeds 100 rows");
  const columns: readonly string[] = d1ImportColumns[table];
  const identity = columns[0];
  const comparisons = columns.map((column) => `"${column}" IS excluded."${column}"`).join(" AND ");
  const placeholders = columns.map(() => "?").join(", ");
  const names = columns.map((column) => `"${column}"`).join(", ");
  const statement = `INSERT INTO "${table}" (${names}) VALUES (${placeholders}) ON CONFLICT DO UPDATE SET "${identity}" = CASE WHEN ${comparisons} THEN "${identity}" ELSE NULL END`;
  const prepared = rows.map((row) => {
    if (table === "runo_users" && row.id === "owner" && row.auth_user_id !== null) {
      throw new Error("Legacy owner cannot be linked during import");
    }
    if (table === "runo_metadata" && (typeof row.key !== "string" || !/^sync:v[12]:/.test(row.key))) {
      throw new Error("Only sync receipts can be imported as metadata");
    }
    return db.prepare(statement).bind(...columns.map((column) => importValue(column, row[column])));
  });
  await db.batch(prepared);
}

export const d1ImportTableOrder: readonly ImportTable[] = Object.keys(d1ImportColumns) as ImportTable[];

/** Reject cutover when the target contains missing or unexpected durable rows. */
export async function reconcileD1Counts(
  db: CountDatabase,
  sourceCounts: Partial<Record<ImportTable, number>>,
): Promise<void> {
  for (const table of d1ImportTableOrder) {
    const expected = sourceCounts[table];
    if (expected === undefined) throw new Error(`Missing source count: ${table}`);
    const filter = table === "runo_metadata" ? `WHERE "key" LIKE 'sync:v1:%' OR "key" LIKE 'sync:v2:%'` : "";
    const result = await db.prepare(`SELECT COUNT(*) AS count FROM "${table}" ${filter}`).first();
    if (!result || result.count !== expected) throw new Error(`Import count mismatch: ${table}`);
  }
}
