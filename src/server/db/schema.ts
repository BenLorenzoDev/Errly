// ============================================================================
// Errly — Drizzle SQLite Schema
// Defines errors, settings, and sessions tables
// ============================================================================

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';

// --- Errors Table ---

export const errors = sqliteTable(
  'errors',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    serviceName: text('service_name').notNull(),

    deploymentId: text('deployment_id').notNull(),

    message: text('message').notNull(),

    stackTrace: text('stack_trace'),

    severity: text('severity').notNull(), // 'error' | 'warn' | 'fatal'

    endpoint: text('endpoint'), // e.g., "POST /api/auth/refresh" (nullable)

    rawLog: text('raw_log').notNull(),

    source: text('source').notNull(), // 'auto-capture' | 'direct'

    metadata: text('metadata'), // JSON-encoded additional context (nullable)

    fingerprint: text('fingerprint').notNull(),

    status: text('status').notNull().default('new'), // 'new' | 'investigating' | 'in-progress' | 'resolved'

    statusChangedAt: integer('status_changed_at')
      .notNull()
      .$defaultFn(() => Date.now()),

    firstSeenAt: integer('first_seen_at')
      .notNull()
      .$defaultFn(() => Date.now()),

    lastSeenAt: integer('last_seen_at')
      .notNull()
      .$defaultFn(() => Date.now()),

    occurrenceCount: integer('occurrence_count').notNull().default(1),

    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex('idx_errors_fingerprint').on(table.fingerprint),
    index('idx_errors_service_name').on(table.serviceName),
    index('idx_errors_severity').on(table.severity),
    index('idx_errors_last_seen_at').on(table.lastSeenAt),
    index('idx_errors_created_at').on(table.createdAt),
    index('idx_errors_service_last_seen').on(table.serviceName, table.lastSeenAt),
    index('idx_errors_status').on(table.status),
  ]
);

// --- Settings Table ---

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// --- Sessions Table ---

export const sessions = sqliteTable('sessions', {
  /** SHA-256 hash of the session token — NOT the raw token */
  id: text('id').primaryKey(),

  expiresAt: integer('expires_at').notNull(),
});
