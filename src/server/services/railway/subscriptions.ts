// ============================================================================
// Errly — Railway GraphQL Subscriptions (Task 6.3)
// Subscription operations with async generator.
// ============================================================================

import type { Client } from 'graphql-ws';
import { logger } from '../../utils/logger.js';

// --- Subscription Query ---

export const DEPLOYMENT_LOGS_SUBSCRIPTION = `
  subscription DeploymentLogs($deploymentId: String!, $filter: String, $limit: Int) {
    deploymentLogs(deploymentId: $deploymentId, filter: $filter, limit: $limit) {
      timestamp
      message
    }
  }
`;

// --- Log Entry Type ---

export interface LogEntry {
  timestamp: string;
  message: string;
}

// --- Subscribe to deployment logs via async generator ---

export async function* subscribeToDeploymentLogs(
  wsClient: Client,
  deploymentId: string,
): AsyncGenerator<LogEntry[], void, undefined> {
  logger.debug('Opening log subscription', { deploymentId });

  const subscription = wsClient.iterate<{
    deploymentLogs: LogEntry | LogEntry[];
  }>({
    query: DEPLOYMENT_LOGS_SUBSCRIPTION,
    variables: {
      deploymentId,
    },
  });

  try {
    for await (const result of subscription) {
      if (result.data?.deploymentLogs) {
        const logs = result.data.deploymentLogs;

        // The subscription may return a single log entry or an array
        if (Array.isArray(logs)) {
          if (logs.length > 0) {
            yield logs;
          }
        } else {
          yield [logs];
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Subscription error', { deploymentId, error: message });
    throw err;
  } finally {
    logger.debug('Subscription ended', { deploymentId });
  }
}
