CREATE TABLE `errors` (
	`id` text PRIMARY KEY NOT NULL,
	`service_name` text NOT NULL,
	`deployment_id` text NOT NULL,
	`message` text NOT NULL,
	`stack_trace` text,
	`severity` text NOT NULL,
	`endpoint` text,
	`raw_log` text NOT NULL,
	`source` text NOT NULL,
	`metadata` text,
	`fingerprint` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_errors_fingerprint` ON `errors` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_errors_service_name` ON `errors` (`service_name`);--> statement-breakpoint
CREATE INDEX `idx_errors_severity` ON `errors` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_errors_last_seen_at` ON `errors` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_errors_created_at` ON `errors` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_errors_service_last_seen` ON `errors` (`service_name`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
