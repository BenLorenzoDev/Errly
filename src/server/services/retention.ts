// ============================================================================
// Errly — Retention Service (Task 5.5)
// Scheduled cleanup with SSE broadcast batching strategy.
// ============================================================================

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { deleteByRetention } from './error-store.js';
import { logger } from '../utils/logger.js';
import type { SSEEvent } from '../../shared/types.js';

// --- SSE broadcast function type (injected from sse plugin) ---

type BroadcastFn = (event: SSEEvent) => void;

let broadcastFn: BroadcastFn | null = null;

export function setRetentionBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

// --- Read retention days from settings ---

function getRetentionDays(): number {
  try {
    const row = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'retention_days'))
      .get();

    if (row?.value) {
      const days = JSON.parse(row.value);
      if (typeof days === 'number' && days >= 1 && days <= 90) {
        return days;
      }
    }
  } catch {
    // Fall through to default
  }
  return 7;
}

// --- Run a single retention cleanup pass ---

export function runRetentionCleanup(): void {
  try {
    const retentionDays = getRetentionDays();
    const deletedIds = deleteByRetention(retentionDays);

    if (deletedIds.length === 0) {
      logger.debug('Retention cleanup: no expired errors');
      return;
    }

    logger.info('Retention cleanup deleted errors', {
      count: deletedIds.length,
      retentionDays,
    });

    // Broadcast SSE events
    if (broadcastFn) {
      if (deletedIds.length <= 100) {
        // Send individual IDs — clients can remove them reactively
        broadcastFn({
          type: 'error-cleared',
          payload: { ids: deletedIds },
        });
      } else {
        // Too many — send bulk-cleared so clients re-fetch
        broadcastFn({
          type: 'bulk-cleared',
          payload: {},
        });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Retention cleanup failed', { error: message });
  }
}

// --- Start the retention cleanup interval ---

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startRetentionCleanup(intervalMs: number = 60 * 60 * 1000): ReturnType<typeof setInterval> {
  // Run once immediately on startup
  runRetentionCleanup();

  // Then run on interval (default: every hour)
  retentionTimer = setInterval(runRetentionCleanup, intervalMs);

  logger.info('Retention cleanup started', {
    intervalMs,
    intervalMinutes: intervalMs / 60000,
  });

  return retentionTimer;
}

// --- Stop the retention cleanup ---

export function stopRetentionCleanup(timer?: ReturnType<typeof setInterval>): void {
  const t = timer ?? retentionTimer;
  if (t) {
    clearInterval(t);
    retentionTimer = null;
    logger.info('Retention cleanup stopped');
  }
}
