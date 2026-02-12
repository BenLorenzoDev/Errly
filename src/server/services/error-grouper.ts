// ============================================================================
// Errly — Error Grouper Service (Task 5.3)
// Two-step upsert (SELECT then INSERT or UPDATE). Severity escalation (never
// downgrade). Webhook dispatch with 5s timeout via AbortSignal.
// ============================================================================

import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, sqliteDb } from '../db/index.js';
import { errors, settings } from '../db/schema.js';
import { generateFingerprint } from '../utils/fingerprint.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import { logger } from '../utils/logger.js';
import type { ErrlyError, ErrlyErrorSummary, ErrorStatus, Severity } from '../../shared/types.js';

// --- Severity ordering for escalation ---

const SEVERITY_ORDER: Record<string, number> = {
  warn: 0,
  error: 1,
  fatal: 2,
};

function shouldEscalate(current: string, incoming: string): boolean {
  return (SEVERITY_ORDER[incoming] ?? 0) > (SEVERITY_ORDER[current] ?? 0);
}

// --- Process an error: deduplicate and group ---

export interface ProcessErrorInput {
  serviceName: string;
  deploymentId: string;
  message: string;
  stackTrace?: string | null;
  severity: Severity;
  endpoint?: string | null;
  rawLog: string;
  source: 'auto-capture' | 'direct';
  metadata?: Record<string, unknown> | null;
}

export interface ProcessErrorResult {
  error: ErrlyError;
  isNew: boolean;
}

export function processError(input: ProcessErrorInput): ProcessErrorResult {
  const fingerprint = generateFingerprint(
    input.serviceName,
    input.message,
    input.stackTrace ?? undefined,
  );

  const now = Date.now();

  // Wrap SELECT + INSERT/UPDATE in a transaction to prevent UNIQUE constraint
  // races when concurrent log batches contain identical errors (F1 fix).
  const txResult = sqliteDb.transaction(() => {
    const existing = db
      .select({
        id: errors.id,
        occurrenceCount: errors.occurrenceCount,
        severity: errors.severity,
        status: errors.status,
      })
      .from(errors)
      .where(eq(errors.fingerprint, fingerprint))
      .get();

    if (!existing) {
      const id = crypto.randomUUID();

      db.insert(errors)
        .values({
          id,
          serviceName: input.serviceName,
          deploymentId: input.deploymentId,
          message: input.message,
          stackTrace: input.stackTrace ?? null,
          severity: input.severity,
          status: 'new',
          endpoint: input.endpoint ?? null,
          rawLog: input.rawLog,
          source: input.source,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          fingerprint,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrenceCount: 1,
          statusChangedAt: now,
          createdAt: now,
        })
        .run();

      const newError: ErrlyError = {
        id,
        serviceName: input.serviceName,
        deploymentId: input.deploymentId,
        message: input.message,
        stackTrace: input.stackTrace ?? null,
        severity: input.severity,
        status: 'new',
        endpoint: input.endpoint ?? null,
        rawLog: input.rawLog,
        source: input.source,
        metadata: input.metadata ?? null,
        fingerprint,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
        statusChangedAt: now,
        createdAt: now,
      };

      return { error: newError, isNew: true };
    }

    const newSeverity = shouldEscalate(existing.severity, input.severity)
      ? input.severity
      : existing.severity;

    // Revert resolved→new on recurrence; investigating/in-progress keep their status
    const revertStatus = existing.status === 'resolved' ? 'new' : existing.status;
    const statusChanged = revertStatus !== existing.status;

    db.update(errors)
      .set({
        lastSeenAt: now,
        occurrenceCount: sql`${errors.occurrenceCount} + 1`,
        deploymentId: input.deploymentId,
        rawLog: input.rawLog,
        message: input.message,
        severity: newSeverity,
        status: revertStatus,
        ...(statusChanged ? { statusChangedAt: now } : {}),
        endpoint: input.endpoint ?? sql`${errors.endpoint}`,
        metadata: input.metadata
          ? JSON.stringify(input.metadata)
          : sql`${errors.metadata}`,
      })
      .where(eq(errors.fingerprint, fingerprint))
      .run();

    const updated = db
      .select()
      .from(errors)
      .where(eq(errors.id, existing.id))
      .get();

    if (!updated) {
      throw new Error(`Error record vanished after update: ${existing.id}`);
    }

    const updatedError: ErrlyError = {
      id: updated.id,
      serviceName: updated.serviceName,
      deploymentId: updated.deploymentId,
      message: updated.message,
      stackTrace: updated.stackTrace,
      severity: updated.severity as Severity,
      status: (updated.status ?? 'new') as ErrorStatus,
      endpoint: updated.endpoint,
      rawLog: updated.rawLog,
      source: updated.source as 'auto-capture' | 'direct',
      metadata: updated.metadata ? JSON.parse(updated.metadata) : null,
      fingerprint: updated.fingerprint,
      firstSeenAt: updated.firstSeenAt,
      lastSeenAt: updated.lastSeenAt,
      occurrenceCount: updated.occurrenceCount,
      statusChangedAt: updated.statusChangedAt,
      createdAt: updated.createdAt,
    };

    return { error: updatedError, isNew: false };
  })();

  // Fire webhook outside transaction (fire-and-forget)
  if (txResult.isNew) {
    dispatchWebhook(toSummary(txResult.error));
  }

  return txResult;
}

// --- Convert full error to summary ---

function toSummary(error: ErrlyError): ErrlyErrorSummary {
  return {
    id: error.id,
    serviceName: error.serviceName,
    message: error.message,
    severity: error.severity,
    status: error.status,
    endpoint: error.endpoint,
    fingerprint: error.fingerprint,
    firstSeenAt: error.firstSeenAt,
    lastSeenAt: error.lastSeenAt,
    occurrenceCount: error.occurrenceCount,
  };
}

export { toSummary as errorToSummary };

// --- Webhook dispatch (fire-and-forget, 5s timeout) ---

// --- SSRF check: resolve hostname and reject private IPs at fetch time ---

function isPrivateResolvedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
  }
  return false;
}

async function dispatchWebhook(errorSummary: ErrlyErrorSummary): Promise<void> {
  try {
    const webhookRow = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'webhook_url'))
      .get();

    if (!webhookRow || !webhookRow.value || webhookRow.value === 'null') {
      return;
    }

    const webhookUrl = JSON.parse(webhookRow.value) as string;
    if (!webhookUrl) return;

    // SSRF protection: resolve hostname and reject private IPs at fetch time
    // (prevents DNS rebinding attacks — F2/F12 fix)
    try {
      const parsed = new URL(webhookUrl);
      const hostname = parsed.hostname;
      if (!net.isIP(hostname)) {
        const resolved = await dns.resolve4(hostname).catch(() => []);
        const resolved6 = await dns.resolve6(hostname).catch(() => []);
        const allIps = [...resolved, ...resolved6];
        if (allIps.some(isPrivateResolvedIp)) {
          logger.warn('Webhook SSRF blocked: hostname resolves to private IP', {
            url: webhookUrl,
            resolvedIps: allIps,
          });
          return;
        }
      }
    } catch {
      // DNS resolution failure — skip webhook
      return;
    }

    const payload = {
      type: 'new-error',
      error: errorSummary,
      timestamp: Date.now(),
    };

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Webhook dispatch failed', {
        url: webhookUrl,
        error: message,
      });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Webhook dispatch error', { error: message });
  }
}
