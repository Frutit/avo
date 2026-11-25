import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonValue } from "@/lib/domain/types";
import type { TaskOrder } from "@/lib/domain/task-order";

// D1 stores instants as UTC epoch milliseconds and PostgreSQL arrays as JSON.
const instant = (name: string) => integer(name, { mode: "timestamp_ms" });

export const authUsers = sqliteTable(
  "runo_auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [uniqueIndex("runo_auth_users_email_normalized_idx").on(sql`lower(trim(${table.email}))`)],
);

export const authSessions = sqliteTable(
  "runo_auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: instant("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [index("runo_auth_sessions_user_id_idx").on(table.userId)],
);

export const authAccounts = sqliteTable(
  "runo_auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    index("runo_auth_accounts_user_id_idx").on(table.userId),
    uniqueIndex("runo_auth_accounts_provider_account_idx").on(table.providerId, table.accountId),
  ],
);

export const authVerifications = sqliteTable(
  "runo_auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [index("runo_auth_verifications_identifier_idx").on(table.identifier)],
);

export const users = sqliteTable("runo_users", {
  id: text("id").primaryKey(),
  authUserId: text("auth_user_id")
    .unique()
    .references(() => authUsers.id, { onDelete: "restrict" }),
  timeZone: text("time_zone").notNull().default("America/Mexico_City"),
  createdAt: instant("created_at").notNull(),
});

export const rateLimits = sqliteTable(
  "runo_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (table) => [
    index("runo_rate_limits_expires_idx").on(table.expiresAt),
    check("runo_rate_limits_count", sql`${table.count} > 0`),
    check("runo_rate_limits_key", sql`length(${table.key}) = 64 and ${table.key} not glob '*[^0-9a-f]*'`),
  ],
);

export const settings = sqliteTable(
  "runo_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    audioEnabled: integer("audio_enabled", { mode: "boolean" }).notNull().default(false),
    sound: text("sound").notNull().default("brown"),
    maxTone: integer("max_tone").notNull().default(2),
    theme: text("theme").notNull().default("auto"),
    showWallet: integer("show_wallet", { mode: "boolean" }).notNull().default(false),
    locale: text("locale").notNull().default("es"),
    taskOrder: text("task_order", { mode: "json" }).$type<TaskOrder>().notNull().default({}),
    revision: integer("revision").notNull().default(1),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    check("runo_settings_max_tone", sql`${table.maxTone} between 0 and 2`),
    check("runo_settings_locale", sql`${table.locale} in ('es', 'en')`),
    check("runo_settings_revision", sql`${table.revision} > 0`),
  ],
);

export const tasks = sqliteTable(
  "runo_tasks",
  {
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    durationMin: integer("duration_min").notNull(),
    priority: integer("priority").notNull(),
    days: text("days", { mode: "json" }).$type<number[]>().notNull(),
    windowStart: text("window_start"),
    windowEnd: text("window_end"),
    fixedTime: text("fixed_time"),
    shortStepTitle: text("short_step_title"),
    shortStepDurationMin: integer("short_step_duration_min"),
    revision: integer("revision").notNull().default(1),
    archivedAt: instant("archived_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("runo_tasks_user_archived_idx").on(table.userId, table.archivedAt),
    check("runo_tasks_revision", sql`${table.revision} > 0`),
    check("runo_tasks_duration", sql`${table.durationMin} > 0`),
    check("runo_tasks_priority", sql`${table.priority} between 1 and 3`),
    check("runo_tasks_days", sql`json_valid(${table.days}) and json_type(${table.days}) = 'array'`),
    check(
      "runo_tasks_window",
      sql`(${table.windowStart} is null and ${table.windowEnd} is null) or (${table.windowStart} is not null and ${table.windowEnd} is not null and ${table.windowStart} < ${table.windowEnd})`,
    ),
    check(
      "runo_tasks_fixed_time_window",
      sql`${table.fixedTime} is null or ${table.windowStart} is null or (${table.fixedTime} >= ${table.windowStart} and ${table.fixedTime} < ${table.windowEnd})`,
    ),
    check(
      "runo_tasks_short_step",
      sql`(${table.shortStepTitle} is null and ${table.shortStepDurationMin} is null) or (${table.shortStepTitle} is not null and ${table.shortStepDurationMin} is not null and ${table.shortStepDurationMin} > 0 and ${table.shortStepDurationMin} < ${table.durationMin})`,
    ),
  ],
);

export const routines = sqliteTable(
  "runo_routines",
  {
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    taskIds: text("task_ids", { mode: "json" }).$type<string[]>().notNull(),
    archivedAt: instant("archived_at"),
    revision: integer("revision").notNull().default(1),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("runo_routines_user_created_idx").on(table.userId, table.createdAt),
    check("runo_routines_revision", sql`${table.revision} > 0`),
    check("runo_routines_title", sql`length(trim(${table.title})) between 1 and 1024`),
    check(
      "runo_routines_task_ids",
      sql`json_valid(${table.taskIds}) and json_type(${table.taskIds}) = 'array' and json_array_length(${table.taskIds}) between 2 and 50`,
    ),
  ],
);

export const pendings = sqliteTable(
  "runo_pendings",
  {
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    durationMin: integer("duration_min").notNull(),
    completedAt: instant("completed_at"),
    deletedAt: instant("deleted_at"),
    revision: integer("revision").notNull().default(1),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("runo_pendings_user_created_idx").on(table.userId, table.createdAt),
    check("runo_pendings_revision", sql`${table.revision} > 0`),
    check("runo_pendings_duration", sql`${table.durationMin} > 0`),
  ],
);

export const metadata = sqliteTable(
  "runo_metadata",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).$type<JsonValue>().notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export const authAdapterSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
};
