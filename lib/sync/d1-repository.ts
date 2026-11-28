import { createHash } from "node:crypto";
import {
  canonicalJSON,
  entityKey,
  preserveCompletion,
  ProtocolError,
  validRecord,
  validValue,
  type Bootstrap,
  type DurableKind,
  type DurableRecord,
  type Mutation,
  type MutationResult,
} from "./protocol";
import type { Task, Pending, Routine, Settings } from "@/lib/domain/types";

type Value = string | number | null;
interface Statement {
  bind(...values: Value[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes: number }; results?: unknown[] }[]>;
}
const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, X-Avo-Account, X-Avo-Sync-Version",
};
function jsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function record(kind: DurableKind, row: Record<string, unknown>): DurableRecord {
  const value: Record<string, unknown> = {};
  if (kind === "task") {
    value.id = row.id;
    value.title = row.title;
    value.category = row.category;
    value.durationMin = row.duration_min;
    value.priority = row.priority;
    value.days = jsonValue(row.days);
    value.createdAt = new Date(Number(row.created_at)).getTime();
    value.updatedAt = new Date(Number(row.updated_at)).getTime();
    value.archivedAt = row.archived_at === null ? null : Number(row.archived_at);
    if (row.window_start && row.window_end)
      value.window = { start: String(row.window_start).slice(0, 5), end: String(row.window_end).slice(0, 5) };
    if (row.fixed_time) value.fixedTime = String(row.fixed_time).slice(0, 5);
    if (row.short_step_title && row.short_step_duration_min)
      value.shortStep = { title: row.short_step_title, durationMin: row.short_step_duration_min };
  }
  if (kind === "pending") {
    value.id = row.id;
    value.title = row.title;
    value.durationMin = row.duration_min;
    value.createdAt = Number(row.created_at);
    value.updatedAt = Number(row.updated_at);
    value.completedAt = row.completed_at === null ? null : Number(row.completed_at);
    value.deletedAt = row.deleted_at === null ? null : Number(row.deleted_at);
  }
  if (kind === "routine") {
    value.id = row.id;
    value.title = row.title;
    value.taskIds = jsonValue(row.task_ids);
    value.createdAt = Number(row.created_at);
    value.updatedAt = Number(row.updated_at);
    value.archivedAt = row.archived_at === null ? null : Number(row.archived_at);
  }
  if (kind === "settings") {
    value.id = "preferences";
    value.audioEnabled = Boolean(row.audio_enabled);
    value.sound = row.sound;
    value.maxTone = row.max_tone;
    value.theme = row.theme;
    value.showWallet = Boolean(row.show_wallet);
    value.locale = row.locale;
    value.taskOrder = jsonValue(row.task_order);
    value.updatedAt = Number(row.updated_at);
  }
  const id = kind === "settings" ? "preferences" : String(row.id);
  const revision = Number(row.revision);
  return { key: entityKey(kind, id), kind, id, revision, value: validValue(kind, id, value) };
}
const kindTable = {
  task: "runo_tasks",
  pending: "runo_pendings",
  routine: "runo_routines",
  settings: "runo_settings",
} as const;
const projection = {
  task: "id,title,category,duration_min,priority,days,window_start,window_end,fixed_time,short_step_title,short_step_duration_min,revision,archived_at,created_at,updated_at",
  pending: "id,title,duration_min,completed_at,deleted_at,revision,created_at,updated_at",
  routine: "id,title,task_ids,revision,archived_at,created_at,updated_at",
  settings: "user_id,audio_enabled,sound,max_tone,theme,show_wallet,locale,task_order,revision,updated_at",
} as const;

async function domainOwner(db: Database, authId: string): Promise<string> {
  const linked = await db
    .prepare("SELECT id FROM runo_users WHERE auth_user_id = ?")
    .bind(authId)
    .first<{ id: string }>();
  if (linked) return linked.id;
  const legacy = await db
    .prepare("SELECT id FROM runo_users WHERE id = ? AND auth_user_id IS NULL")
    .bind(authId)
    .first<{ id: string }>();
  if (legacy) {
    await db
      .prepare("UPDATE runo_users SET auth_user_id = ? WHERE id = ? AND auth_user_id IS NULL")
      .bind(authId, authId)
      .run();
    const attached = await db
      .prepare("SELECT id FROM runo_users WHERE auth_user_id = ?")
      .bind(authId)
      .first<{ id: string }>();
    if (attached) return attached.id;
  }
  const candidate = `account:${authId}`;
  await db
    .prepare(
      "INSERT INTO runo_users (id, auth_user_id, time_zone, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(candidate, authId, "America/Mexico_City", Date.now())
    .run();
  const created = await db
    .prepare("SELECT id FROM runo_users WHERE auth_user_id = ?")
    .bind(authId)
    .first<{ id: string }>();
  if (!created) throw new ProtocolError("account_initialization_race");
  return created.id;
}

async function readKind(db: Database, owner: string, kind: DurableKind) {
  const rows = (
    await db
      .prepare(`SELECT ${projection[kind]} FROM ${kindTable[kind]} WHERE user_id = ? LIMIT 10001`)
      .bind(owner)
      .all<Record<string, unknown>>()
  ).results;
  return rows.map((row) => record(kind, row));
}
export async function readD1Account(
  db: Database,
  accountId: string,
  version: 1 | 2,
  ifNoneMatch?: string,
): Promise<Bootstrap & { etag: string; notModified?: boolean }> {
  const owner = await domainOwner(db, accountId);
  const kinds: DurableKind[] =
    version === 2 ? ["task", "pending", "routine", "settings"] : ["task", "pending", "settings"];
  const statements = kinds.map((kind) =>
    db
      .prepare(`SELECT ${projection[kind]} FROM ${kindTable[kind]} WHERE user_id = ? LIMIT 10001`)
      .bind(owner),
  );
  const result = await db.batch(statements);
  const records = result
    .flatMap((batch, index) =>
      ((batch.results ?? []) as Record<string, unknown>[]).map((row) => record(kinds[index]!, row)),
    )
    .flat()
    .sort((a, b) => a.key.localeCompare(b.key));
  if (records.length > 30_000) throw new ProtocolError("snapshot_too_large");
  const snapshot = canonicalJSON({ accountId, version, records });
  const etag = `"avo-snapshot:${createHash("sha256").update(snapshot).digest("hex")}"`;
  if (ifNoneMatch === etag) return { accountId, version, records: [], etag, notModified: true };
  return { accountId, version, records, etag };
}
function sqlValue(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function rowFor(owner: string, m: Mutation, revision: number) {
  const v = m.value as unknown as Record<string, unknown>;
  const common = {
    id: m.id,
    user_id: owner,
    revision,
    created_at: sqlValue(v.createdAt),
    updated_at: sqlValue(v.updatedAt),
  };
  if (m.kind === "task") {
    const task = v as unknown as Task;
    return {
      ...common,
      title: task.title,
      category: task.category,
      duration_min: task.durationMin,
      priority: task.priority,
      days: JSON.stringify(task.days),
      window_start: task.window?.start ?? null,
      window_end: task.window?.end ?? null,
      fixed_time: task.fixedTime ?? null,
      short_step_title: task.shortStep?.title ?? null,
      short_step_duration_min: task.shortStep?.durationMin ?? null,
      archived_at: sqlValue(task.archivedAt),
    };
  }
  if (m.kind === "pending") {
    const p = v as unknown as Pending;
    return {
      ...common,
      title: p.title,
      duration_min: p.durationMin,
      completed_at: sqlValue(p.completedAt),
      deleted_at: sqlValue(p.deletedAt),
    };
  }
  if (m.kind === "routine") {
    const r = v as unknown as Routine;
    return {
      ...common,
      title: r.title,
      task_ids: JSON.stringify(r.taskIds),
      archived_at: sqlValue(r.archivedAt),
    };
  }
  const s = v as unknown as Settings;
  return {
    user_id: owner,
    audio_enabled: sqlValue(s.audioEnabled),
    sound: s.sound,
    max_tone: s.maxTone,
    theme: s.theme,
    show_wallet: sqlValue(s.showWallet),
    locale: s.locale ?? "es",
    task_order: JSON.stringify(s.taskOrder ?? {}),
    revision,
    updated_at: sqlValue(s.updatedAt),
  };
}
async function rows<T>(db: Database, query: string, ...values: Value[]) {
  return (
    await db
      .prepare(query)
      .bind(...values)
      .all<T>()
  ).results;
}

function validateRoutineWrite(
  m: Mutation,
  value: Routine,
  tasks: Map<string, DurableRecord>,
  routines: Map<string, DurableRecord>,
) {
  const ids = value.taskIds;
  const members = ids.map((id) => tasks.get(id)?.value as Task | undefined);
  if (members.some((task) => !task)) throw new ProtocolError("routine_task_missing");
  if (value.archivedAt !== null) return;
  if (members.some((task) => task?.archivedAt !== null)) throw new ProtocolError("routine_task_missing");
  if (
    [...routines.values()].some(
      (routine) =>
        routine.id !== m.id &&
        (routine.value as Routine).archivedAt === null &&
        (routine.value as Routine).taskIds.some((taskId) => ids.includes(taskId)),
    )
  )
    throw new ProtocolError("routine_task_grouped");
}

function validateTaskWrite(
  task: Task,
  tasks: Map<string, DurableRecord>,
  routines: Map<string, DurableRecord>,
) {
  const memberships = [...routines.values()]
    .map((routine) => routine.value as Routine)
    .filter((routine) => routine.archivedAt === null && routine.taskIds.includes(task.id));
  if (!memberships.length) return;
  if (task.archivedAt !== null) throw new ProtocolError("routine_task_must_be_removed");
  for (const routine of memberships) {
    const peers = routine.taskIds.filter((id) => id !== task.id);
    if (peers.some((id) => !tasks.has(id))) throw new ProtocolError("routine_task_missing");
  }
}

async function readRequested(db: Database, owner: string, mutations: Mutation[]) {
  const found = new Map<string, DurableRecord>();
  for (const kind of ["task", "pending", "routine", "settings"] as const) {
    const group = mutations.filter((mutation) => mutation.kind === kind);
    if (!group.length) continue;
    const table = kindTable[kind];
    const idColumn = kind === "settings" ? "user_id" : "id";
    const ids = [...new Set(group.map((mutation) => (kind === "settings" ? owner : mutation.id)))];
    const marks = ids.map(() => "?").join(",");
    const foundRows = await rows<Record<string, unknown>>(
      db,
      `SELECT ${projection[kind]} FROM ${table} WHERE user_id = ? AND ${idColumn} IN (${marks})`,
      owner,
      ...ids,
    );
    for (const row of foundRows) {
      const parsed = record(kind, row);
      found.set(parsed.key, parsed);
    }
  }
  return found;
}
export async function mutateD1Account(
  db: Database,
  accountId: string,
  mutations: Mutation[],
  version: 1 | 2,
): Promise<MutationResult[]> {
  const owner = await domainOwner(db, accountId);
  if (new Set(mutations.map((mutation) => entityKey(mutation.kind, mutation.id))).size !== mutations.length)
    throw new ProtocolError("duplicate_mutation");
  const operationKeys = mutations.map((mutation) => `sync:v${version}:${mutation.operationId}`);
  const oldReceipts = operationKeys.length
    ? await rows<{ key: string; value: string }>(
        db,
        `SELECT key, value FROM runo_metadata WHERE user_id = ? AND key IN (${operationKeys.map(() => "?").join(",")})`,
        owner,
        ...operationKeys,
      )
    : [];
  const receipts = new Map(
    oldReceipts.map((receipt) => [
      receipt.key,
      jsonValue(receipt.value) as { hash: string; result: MutationResult },
    ]),
  );
  const existingRecords = await readRequested(db, owner, mutations);
  const results: (MutationResult | undefined)[] = new Array(mutations.length);
  const statements: Statement[] = [];
  const pendingWrites: { index: number; mutation: Mutation; hash: string; candidate: DurableRecord }[] = [];
  const relationKinds = mutations.some((mutation) => mutation.kind === "task" || mutation.kind === "routine");
  const taskRecords = relationKinds ? await readKind(db, owner, "task") : [];
  const routineRecords = relationKinds ? await readKind(db, owner, "routine") : [];
  const tasks = new Map(taskRecords.map((item) => [item.id, item]));
  const routines = new Map(routineRecords.map((item) => [item.id, item]));

  for (const [index, mutation] of mutations.entries()) {
    const receiptKey = operationKeys[index]!;
    const hash = createHash("sha256").update(canonicalJSON(mutation)).digest("hex");
    const saved = receipts.get(receiptKey);
    if (saved) {
      if (saved.hash !== hash) throw new ProtocolError("operation_reused");
      results[index] = saved.result;
      continue;
    }
    const key = entityKey(mutation.kind, mutation.id);
    const previous = existingRecords.get(key) ?? null;
    if (previous && mutation.baseRevision !== previous.revision) {
      results[index] = { operationId: mutation.operationId, status: "conflict", record: previous };
      continue;
    }
    if (!previous && mutation.baseRevision !== 0) throw new ProtocolError("record_missing");
    const value = previous
      ? preserveCompletion(mutation.value, previous.value, mutation.kind)
      : mutation.value;
    const next = { ...mutation, value } as Mutation;
    if (next.kind === "routine") validateRoutineWrite(next, next.value as Routine, tasks, routines);
    if (next.kind === "task") validateTaskWrite(next.value as Task, tasks, routines);
    const revision = (previous?.revision ?? 0) + 1;
    const row = rowFor(owner, next, revision);
    const columns = Object.keys(row);
    const pk = mutation.kind === "settings" ? "user_id" : "user_id, id";
    const updates = columns
      .filter((column) => column !== "user_id" && column !== "id")
      .map((column) => `\"${column}\" = excluded.\"${column}\"`)
      .join(", ");
    const revisionColumn =
      mutation.kind === "settings"
        ? "runo_settings.revision"
        : `runo_${mutation.kind === "task" ? "tasks" : mutation.kind === "pending" ? "pendings" : "routines"}.revision`;
    const conflictAction = previous ? `DO UPDATE SET ${updates} WHERE ${revisionColumn} = ?` : "DO NOTHING";
    const values = columns.map((column) => row[column as keyof typeof row] as Value);
    const write = db
      .prepare(
        `INSERT INTO ${kindTable[mutation.kind]} (${columns.map((column) => `\"${column}\"`).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(${pk}) ${conflictAction}`,
      )
      .bind(...values, ...(previous ? [mutation.baseRevision] : []));
    const candidate = validRecord(record(mutation.kind, { ...row, revision }), version);
    const receiptValue = JSON.stringify({
      hash,
      result: { operationId: mutation.operationId, status: "applied", record: candidate },
    });
    const saveReceipt = db
      .prepare("INSERT INTO runo_metadata(user_id,key,value,updated_at) SELECT ?,?,?,? WHERE changes() > 0")
      .bind(owner, receiptKey, receiptValue, Date.now());
    statements.push(write, saveReceipt);
    pendingWrites.push({ index, mutation, hash, candidate });
    existingRecords.set(key, candidate);
    if (mutation.kind === "task") tasks.set(mutation.id, candidate);
    if (mutation.kind === "routine") routines.set(mutation.id, candidate);
  }

  if (statements.length) {
    const applied = await db.batch(statements);
    const raced = pendingWrites.filter((write, index) => !applied[index * 2]?.meta.changes);
    for (const write of pendingWrites) {
      if (!raced.includes(write)) {
        results[write.index] = {
          operationId: write.mutation.operationId,
          status: "applied",
          record: write.candidate,
        };
      }
    }
    if (raced.length) {
      const keys = raced.map((write) => `sync:v${version}:${write.mutation.operationId}`);
      const racedReceipts = await rows<{ key: string; value: string }>(
        db,
        `SELECT key, value FROM runo_metadata WHERE user_id = ? AND key IN (${keys.map(() => "?").join(",")})`,
        owner,
        ...keys,
      );
      const byReceipt = new Map(
        racedReceipts.map((receipt) => [
          receipt.key,
          jsonValue(receipt.value) as { hash: string; result: MutationResult },
        ]),
      );
      const fresh = await readRequested(
        db,
        owner,
        raced.map((write) => write.mutation),
      );
      for (const write of raced) {
        const receiptKey = `sync:v${version}:${write.mutation.operationId}`;
        const replay = byReceipt.get(receiptKey);
        if (replay) {
          if (replay.hash !== write.hash) throw new ProtocolError("operation_reused");
          results[write.index] = replay.result;
          continue;
        }
        const current = fresh.get(entityKey(write.mutation.kind, write.mutation.id));
        if (!current) throw new ProtocolError("record_missing");
        results[write.index] = {
          operationId: write.mutation.operationId,
          status: "conflict",
          record: current,
        };
      }
    }
  }
  return results as MutationResult[];
}
export { privateHeaders as d1PrivateHeaders };
