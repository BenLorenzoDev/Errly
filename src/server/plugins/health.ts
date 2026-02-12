// ============================================================================
// Errly — Health & Diagnostics Plugin (Task 7.4)
// /health (no auth) + /api/diagnostics (auth required).
// ============================================================================

import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getLogWatcher } from '../services/railway/log-watcher.js';
import { circuitBreaker, getRateLimitInfo } from '../services/railway/client.js';
import { getClientCount } from './sse.js';
import type { HealthStatus, DiagnosticsInfo } from '../../shared/types.js';

// --- Server start time ---

const startedAt = Date.now();

// --- Plugin ---

export default async function healthPlugin(fastify: FastifyInstance): Promise<void> {

  // GET /health — public health check (no auth)
  fastify.get('/health', async (_request, reply) => {
    // Check DB connectivity
    let dbConnected = false;
    try {
      db.run(sql`SELECT 1`);
      dbConnected = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Health check: DB connection failed', { error: message });
    }

    const logWatcher = getLogWatcher();

    const health: HealthStatus = {
      status: dbConnected ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      dbConnected,
      autoCaptureEnabled: config.autoCaptureEnabled,
      activeSubscriptions: logWatcher?.activeSubscriptions ?? 0,
      sseClients: getClientCount(),
      lastDiscoveryAt: logWatcher?.lastDiscoveryAt
        ? new Date(logWatcher.lastDiscoveryAt).toISOString()
        : null,
    };

    if (!dbConnected) {
      return reply.status(503).send(health);
    }

    return reply.status(200).send(health);
  });

  // GET /api/diagnostics — auth-required detailed diagnostics
  fastify.get('/api/diagnostics', {
    preHandler: [(fastify as any).requireAuth],
  }, async (_request, reply) => {
    const logWatcher = getLogWatcher();
    const rateLimitInfo = getRateLimitInfo();
    const cbStatus = circuitBreaker.getStatus();

    // Calculate errors per minute
    let errorsPerMinute = 0;
    if (logWatcher) {
      const uptimeMinutes = (Date.now() - startedAt) / 60_000;
      if (uptimeMinutes > 0) {
        errorsPerMinute = Math.round(
          (logWatcher.totalErrorsDetected / uptimeMinutes) * 100,
        ) / 100;
      }
    }

    const memoryUsage = process.memoryUsage();

    const diagnostics: DiagnosticsInfo = {
      subscriptions: logWatcher?.getSubscriptionInfo() ?? [],
      circuitBreaker: cbStatus.state,
      railwayApiRateLimit: {
        remaining: rateLimitInfo.remaining,
        resetsAt: rateLimitInfo.resetsAt
          ? new Date(rateLimitInfo.resetsAt).toISOString()
          : null,
      },
      errorsPerMinute,
      totalLogsProcessed: logWatcher?.totalLogsProcessed ?? 0,
      totalErrorsDetected: logWatcher?.totalErrorsDetected ?? 0,
      memoryUsage: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      },
    };

    return reply.status(200).send(diagnostics);
  });
}
