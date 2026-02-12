// ============================================================================
// Errly — Railway GraphQL Client with Circuit Breaker (Task 6.1)
// HTTP + WebSocket clients. Circuit breaker (3 states). Distinguishes 401/403
// from 5xx. Rate limit tracking.
// ============================================================================

import { createClient, type Client } from 'graphql-ws';
import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';

// --- Constants ---

const RAILWAY_HTTP_ENDPOINT = 'https://backboard.railway.app/graphql/v2';
const RAILWAY_WS_ENDPOINT = 'wss://backboard.railway.app/graphql/v2';

// --- Circuit Breaker ---

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  authError: boolean;
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures: number = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private readonly threshold: number = 5;
  private readonly resetTimeoutMs: number = 60_000;
  private authError: boolean = false;

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed — transition to HALF_OPEN
      if (this.lastFailureAt && Date.now() - this.lastFailureAt >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker transitioning to HALF_OPEN');
      }
    }
    return this.state;
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      authError: this.authError,
    };
  }

  isOpen(): boolean {
    const current = this.getState();
    return current === 'OPEN';
  }

  isHalfOpen(): boolean {
    return this.getState() === 'HALF_OPEN';
  }

  hasAuthError(): boolean {
    return this.authError;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = Date.now();
    this.lastFailureAt = null;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      logger.info('Circuit breaker CLOSED (recovered)');
    }
  }

  recordFailure(statusCode?: number): void {
    // 401/403 = permanent auth error — do not cycle circuit breaker
    if (statusCode === 401 || statusCode === 403) {
      this.authError = true;
      logger.error('Railway API token rejected (HTTP ' + statusCode + ') — auto-capture disabled. Update the token in Settings.');
      return;
    }

    // 5xx, network errors, timeouts = transient failures
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Single failure in HALF_OPEN → back to OPEN
      this.state = 'OPEN';
      logger.warn('Circuit breaker OPEN (half-open test failed)', {
        consecutiveFailures: this.consecutiveFailures,
      });
      return;
    }

    if (this.consecutiveFailures >= this.threshold) {
      this.state = 'OPEN';
      logger.warn('Circuit breaker OPEN (threshold reached)', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.threshold,
      });
    }
  }

  clearAuthError(): void {
    this.authError = false;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureAt = null;
    this.authError = false;
    logger.info('Circuit breaker reset');
  }
}

export const circuitBreaker = new CircuitBreaker();

// --- Rate Limit Tracking ---

export interface RateLimitInfo {
  remaining: number | null;
  limit: number | null;
  resetsAt: number | null;
}

const rateLimit: RateLimitInfo = {
  remaining: null,
  limit: null,
  resetsAt: null,
};

export function getRateLimitInfo(): RateLimitInfo {
  return { ...rateLimit };
}

function updateRateLimit(headers: Headers): void {
  const remaining = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  const reset = headers.get('x-ratelimit-reset');

  if (remaining !== null) rateLimit.remaining = parseInt(remaining, 10);
  if (limit !== null) rateLimit.limit = parseInt(limit, 10);
  if (reset !== null) rateLimit.resetsAt = parseInt(reset, 10) * 1000; // Convert to ms
}

export function isRateLimited(): boolean {
  if (rateLimit.remaining !== null && rateLimit.remaining <= 0) {
    if (rateLimit.resetsAt && Date.now() < rateLimit.resetsAt) {
      return true;
    }
  }
  return false;
}

// --- HTTP Client ---

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function railwayHttpClient<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<{ data: T; headers: Headers }> {
  // Check circuit breaker
  if (circuitBreaker.isOpen()) {
    throw new RailwayApiError('Circuit breaker is OPEN — request blocked', 0);
  }

  if (circuitBreaker.hasAuthError()) {
    throw new RailwayApiError('Railway API token is invalid — auto-capture disabled', 401);
  }

  // Check rate limit
  if (isRateLimited()) {
    const resetsIn = rateLimit.resetsAt ? Math.max(0, rateLimit.resetsAt - Date.now()) : 0;
    throw new RailwayApiError(
      `Rate limited — resets in ${Math.ceil(resetsIn / 1000)}s`,
      429,
    );
  }

  try {
    const response = await fetch(RAILWAY_HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });

    // Update rate limit tracking from response headers
    updateRateLimit(response.headers);

    if (response.status === 429) {
      circuitBreaker.recordFailure(429);
      const retryAfter = response.headers.get('retry-after');
      throw new RailwayApiError(
        `Rate limited by Railway API${retryAfter ? ` — retry after ${retryAfter}s` : ''}`,
        429,
      );
    }

    if (response.status === 401 || response.status === 403) {
      circuitBreaker.recordFailure(response.status);
      throw new RailwayApiError(
        `Railway API authentication failed (${response.status})`,
        response.status,
      );
    }

    if (!response.ok) {
      circuitBreaker.recordFailure(response.status);
      throw new RailwayApiError(
        `Railway API returned ${response.status}: ${response.statusText}`,
        response.status,
      );
    }

    const body = (await response.json()) as GraphQLResponse<T>;

    if (body.errors && body.errors.length > 0) {
      const errorMessages = body.errors.map((e) => e.message).join('; ');
      logger.warn('GraphQL response contained errors', { errors: errorMessages });

      // Check for auth errors in GraphQL response
      const hasAuthError = body.errors.some(
        (e) => e.message.toLowerCase().includes('unauthorized') ||
               e.message.toLowerCase().includes('forbidden') ||
               e.message.toLowerCase().includes('authentication'),
      );

      if (hasAuthError) {
        circuitBreaker.recordFailure(401);
        throw new RailwayApiError(`GraphQL auth error: ${errorMessages}`, 401);
      }

      // If there's also data, treat as partial success
      if (!body.data) {
        circuitBreaker.recordFailure(500);
        throw new RailwayApiError(`GraphQL error: ${errorMessages}`, 500);
      }
    }

    circuitBreaker.recordSuccess();
    return { data: body.data as T, headers: response.headers };
  } catch (err: unknown) {
    if (err instanceof RailwayApiError) throw err;

    // Network error, timeout, etc.
    const message = err instanceof Error ? err.message : String(err);
    circuitBreaker.recordFailure();
    throw new RailwayApiError(`Railway API request failed: ${message}`, 0);
  }
}

// --- WebSocket Client Factory ---

let activeWsClient: Client | null = null;

export function createWsClient(token: string): Client {
  // Close existing client if any
  if (activeWsClient) {
    try {
      activeWsClient.dispose();
    } catch {
      // Ignore cleanup errors
    }
  }

  const client = createClient({
    url: RAILWAY_WS_ENDPOINT,
    webSocketImpl: class AuthWebSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
      }
    },
    connectionParams: () => ({
      token,
    }),
    retryAttempts: 10,
    retryWait: async (retries: number) => {
      // Exponential backoff: 1s, 2s, 4s, 8s, ..., capped at 60s
      const delay = Math.min(1000 * Math.pow(2, retries), 60_000);
      logger.debug('WebSocket retry wait', { retries, delayMs: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    },
    on: {
      connected: () => {
        logger.info('Railway WebSocket connected');
      },
      closed: (event) => {
        logger.info('Railway WebSocket closed', {
          code: (event as any)?.code,
          reason: (event as any)?.reason,
        });
      },
      error: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Railway WebSocket error', { error: message });
      },
    },
  });

  activeWsClient = client;
  return client;
}

export function getActiveWsClient(): Client | null {
  return activeWsClient;
}

export function disposeWsClient(): void {
  if (activeWsClient) {
    try {
      activeWsClient.dispose();
    } catch {
      // Ignore
    }
    activeWsClient = null;
  }
}

// --- Custom Error Class ---

export class RailwayApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'RailwayApiError';
  }
}
