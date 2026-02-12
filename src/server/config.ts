// ============================================================================
// Errly — Server Configuration
// Loads and validates environment variables
// ============================================================================

import { logger } from './utils/logger.js';

export interface Config {
  /** Dashboard password (required) */
  errlyPassword: string;

  /** Railway API token (optional — enables auto-capture when present) */
  railwayApiToken: string | null;

  /** Whether auto-capture is enabled (true when railwayApiToken is set) */
  autoCaptureEnabled: boolean;

  /** Server port */
  port: number;

  /** Railway project ID (auto-detected from Railway environment or manual) */
  railwayProjectId: string | null;

  /** Railway environment name (e.g., "production" — auto-injected by Railway) */
  railwayEnvironmentName: string | null;

  /** Railway service ID for self-exclusion from subscriptions */
  railwayServiceId: string | null;

  /** SQLite database file path */
  dbPath: string;

  /** Maximum number of concurrent deployment subscriptions */
  maxSubscriptions: number;

  /** Maximum number of concurrent SSE client connections */
  maxSseClients: number;

  /** Whether running in production (NODE_ENV === 'production') */
  isProduction: boolean;
}

function loadConfig(): Config {
  // --- ERRLY_PASSWORD (required) ---
  const errlyPassword = process.env.ERRLY_PASSWORD;
  if (!errlyPassword) {
    logger.error('ERRLY_PASSWORD environment variable is required. Cannot start without a dashboard password.');
    throw new Error('ERRLY_PASSWORD environment variable is required');
  }

  if (errlyPassword.length < 8) {
    logger.warn(
      'ERRLY_PASSWORD is shorter than 8 characters — this is insecure and easily brute-forced.',
      { passwordLength: errlyPassword.length }
    );
  }

  // --- RAILWAY_API_TOKEN (optional) ---
  const railwayApiToken = process.env.RAILWAY_API_TOKEN || null;
  const autoCaptureEnabled = railwayApiToken !== null;

  if (!autoCaptureEnabled) {
    logger.warn(
      'Auto-capture disabled — no RAILWAY_API_TOKEN. Running in direct-integration-only mode.'
    );
  } else {
    logger.info('Railway API token configured — auto-capture enabled.');
  }

  // --- PORT (optional, default 3000) ---
  const portStr = process.env.PORT;
  const port = portStr ? parseInt(portStr, 10) : 3000;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${portStr}`);
  }

  // --- Railway auto-detected env vars ---
  const railwayProjectId = process.env.RAILWAY_PROJECT_ID || null;
  const railwayEnvironmentName = process.env.RAILWAY_ENVIRONMENT_NAME || null;
  const railwayServiceId = process.env.RAILWAY_SERVICE_ID || null;

  // --- ERRLY_DB_PATH (optional, default ./data/errly.db) ---
  const dbPath = process.env.ERRLY_DB_PATH || './data/errly.db';

  // --- ERRLY_MAX_SUBSCRIPTIONS (optional, default 50) ---
  const maxSubsStr = process.env.ERRLY_MAX_SUBSCRIPTIONS;
  const maxSubscriptions = maxSubsStr ? parseInt(maxSubsStr, 10) : 50;
  if (isNaN(maxSubscriptions) || maxSubscriptions < 1) {
    throw new Error(`Invalid ERRLY_MAX_SUBSCRIPTIONS value: ${maxSubsStr}`);
  }

  // --- ERRLY_MAX_SSE_CLIENTS (optional, default 100) ---
  const maxSseStr = process.env.ERRLY_MAX_SSE_CLIENTS;
  const maxSseClients = maxSseStr ? parseInt(maxSseStr, 10) : 100;
  if (isNaN(maxSseClients) || maxSseClients < 1) {
    throw new Error(`Invalid ERRLY_MAX_SSE_CLIENTS value: ${maxSseStr}`);
  }

  const isProduction = process.env.NODE_ENV === 'production';

  const config: Config = {
    errlyPassword,
    railwayApiToken,
    autoCaptureEnabled,
    port,
    railwayProjectId,
    railwayEnvironmentName,
    railwayServiceId,
    dbPath,
    maxSubscriptions,
    maxSseClients,
    isProduction,
  };

  logger.info('Configuration loaded', {
    port: config.port,
    autoCaptureEnabled: config.autoCaptureEnabled,
    dbPath: config.dbPath,
    maxSubscriptions: config.maxSubscriptions,
    maxSseClients: config.maxSseClients,
    railwayProjectId: config.railwayProjectId ? '(set)' : '(not set)',
    railwayEnvironmentName: config.railwayEnvironmentName || '(not set)',
    railwayServiceId: config.railwayServiceId ? '(set)' : '(not set)',
    isProduction: config.isProduction,
  });

  return config;
}

export const config = loadConfig();
