// ============================================================================
// Errly — Log Watcher Orchestrator (Task 6.4)
// Deployment discovery, subscription management, zombie detection,
// adaptive discovery interval, environment filtering, self-exclusion.
// ============================================================================

import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import {
  createWsClient,
  disposeWsClient,
  circuitBreaker,
  getRateLimitInfo,
  type RateLimitInfo,
} from './client.js';
import { queryProject, type RailwayDeployment } from './queries.js';
import { subscribeToDeploymentLogs, type LogEntry } from './subscriptions.js';
import {
  getAssembler,
  removeAssembler,
  clearAllAssemblers,
  getAssemblerKeys,
  isErrorLog,
  isInfoLevelOverride,
  extractEndpoint,
  type CompleteError,
} from './log-parser.js';
import { processError, errorToSummary } from '../error-grouper.js';
import type { SSEEvent, SubscriptionInfo } from '../../../shared/types.js';
import type { Client } from 'graphql-ws';

// --- Types ---

interface ActiveSubscription {
  deploymentId: string;
  serviceName: string;
  generator: AsyncGenerator<LogEntry[], void, undefined>;
  lastMessageAt: number;
  status: 'active' | 'zombie' | 'reconnecting' | 'closed';
}

// --- Broadcast function reference (injected from SSE plugin) ---

type BroadcastFn = (event: SSEEvent) => void;

// --- LogWatcher Class ---

export class LogWatcher {
  private subscriptions = new Map<string, ActiveSubscription>();
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private wsClient: Client | null = null;
  private running = false;
  private broadcastFn: BroadcastFn | null = null;

  // Adaptive discovery interval
  private baseDiscoveryIntervalMs: number = 60_000;
  private currentDiscoveryIntervalMs: number = 60_000;
  private maxDiscoveryIntervalMs: number = 300_000; // 5 min

  // Metrics
  private _totalLogsProcessed: number = 0;
  private _totalErrorsDetected: number = 0;
  private _lastDiscoveryAt: number | null = null;

  // Configuration
  private readonly maxSubscriptions: number;
  private readonly token: string;
  private readonly projectId: string;
  private readonly environmentName: string | undefined;
  private readonly selfServiceId: string | undefined;

  constructor() {
    this.maxSubscriptions = config.maxSubscriptions;
    this.token = config.railwayApiToken ?? '';
    this.projectId = config.railwayProjectId ?? '';
    this.environmentName = config.railwayEnvironmentName ?? undefined;
    this.selfServiceId = config.railwayServiceId ?? undefined;
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn;
  }

  // --- Start ---

  async start(): Promise<void> {
    if (!this.token || !this.projectId) {
      logger.warn('LogWatcher cannot start — missing token or projectId');
      return;
    }

    if (this.running) {
      logger.warn('LogWatcher already running');
      return;
    }

    this.running = true;
    logger.info('LogWatcher starting', {
      projectId: this.projectId,
      environmentName: this.environmentName ?? 'ALL',
      maxSubscriptions: this.maxSubscriptions,
    });

    // Create WebSocket client
    this.wsClient = createWsClient(this.token);

    // Initial discovery
    await this.refreshDeployments();

    // Start discovery interval
    this.scheduleDiscovery();

    // Start health monitor (every 5 minutes)
    this.healthTimer = setInterval(() => {
      this.checkSubscriptionHealth();
    }, 5 * 60 * 1000);
  }

  // --- Stop ---

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    logger.info('LogWatcher stopping');

    // Stop discovery interval
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }

    // Stop health monitor
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Close all subscriptions
    for (const [deploymentId, sub] of this.subscriptions) {
      await this.closeSubscription(deploymentId, sub);
    }
    this.subscriptions.clear();

    // Clear all assemblers
    clearAllAssemblers();

    // Dispose WebSocket client
    disposeWsClient();
    this.wsClient = null;

    logger.info('LogWatcher stopped');
  }

  // --- Discovery ---

  private async refreshDeployments(): Promise<void> {
    try {
      if (circuitBreaker.isOpen()) {
        logger.warn('Circuit breaker is OPEN — skipping discovery');
        this.increaseDiscoveryInterval();
        return;
      }

      if (circuitBreaker.hasAuthError()) {
        logger.warn('Auth error — skipping discovery');
        return;
      }

      const projectData = await queryProject(this.projectId, this.token);
      this._lastDiscoveryAt = Date.now();

      // Filter deployments
      let deployments = projectData.deployments;

      // Environment filtering
      if (this.environmentName) {
        deployments = deployments.filter(
          (d) => d.environmentName === this.environmentName,
        );
        logger.debug('Filtered deployments by environment', {
          environment: this.environmentName,
          count: deployments.length,
        });
      } else {
        logger.warn('RAILWAY_ENVIRONMENT_NAME not set — subscribing to all environments');
      }

      // Self-exclusion
      if (this.selfServiceId) {
        deployments = deployments.filter(
          (d) => d.serviceId !== this.selfServiceId,
        );
      }

      // Diff against current subscriptions
      const currentIds = new Set(this.subscriptions.keys());
      const desiredIds = new Set(deployments.map((d) => d.id));

      // Close removed subscriptions
      for (const depId of currentIds) {
        if (!desiredIds.has(depId)) {
          const sub = this.subscriptions.get(depId);
          if (sub) {
            logger.info('Closing subscription for removed deployment', {
              deploymentId: depId,
              serviceName: sub.serviceName,
            });
            await this.closeSubscription(depId, sub);
            this.subscriptions.delete(depId);
          }
        }
      }

      // Reopen dead/closed subscriptions that are still desired
      for (const dep of deployments) {
        const existing = this.subscriptions.get(dep.id);
        if (existing && existing.status === 'closed') {
          logger.info('Reopening closed subscription', {
            deploymentId: dep.id,
            serviceName: existing.serviceName,
          });
          await this.closeSubscription(dep.id, existing);
          this.subscriptions.delete(dep.id);
        }
      }

      // Open new subscriptions (respecting max cap)
      for (const dep of deployments) {
        if (this.subscriptions.has(dep.id)) continue;
        if (this.subscriptions.size >= this.maxSubscriptions) {
          logger.warn('Max subscriptions reached, skipping', {
            maxSubscriptions: this.maxSubscriptions,
            skippedDeployment: dep.id,
            serviceName: dep.serviceName,
          });
          break;
        }
        this.openSubscription(dep);
      }

      // Adjust discovery interval based on rate limit
      this.adjustDiscoveryInterval();

      logger.info('Discovery completed', {
        activeSubscriptions: this.subscriptions.size,
        discoveredDeployments: deployments.length,
        intervalMs: this.currentDiscoveryIntervalMs,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Discovery failed', { error: message });
      this.increaseDiscoveryInterval();
    }
  }

  // --- Subscription Management ---

  private openSubscription(deployment: RailwayDeployment): void {
    if (!this.wsClient) {
      logger.error('Cannot open subscription — no WebSocket client');
      return;
    }

    const generator = subscribeToDeploymentLogs(this.wsClient, deployment.id);

    const sub: ActiveSubscription = {
      deploymentId: deployment.id,
      serviceName: deployment.serviceName,
      generator,
      lastMessageAt: Date.now(),
      status: 'active',
    };

    this.subscriptions.set(deployment.id, sub);

    logger.info('Opened log subscription', {
      deploymentId: deployment.id,
      serviceName: deployment.serviceName,
    });

    // Start consuming the generator
    this.consumeSubscription(sub);
  }

  private async consumeSubscription(sub: ActiveSubscription): Promise<void> {
    try {
      for await (const logBatch of sub.generator) {
        if (!this.running) break;

        sub.lastMessageAt = Date.now();
        sub.status = 'active';

        this.handleLogBatch(sub.serviceName, sub.deploymentId, logBatch);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.running) {
        logger.error('Subscription consumption error', {
          deploymentId: sub.deploymentId,
          serviceName: sub.serviceName,
          error: message,
        });
        sub.status = 'closed';
      }
    }
  }

  private async closeSubscription(
    deploymentId: string,
    sub: ActiveSubscription,
  ): Promise<void> {
    try {
      sub.status = 'closed';
      await sub.generator.return(undefined);
    } catch {
      // Ignore errors during cleanup
    }

    // Clean up assembler for this deployment
    removeAssembler(deploymentId);
  }

  // --- Log Processing ---

  private handleLogBatch(
    serviceName: string,
    deploymentId: string,
    logs: LogEntry[],
  ): void {
    for (const log of logs) {
      this._totalLogsProcessed++;

      const assembler = getAssembler(deploymentId);
      const timestamp = log.timestamp ? new Date(log.timestamp).getTime() : Date.now();

      // Set up completion handler for timeout-based flushes
      assembler.setCompletionHandler((completeError: CompleteError) => {
        this.processCompleteError(serviceName, deploymentId, completeError);
      });

      // Feed the log line to the assembler
      const result = assembler.feed(log.message, timestamp);

      if (result) {
        this.processCompleteError(serviceName, deploymentId, result);
      } else if (!assembler.isCollecting()) {
        // The assembler didn't detect an error from the message text alone.
        // Check if Railway's severity metadata indicates an error/warning.
        // But skip if the message body has a structured info/debug level
        // (common with stderr-routed info logs tagged [err] by Railway).
        const railwaySeverity = log.severity?.toLowerCase();
        if (railwaySeverity && railwaySeverity !== 'info' && railwaySeverity !== 'debug'
            && !isInfoLevelOverride(log.message)) {
          const severity = railwaySeverity === 'fatal' || railwaySeverity === 'critical'
            ? 'fatal' as const
            : railwaySeverity === 'warn' || railwaySeverity === 'warning'
              ? 'warn' as const
              : 'error' as const;

          this.processCompleteError(serviceName, deploymentId, {
            message: log.message,
            stackTrace: log.message,
            severity,
            endpoint: extractEndpoint(log.message),
            rawLog: log.message,
          });
        }
      }
    }
  }

  private processCompleteError(
    serviceName: string,
    deploymentId: string,
    completeError: CompleteError,
  ): void {
    this._totalErrorsDetected++;

    try {
      const result = processError({
        serviceName,
        deploymentId,
        message: completeError.message,
        stackTrace: completeError.stackTrace,
        severity: completeError.severity,
        endpoint: completeError.endpoint,
        rawLog: completeError.rawLog,
        source: 'auto-capture',
      });

      // Broadcast to SSE clients
      if (this.broadcastFn) {
        const summary = errorToSummary(result.error);
        if (result.isNew) {
          this.broadcastFn({ type: 'new-error', payload: summary });
        } else {
          this.broadcastFn({ type: 'error-updated', payload: summary });
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Error processing detected error', {
        serviceName,
        deploymentId,
        error: message,
      });
    }
  }

  // --- Health Monitor ---

  private checkSubscriptionHealth(): void {
    const now = Date.now();
    const zombieThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [deploymentId, sub] of this.subscriptions) {
      if (sub.status === 'closed') continue;

      const timeSinceLastMessage = now - sub.lastMessageAt;

      if (timeSinceLastMessage > zombieThreshold) {
        logger.warn('Zombie subscription detected', {
          deploymentId,
          serviceName: sub.serviceName,
          lastMessageAt: new Date(sub.lastMessageAt).toISOString(),
          minutesSinceLastMessage: Math.round(timeSinceLastMessage / 60000),
        });

        sub.status = 'zombie';

        // Close and attempt to reopen
        this.reopenSubscription(deploymentId, sub);
      }
    }

    // Sweep stale assemblers for deployment IDs no longer in active subscriptions (F9 fix)
    this.sweepStaleAssemblers();
  }

  private sweepStaleAssemblers(): void {
    const assemblerKeys = getAssemblerKeys();
    for (const deploymentId of assemblerKeys) {
      if (!this.subscriptions.has(deploymentId)) {
        removeAssembler(deploymentId);
        logger.debug('Swept stale assembler', { deploymentId });
      }
    }
  }

  private async reopenSubscription(
    deploymentId: string,
    sub: ActiveSubscription,
  ): Promise<void> {
    // Close existing
    await this.closeSubscription(deploymentId, sub);
    this.subscriptions.delete(deploymentId);

    // Reopen if we have a WS client
    if (this.wsClient && this.running) {
      const deployment: RailwayDeployment = {
        id: deploymentId,
        serviceName: sub.serviceName,
        status: 'SUCCESS',
        staticUrl: null,
        serviceId: '',
        environmentId: '',
        environmentName: '',
      };

      this.openSubscription(deployment);
      logger.info('Reopened zombie subscription', {
        deploymentId,
        serviceName: sub.serviceName,
      });
    }
  }

  // --- Adaptive Discovery Interval ---

  private scheduleDiscovery(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }

    this.discoveryTimer = setInterval(() => {
      this.refreshDeployments();
    }, this.currentDiscoveryIntervalMs);
  }

  private adjustDiscoveryInterval(): void {
    const rateLimitInfo = getRateLimitInfo();

    if (rateLimitInfo.remaining !== null && rateLimitInfo.limit !== null) {
      const remainingPercent = rateLimitInfo.remaining / rateLimitInfo.limit;

      if (remainingPercent < 0.2) {
        // Under 20% remaining — double interval (up to max)
        this.currentDiscoveryIntervalMs = Math.min(
          this.currentDiscoveryIntervalMs * 2,
          this.maxDiscoveryIntervalMs,
        );
        logger.warn('Rate limit low — increasing discovery interval', {
          remaining: rateLimitInfo.remaining,
          limit: rateLimitInfo.limit,
          newIntervalMs: this.currentDiscoveryIntervalMs,
        });
      } else if (remainingPercent > 0.5) {
        // Over 50% remaining — reset to default
        this.currentDiscoveryIntervalMs = this.baseDiscoveryIntervalMs;
      }
    }

    // Reschedule with new interval
    this.scheduleDiscovery();
  }

  private increaseDiscoveryInterval(): void {
    // Exponential backoff: 60s → 120s → 240s → 300s max
    this.currentDiscoveryIntervalMs = Math.min(
      this.currentDiscoveryIntervalMs * 2,
      this.maxDiscoveryIntervalMs,
    );

    logger.info('Discovery interval increased (backoff)', {
      newIntervalMs: this.currentDiscoveryIntervalMs,
    });

    this.scheduleDiscovery();
  }

  // --- Public Getters for Metrics ---

  get activeSubscriptions(): number {
    return this.subscriptions.size;
  }

  get totalLogsProcessed(): number {
    return this._totalLogsProcessed;
  }

  get totalErrorsDetected(): number {
    return this._totalErrorsDetected;
  }

  get lastDiscoveryAt(): number | null {
    return this._lastDiscoveryAt;
  }

  get currentInterval(): number {
    return this.currentDiscoveryIntervalMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  getSubscriptionInfo(): SubscriptionInfo[] {
    const infos: SubscriptionInfo[] = [];
    for (const [, sub] of this.subscriptions) {
      infos.push({
        deploymentId: sub.deploymentId,
        serviceName: sub.serviceName,
        status: sub.status,
        lastMessageAt: sub.lastMessageAt
          ? new Date(sub.lastMessageAt).toISOString()
          : null,
      });
    }
    return infos;
  }
}

// --- Singleton (or null if auto-capture disabled) ---

let logWatcherInstance: LogWatcher | null = null;

export function getLogWatcher(): LogWatcher | null {
  return logWatcherInstance;
}

export function createLogWatcher(): LogWatcher {
  if (logWatcherInstance) return logWatcherInstance;
  logWatcherInstance = new LogWatcher();
  return logWatcherInstance;
}

export async function destroyLogWatcher(): Promise<void> {
  if (logWatcherInstance?.isRunning) {
    await logWatcherInstance.stop();
  }
  logWatcherInstance = null;
}
