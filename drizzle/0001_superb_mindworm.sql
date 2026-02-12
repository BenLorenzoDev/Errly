ALTER TABLE `errors` ADD `status` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `errors` ADD `status_changed_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_errors_status` ON `errors` (`status`);