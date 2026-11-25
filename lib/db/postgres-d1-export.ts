import { d1ImportColumns, d1ImportTableOrder, type ImportTable } from "./d1-import.ts";

type SourceRow = Record<string, unknown>;
interface SourceClient {
  query(sql: string, parameters?: (string | number)[]): Promise<{ rows: SourceRow[] }>;
}
type WriteBatch = (table: ImportTable, rows: SourceRow[]) => Promise<void>;

/**
 * Read the durable subset in one PostgreSQL snapshot. The caller supplies a
 * dedicated client and an isolated target. On failure already accepted target
 * batches remain available for exact-match retry.
 */
export async function exportPostgresSnapshot(client: SourceClient, write: WriteBatch) {
  const counts: Partial<Record<ImportTable, number>> = {};
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    for (const table of d1ImportTableOrder) {
      const columns: readonly string[] = d1ImportColumns[table];
      const names = columns.map((column) => `"${column}"`).join(", ");
      const order =
        table === "runo_metadata"
          ? '"user_id", "key"'
          : ["runo_tasks", "runo_routines", "runo_pendings"].includes(table)
            ? '"user_id", "id"'
            : `"${columns[0]}"`;
      const filter =
        table === "runo_metadata" ? "WHERE \"key\" LIKE 'sync:v1:%' OR \"key\" LIKE 'sync:v2:%'" : "";
      let offset = 0;
      for (;;) {
        const result = await client.query(
          `SELECT ${names} FROM "${table}" ${filter} ORDER BY ${order} LIMIT 100 OFFSET $1`,
          [offset],
        );
        if (result.rows.length === 0) break;
        await write(table, result.rows);
        offset += result.rows.length;
      }
      counts[table] = offset;
    }
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* Keep the original failure. */
    }
    throw error;
  }
}
