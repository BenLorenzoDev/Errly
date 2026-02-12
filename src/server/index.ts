// ============================================================================
// Errly — Main Fastify Server Entry Point (Task 3.2)
// trustProxy, volume sentinel check, migrations, plugin registration,
// CSP header (no unsafe-inline), graceful shutdown (SIGTERM/SIGINT, 8s
// timeout), log watcher start.
// ============================================================================

import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { sqliteDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './utils/logger.js';

// Plugin imports
import authPlugin, { setAuthSseCloseHandler } from './plugins/auth.js';
import errorsPlugin, { setErrorsBroadcast } from './plugins/errors.js';
import ssePlugin, {
  broadcast,
  closeConnectionsBySession,
  closeAllSseConnections,
  getClientCount,
} from './plugins/sse.js';
import settingsPlugin, {
  initializeDefaultSettings,
  setRestartLogWatcherCallback,
  setRunRetentionCallback,
} from './plugins/settings.js';
import healthPlugin from './plugins/health.js';
import staticPlugin from './plugins/static.js';

// Service imports
import {
  startRetentionCleanup,
  stopRetentionCleanup,
  setRetentionBroadcast,
  runRetentionCleanup,
} from './services/retention.js';
import {
  createLogWatcher,
  getLogWatcher,
  destroyLogWatcher,
} from './services/railway/log-watcher.js';

// --- Volume mount sentinel check ---

function checkVolumeSentinel(): void {
  // Only check on Railway (RAILWAY_PROJECT_ID is set)
  if (!config.railwayProjectId) return;

  // Only check if DB path is under /data/
  if (!config.dbPath.startsWith('/data/')) return;

  const sentinelPath = '/data/.errly-volume-ok';
  const dataDir = '/data';

  try {
    if (fs.existsSync(sentinelPath)) {
      logger.info('Volume mount verified (sentinel file found)');
      return;
    }

    // Check if data directory is empty (no sentinel means first boot or no volume)
    const entries = fs.readdirSync(dataDir);
    const nonHiddenEntries = entries.filter((e) => !e.startsWith('.'));

    if (nonHiddenEntries.length === 0) {
      logger.warn(
        'WARNING: /data appears to be on ephemeral storage, not a mounted volume. ' +
        'Data WILL be lost on redeploy. Attach a Railway Volume at /data.',
      );
    }
  } catch {
    logger.warn(
      'WARNING: Could not verify volume mount at /data. ' +
      'Data may be lost on redeploy. Attach a Railway Volume at /data.',
    );
  }
}

function createVolumeSentinel(): void {
  if (!config.railwayProjectId) return;
  if (!config.dbPath.startsWith('/data/')) return;

  const sentinelPath = '/data/.errly-volume-ok';
  try {
    if (!fs.existsSync(sentinelPath)) {
      fs.writeFileSync(sentinelPath, `errly-volume-verified:${Date.now()}\n`);
      logger.info('Volume sentinel file created');
    }
  } catch {
    // Non-fatal — warn but continue
    logger.warn('Could not create volume sentinel file');
  }
}

// --- CSP Header ---

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// --- Main startup ---

async function main(): Promise<void> {
  logger.info('Errly starting...', {
    port: config.port,
    autoCaptureEnabled: config.autoCaptureEnabled,
    dbPath: config.dbPath,
  });

  // Volume mount check (Railway only)
  checkVolumeSentinel();

  // Run database migrations BEFORE anything else
  runMigrations();

  // Initialize default settings if not present
  initializeDefaultSettings();

  // Create volume sentinel after successful DB write
  createVolumeSentinel();

  // Create Fastify instance
  const app = Fastify({
    trustProxy: true,
    logger: false, // We use our own structured logger
  });

  // --- CSP Header (all responses) ---

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', CSP_HEADER);
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  // --- Register plugins in order ---

  // Rate limiting
  await app.register(rateLimit, {
    global: false, // Apply per-route, not globally
  });

  // CORS (dev only, restricted origin)
  if (process.env.NODE_ENV === 'development') {
    await app.register(cors, {
      origin: 'http://localhost:5173',
      credentials: true,
    });
  }

  // Cookie parsing
  await app.register(cookie);

  // Auth plugin (must be before health — /api/diagnostics needs requireAuth decorator)
  await app.register(authPlugin);

  // Health plugin (/health is public, /api/diagnostics uses requireAuth)
  await app.register(healthPlugin);

  // Wire up SSE close handler for auth
  setAuthSseCloseHandler(closeConnectionsBySession);

  // SSE plugin
  await app.register(ssePlugin);

  // Wire up broadcast for errors plugin and retention
  setErrorsBroadcast(broadcast);
  setRetentionBroadcast(broadcast);

  // Errors plugin
  await app.register(errorsPlugin);

  // Settings plugin
  await app.register(settingsPlugin);

  // Wire up log watcher restart callback for settings
  setRestartLogWatcherCallback(async (newToken: string) => {
    // Verify project ID is available — if not, auto-detect won't work (F11 fix)
    if (!config.railwayProjectId) {
      throw new Error(
        'Cannot start auto-capture: RAILWAY_PROJECT_ID is not set. ' +
        'Set it as an environment variable and restart the service.',
      );
    }

    const existing = getLogWatcher();
    if (existing) {
      await existing.stop();
      destroyLogWatcher();
    }

    // Update config with new token (runtime override)
    (config as any).railwayApiToken = newToken;
    (config as any).autoCaptureEnabled = true;

    const watcher = createLogWatcher();
    watcher.setBroadcast(broadcast);
    await watcher.start();

    logger.info('Log watcher restarted with new token');
  });

  // Wire up retention trigger for settings
  setRunRetentionCallback(runRetentionCleanup);

  // Static file serving (LAST — catch-all for SPA fallback)
  await app.register(staticPlugin);

  // --- Start retention cleanup (every hour) ---

  const retentionTimer = startRetentionCleanup(60 * 60 * 1000);

  // --- Start log watcher (if auto-capture enabled) ---

  let logWatcher = getLogWatcher();

  if (config.autoCaptureEnabled) {
    logWatcher = createLogWatcher();
    logWatcher.setBroadcast(broadcast);

    // Start in background — don't block server startup
    logWatcher.start().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('LogWatcher failed to start', { error: message });
    });
  } else {
    logger.info(
      'Auto-capture disabled — no RAILWAY_API_TOKEN. Running in direct-integration-only mode.',
    );
  }

  // --- Graceful shutdown ---

  let shuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal} — starting graceful shutdown`);

    // Force exit timeout: 8 seconds
    const forceExitTimer = setTimeout(() => {
      logger.error('Shutdown timeout exceeded (8s) — forcing exit');
      process.exit(1);
    }, 8000);
    // Unref so it doesn't keep the process alive if everything else is done
    forceExitTimer.unref();

    try {
      // 1. Stop accepting new connections
      await app.close();

      // 2. Stop retention cleanup interval
      stopRetentionCleanup(retentionTimer);

      // 3. Stop log watcher (close all Railway WS subscriptions)
      const watcher = getLogWatcher();
      if (watcher) {
        await watcher.stop();
        destroyLogWatcher();
      }

      // 4. Broadcast auth-expired to all SSE clients and close connections
      closeAllSseConnections();

      // 5. Close the SQLite database connection
      try {
        sqliteDb.close();
      } catch {
        // Ignore DB close errors
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Error during shutdown', { error: message });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // --- Start listening ---

  try {
    const address = await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    logger.info('Errly server started', {
      address,
      port: config.port,
      autoCaptureEnabled: config.autoCaptureEnabled,
      activeSubscriptions: logWatcher?.activeSubscriptions ?? 0,
      dbPath: config.dbPath,
      sseClients: getClientCount(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to start server', { error: message });
    process.exit(1);
  }
}

main();
