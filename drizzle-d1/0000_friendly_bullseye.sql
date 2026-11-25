CREATE TABLE `runo_auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `runo_auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runo_auth_accounts_user_id_idx` ON `runo_auth_accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `runo_auth_accounts_provider_account_idx` ON `runo_auth_accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `runo_auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `runo_auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runo_auth_sessions_token_unique` ON `runo_auth_sessions` (`token`);--> statement-breakpoint
CREATE INDEX `runo_auth_sessions_user_id_idx` ON `runo_auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `runo_auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runo_auth_users_email_unique` ON `runo_auth_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `runo_auth_users_email_normalized_idx` ON `runo_auth_users` (lower(trim("email")));--> statement-breakpoint
CREATE TABLE `runo_auth_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runo_auth_verifications_identifier_idx` ON `runo_auth_verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `runo_metadata` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `runo_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runo_pendings` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`duration_min` integer NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `runo_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runo_pendings_revision" CHECK("runo_pendings"."revision" > 0),
	CONSTRAINT "runo_pendings_duration" CHECK("runo_pendings"."duration_min" > 0)
);
--> statement-breakpoint
CREATE INDEX `runo_pendings_user_created_idx` ON `runo_pendings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `runo_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "runo_rate_limits_count" CHECK("runo_rate_limits"."count" > 0),
	CONSTRAINT "runo_rate_limits_key" CHECK(length("runo_rate_limits"."key") = 64 and "runo_rate_limits"."key" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `runo_rate_limits_expires_idx` ON `runo_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `runo_routines` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`task_ids` text NOT NULL,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `runo_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runo_routines_revision" CHECK("runo_routines"."revision" > 0),
	CONSTRAINT "runo_routines_title" CHECK(length(trim("runo_routines"."title")) between 1 and 1024),
	CONSTRAINT "runo_routines_task_ids" CHECK(json_valid("runo_routines"."task_ids") and json_type("runo_routines"."task_ids") = 'array' and json_array_length("runo_routines"."task_ids") between 2 and 50)
);
--> statement-breakpoint
CREATE INDEX `runo_routines_user_created_idx` ON `runo_routines` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `runo_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`audio_enabled` integer DEFAULT false NOT NULL,
	`sound` text DEFAULT 'brown' NOT NULL,
	`max_tone` integer DEFAULT 2 NOT NULL,
	`theme` text DEFAULT 'auto' NOT NULL,
	`show_wallet` integer DEFAULT false NOT NULL,
	`locale` text DEFAULT 'es' NOT NULL,
	`task_order` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `runo_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runo_settings_max_tone" CHECK("runo_settings"."max_tone" between 0 and 2),
	CONSTRAINT "runo_settings_locale" CHECK("runo_settings"."locale" in ('es', 'en')),
	CONSTRAINT "runo_settings_revision" CHECK("runo_settings"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `runo_tasks` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`duration_min` integer NOT NULL,
	`priority` integer NOT NULL,
	`days` text NOT NULL,
	`window_start` text,
	`window_end` text,
	`fixed_time` text,
	`short_step_title` text,
	`short_step_duration_min` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `runo_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runo_tasks_revision" CHECK("runo_tasks"."revision" > 0),
	CONSTRAINT "runo_tasks_duration" CHECK("runo_tasks"."duration_min" > 0),
	CONSTRAINT "runo_tasks_priority" CHECK("runo_tasks"."priority" between 1 and 3),
	CONSTRAINT "runo_tasks_days" CHECK(json_valid("runo_tasks"."days") and json_type("runo_tasks"."days") = 'array'),
	CONSTRAINT "runo_tasks_window" CHECK(("runo_tasks"."window_start" is null and "runo_tasks"."window_end" is null) or ("runo_tasks"."window_start" is not null and "runo_tasks"."window_end" is not null and "runo_tasks"."window_start" < "runo_tasks"."window_end")),
	CONSTRAINT "runo_tasks_fixed_time_window" CHECK("runo_tasks"."fixed_time" is null or "runo_tasks"."window_start" is null or ("runo_tasks"."fixed_time" >= "runo_tasks"."window_start" and "runo_tasks"."fixed_time" < "runo_tasks"."window_end")),
	CONSTRAINT "runo_tasks_short_step" CHECK(("runo_tasks"."short_step_title" is null and "runo_tasks"."short_step_duration_min" is null) or ("runo_tasks"."short_step_title" is not null and "runo_tasks"."short_step_duration_min" is not null and "runo_tasks"."short_step_duration_min" > 0 and "runo_tasks"."short_step_duration_min" < "runo_tasks"."duration_min"))
);
--> statement-breakpoint
CREATE INDEX `runo_tasks_user_archived_idx` ON `runo_tasks` (`user_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `runo_users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text,
	`time_zone` text DEFAULT 'America/Mexico_City' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`auth_user_id`) REFERENCES `runo_auth_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runo_users_auth_user_id_unique` ON `runo_users` (`auth_user_id`);