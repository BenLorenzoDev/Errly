// ============================================================================
// Errly — Errors Plugin (Task 7.1)
// Error CRUD routes, direct integration API with token auth, 256KB body
// limit, max 500 IDs per delete.
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { safeCompare } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from './auth.js';
import { processError, errorToSummary } from '../services/error-grouper.js';
import * as errorStore from '../services/error-store.js';
import { getLogWatcher } from '../services/railway/log-watcher.js';
import type {
  ErrorFilters,
  DirectErrorPayload,
  DeleteErrorsRequest,
  Severity,
  TimeRange,
  SSEEvent,
} from '../../shared/types.js';

// --- SSE broadcast function reference (injected) ---

type BroadcastFn = (event: SSEEvent) => void;

let broadcastFn: BroadcastFn | null = null;

export function setErrorsBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

// --- Plugin ---

export default async function errorsPlugin(fastify: FastifyInstance): Promise<void> {

  // GET /api/errors — list errors with filters
  fastify.get('/api/errors', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const filters: ErrorFilters = {};

    if (query.service) filters.service = query.service;
    if (query.severity && ['error', 'warn', 'fatal'].includes(query.severity)) {
      filters.severity = query.severity as Severity;
    }
    if (query.timeRange && ['last-hour', 'last-24h', 'last-7d', 'last-30d'].includes(query.timeRange)) {
      filters.timeRange = query.timeRange as TimeRange;
    }
    if (query.search) filters.search = query.search;
    if (query.page) filters.page = Math.max(1, parseInt(query.page, 10) || 1);
    if (query.limit) filters.limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));

    const result = errorStore.getErrors(filters);

    return reply.status(200).send({
      errors: result.errors,
      total: result.total,
      page: filters.page ?? 1,
      limit: filters.limit ?? 50,
    });
  });

  // GET /api/errors/:id — get single error
  fastify.get('/api/errors/:id', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const error = errorStore.getErrorById(id);
    if (!error) {
      return reply.status(404).send({ error: 'Error not found' });
    }

    return reply.status(200).send(error);
  });

  // GET /api/errors/:id/related — get related cross-service errors
  fastify.get('/api/errors/:id/related', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;

    let windowMinutes = 5;
    if (query.window) {
      const parsed = parseInt(query.window, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 60) {
        windowMinutes = parsed;
      }
    }

    const related = errorStore.getRelatedErrors(id, windowMinutes);
    return reply.status(200).send(related);
  });

  // POST /api/errors — direct integration endpoint (token auth)
  fastify.post('/api/errors', {
    config: {
      rateLimit: {
        max: 100,
        timeWindow: '1 minute',
      },
    },
    bodyLimit: 262144, // 256KB
  }, async (request, reply) => {
    // Token auth via X-Errly-Token header
    const token = request.headers['x-errly-token'] as string | undefined;

    if (!token) {
      return reply.status(401).send({ error: 'X-Errly-Token header required' });
    }

    // Get integration token from settings
    const tokenRow = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'integration_token'))
      .get();

    if (!tokenRow?.value) {
      return reply.status(500).send({ error: 'Integration token not configured' });
    }

    const storedToken = JSON.parse(tokenRow.value) as string;

    if (!safeCompare(token, storedToken)) {
      logger.warn('Invalid integration token used', { ip: request.ip });
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // Parse and validate body
    const body = request.body as DirectErrorPayload | undefined;

    if (!body || !body.service || !body.message) {
      return reply.status(400).send({
        error: 'Missing required fields: service, message',
      });
    }

    // Validate severity if provided
    const severity: Severity = body.severity && ['error', 'warn', 'fatal'].includes(body.severity)
      ? body.severity
      : 'error';

    // Process the error
    const result = processError({
      serviceName: body.service,
      deploymentId: 'direct',
      message: body.message,
      stackTrace: body.stackTrace ?? null,
      severity,
      endpoint: body.endpoint ?? null,
      rawLog: JSON.stringify(body),
      source: 'direct',
      metadata: body.metadata ?? null,
    });

    // Broadcast to SSE clients
    if (broadcastFn) {
      const summary = errorToSummary(result.error);
      if (result.isNew) {
        broadcastFn({ type: 'new-error', payload: summary });
      } else {
        broadcastFn({ type: 'error-updated', payload: summary });
      }
    }

    return reply.status(201).send({
      id: result.error.id,
      fingerprint: result.error.fingerprint,
      isNew: result.isNew,
    });
  });

  // DELETE /api/errors — bulk delete
  fastify.delete('/api/errors', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = request.body as DeleteErrorsRequest | undefined;

    const ids = body?.ids;

    // If specific IDs provided, validate count
    if (ids && ids.length > 0) {
      if (ids.length > 500) {
        return reply.status(400).send({
          error: 'Maximum 500 IDs per delete request',
        });
      }

      const result = errorStore.deleteErrors(ids);

      // Broadcast deletion to SSE clients
      if (broadcastFn && result.deletedIds.length > 0) {
        if (result.deletedIds.length <= 100) {
          broadcastFn({
            type: 'error-cleared',
            payload: { ids: result.deletedIds },
          });
        } else {
          broadcastFn({
            type: 'bulk-cleared',
            payload: {},
          });
        }
      }

      logger.info('Errors deleted', { count: result.deletedCount });

      return reply.status(200).send({
        success: true,
        deletedCount: result.deletedCount,
      });
    }

    // Bulk delete ALL — require confirmation
    if (!body?.confirm) {
      return reply.status(400).send({
        error: 'Bulk delete requires { confirm: true } to prevent accidental data loss',
      });
    }

    const result = errorStore.deleteErrors();

    // Broadcast bulk clear
    if (broadcastFn) {
      broadcastFn({
        type: 'bulk-cleared',
        payload: {},
      });
    }

    logger.info('All errors deleted', { count: result.deletedCount });

    return reply.status(200).send({
      success: true,
      deletedCount: result.deletedCount,
    });
  });

  // GET /api/services — list discovered services (DB + active subscriptions)
  fastify.get('/api/services', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const services = errorStore.getServices();

    // Merge in actively subscribed services from log watcher (even if no errors yet)
    const logWatcher = getLogWatcher();
    if (logWatcher) {
      const subscribed = logWatcher.getSubscriptionInfo();
      const knownNames = new Set(services.map((s) => s.name));
      for (const sub of subscribed) {
        if (!knownNames.has(sub.serviceName)) {
          services.push({
            id: `sub-${sub.deploymentId}`,
            name: sub.serviceName,
            alias: undefined,
            deploymentId: sub.deploymentId,
            status: 'active',
          });
        }
      }
    }

    return reply.status(200).send(services);
  });

  // GET /api/stats — dashboard stats
  fastify.get('/api/stats', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const stats = errorStore.getStats();
    return reply.status(200).send(stats);
  });
}
