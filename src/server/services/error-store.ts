// ============================================================================
// Errly — Error Store Service (Task 5.4)
// Error CRUD + query layer with filters, pagination, related errors.
// ============================================================================

import { eq, sql, and, or, gte, lte, ne, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { errors, settings } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type {
  ErrlyError,
  ErrlyErrorSummary,
  ErrorFilters,
  DashboardStats,
  ServiceInfo,
  Severity,
  ErrorStatus,
  TimeRange,
} from '../../shared/types.js';

// --- Time range to millisecond offset ---

function timeRangeToMs(range: TimeRange): number {
  switch (range) {
    case 'last-hour': return 60 * 60 * 1000;
    case 'last-24h': return 24 * 60 * 60 * 1000;
    case 'last-7d': return 7 * 24 * 60 * 60 * 1000;
    case 'last-30d': return 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

// --- Row to ErrlyError ---

function rowToError(row: typeof errors.$inferSelect): ErrlyError {
  return {
    id: row.id,
    serviceName: row.serviceName,
    deploymentId: row.deploymentId,
    message: row.message,
    stackTrace: row.stackTrace,
    severity: row.severity as Severity,
    status: (row.status ?? 'new') as ErrorStatus,
    endpoint: row.endpoint,
    rawLog: row.rawLog,
    source: row.source as 'auto-capture' | 'direct',
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    fingerprint: row.fingerprint,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    occurrenceCount: row.occurrenceCount,
    statusChangedAt: row.statusChangedAt,
    createdAt: row.createdAt,
  };
}

// --- Row to ErrlyErrorSummary ---

function rowToSummary(row: typeof errors.$inferSelect): ErrlyErrorSummary {
  return {
    id: row.id,
    serviceName: row.serviceName,
    message: row.message,
    severity: row.severity as Severity,
    status: (row.status ?? 'new') as ErrorStatus,
    endpoint: row.endpoint,
    fingerprint: row.fingerprint,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    occurrenceCount: row.occurrenceCount,
  };
}

// --- Get errors with filters and pagination ---

export function getErrors(filters: ErrorFilters): { errors: ErrlyErrorSummary[]; total: number } {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];

  if (filters.service) {
    conditions.push(eq(errors.serviceName, filters.service));
  }

  if (filters.severity) {
    conditions.push(eq(errors.severity, filters.severity));
  }

  if (filters.status) {
    conditions.push(eq(errors.status, filters.status));
  }

  if (filters.timeRange) {
    const since = Date.now() - timeRangeToMs(filters.timeRange);
    conditions.push(gte(errors.lastSeenAt, since));
  }

  if (filters.search) {
    // Escape LIKE wildcards in user input
    const escaped = filters.search.replace(/[%_]/g, '\\$&');
    const searchPattern = `%${escaped}%`;
    conditions.push(
      or(
        sql`${errors.message} LIKE ${searchPattern} ESCAPE '\\'`,
        sql`${errors.stackTrace} LIKE ${searchPattern} ESCAPE '\\'`,
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total matching records
  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(errors)
    .where(whereClause)
    .get();

  const total = countResult?.count ?? 0;

  // Fetch page of results
  const rows = db
    .select()
    .from(errors)
    .where(whereClause)
    .orderBy(desc(errors.lastSeenAt))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    errors: rows.map(rowToSummary),
    total,
  };
}

// --- Get single error by ID ---

export function getErrorById(id: string): ErrlyError | null {
  const row = db
    .select()
    .from(errors)
    .where(eq(errors.id, id))
    .get();

  return row ? rowToError(row) : null;
}

// --- Get related errors (cross-service, same time window) ---

export function getRelatedErrors(
  errorId: string,
  timeWindowMinutes: number = 5,
): ErrlyErrorSummary[] {
  // Get the anchor error
  const anchor = db
    .select({ serviceName: errors.serviceName, firstSeenAt: errors.firstSeenAt })
    .from(errors)
    .where(eq(errors.id, errorId))
    .get();

  if (!anchor) return [];

  const windowMs = timeWindowMinutes * 60 * 1000;
  const windowStart = anchor.firstSeenAt - windowMs;
  const windowEnd = anchor.firstSeenAt + windowMs;

  const rows = db
    .select()
    .from(errors)
    .where(
      and(
        ne(errors.serviceName, anchor.serviceName),
        gte(errors.lastSeenAt, windowStart),
        lte(errors.lastSeenAt, windowEnd),
      ),
    )
    .orderBy(desc(errors.lastSeenAt))
    .limit(20)
    .all();

  return rows.map(rowToSummary);
}

// --- Delete errors ---

export function deleteErrors(ids?: string[]): { deletedCount: number; deletedIds: string[] } {
  if (ids && ids.length > 0) {
    // Delete specific errors — only return IDs that actually existed
    const deletedIds: string[] = [];
    for (const id of ids) {
      const result = db.delete(errors).where(eq(errors.id, id)).run();
      if (result.changes > 0) deletedIds.push(id);
    }
    return { deletedCount: deletedIds.length, deletedIds };
  }

  // Delete all errors
  const allIds = db
    .select({ id: errors.id })
    .from(errors)
    .all()
    .map((r) => r.id);

  db.delete(errors).run();

  return { deletedCount: allIds.length, deletedIds: allIds };
}

// --- Get dashboard stats ---

export function getStats(): DashboardStats {
  const totalResult = db
    .select({ count: sql<number>`count(*)` })
    .from(errors)
    .get();

  const servicesResult = db
    .select({ count: sql<number>`count(distinct service_name)` })
    .from(errors)
    .get();

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentResult = db
    .select({ count: sql<number>`count(*)` })
    .from(errors)
    .where(gte(errors.lastSeenAt, oneHourAgo))
    .get();

  const topServiceResult = db
    .select({
      serviceName: errors.serviceName,
      count: sql<number>`count(*)`,
    })
    .from(errors)
    .groupBy(errors.serviceName)
    .orderBy(sql`count(*) DESC`)
    .limit(1)
    .get();

  return {
    totalErrors: totalResult?.count ?? 0,
    activeServices: servicesResult?.count ?? 0,
    errorsLastHour: recentResult?.count ?? 0,
    topService: topServiceResult?.serviceName ?? null,
  };
}

// --- Get discovered services ---

export function getServices(): ServiceInfo[] {
  // Get distinct services from errors table, using MAX to get latest deploymentId
  const serviceRows = db
    .select({
      serviceName: errors.serviceName,
      deploymentId: sql<string>`MAX(${errors.deploymentId})`.as('deploymentId'),
    })
    .from(errors)
    .groupBy(errors.serviceName)
    .all();

  // Get service aliases from settings
  let aliases: Record<string, string> = {};
  try {
    const aliasRow = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'service_aliases'))
      .get();

    if (aliasRow?.value) {
      aliases = JSON.parse(aliasRow.value);
    }
  } catch {
    // Ignore parse errors
  }

  return serviceRows.map((row, index) => ({
    id: `svc-${index}`,
    name: row.serviceName,
    alias: aliases[row.serviceName],
    deploymentId: row.deploymentId,
    status: 'active',
  }));
}

// --- Update error status ---

const VALID_STATUSES: ErrorStatus[] = ['new', 'investigating', 'in-progress', 'resolved'];

export function updateErrorStatus(id: string, status: ErrorStatus): ErrlyErrorSummary | null {
  if (!VALID_STATUSES.includes(status)) return null;

  const existing = db.select().from(errors).where(eq(errors.id, id)).get();
  if (!existing) return null;

  const now = Date.now();
  db.update(errors)
    .set({ status, statusChangedAt: now })
    .where(eq(errors.id, id))
    .run();

  const updated = db.select().from(errors).where(eq(errors.id, id)).get();
  if (!updated) return null;

  return rowToSummary(updated);
}

// --- Delete old errors by retention policy (returns deleted IDs) ---

export function deleteByRetention(retentionDays: number): string[] {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  // Get IDs first (needed for SSE broadcast)
  const toDelete = db
    .select({ id: errors.id })
    .from(errors)
    .where(lte(errors.lastSeenAt, cutoff))
    .all();

  if (toDelete.length === 0) return [];

  const ids = toDelete.map((r) => r.id);

  // Batch delete using WHERE clause — single SQL statement instead of per-row
  db.delete(errors).where(lte(errors.lastSeenAt, cutoff)).run();

  logger.info('Retention cleanup completed', {
    deletedCount: ids.length,
    retentionDays,
    cutoffTimestamp: cutoff,
  });

  return ids;
}
