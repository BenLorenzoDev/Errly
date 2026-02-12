// ============================================================================
// Errly — Shared TypeScript Types
// Used by both server and client code
// ============================================================================

// --- Severity ---

export type Severity = 'error' | 'warn' | 'fatal';

// --- Error Source ---

export type ErrorSource = 'auto-capture' | 'direct';

// --- Full Error Record ---

export interface ErrlyError {
  id: string;
  serviceName: string;
  deploymentId: string;
  message: string;
  stackTrace: string | null;
  severity: Severity;
  endpoint: string | null;
  rawLog: string;
  source: ErrorSource;
  metadata: Record<string, unknown> | null;
  fingerprint: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  createdAt: number;
}

// --- Error Summary (list view) ---

export interface ErrlyErrorSummary {
  id: string;
  serviceName: string;
  message: string;
  severity: Severity;
  endpoint: string | null;
  fingerprint: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
}

// --- Time Range Filter ---

export type TimeRange = 'last-hour' | 'last-24h' | 'last-7d' | 'last-30d';

// --- Error Filters ---

export interface ErrorFilters {
  service?: string;
  severity?: Severity;
  timeRange?: TimeRange;
  search?: string;
  page?: number;   // default 1
  limit?: number;  // default 50, max 200
}

// --- Settings ---

export interface Settings {
  retentionDays: number;
  serviceAliases: Record<string, string>;
  webhookUrl: string | null;
  railwayApiToken: string;  // masked — last 4 chars only
  integrationToken: string; // full value for display/copy
}

// --- SSE Events (discriminated union) ---

export type SSEEvent =
  | { type: 'new-error'; payload: ErrlyErrorSummary }
  | { type: 'error-updated'; payload: ErrlyErrorSummary }
  | { type: 'error-cleared'; payload: { ids: string[] } }
  | { type: 'bulk-cleared'; payload: Record<string, never> }
  | { type: 'auth-expired'; payload: Record<string, never> };

// --- Service Info ---

export interface ServiceInfo {
  id: string;
  name: string;
  alias?: string;
  deploymentId: string;
  status: string;
}

// --- Dashboard Stats ---

export interface DashboardStats {
  totalErrors: number;
  activeServices: number;
  errorsLastHour: number;
  topService: string | null;
}

// --- Health Status ---

export interface HealthStatus {
  status: string;
  uptime: number;
  dbConnected: boolean;
  autoCaptureEnabled: boolean;
  activeSubscriptions: number;
  sseClients: number;
  lastDiscoveryAt: string | null;
}

// --- Diagnostics Info ---

export interface SubscriptionInfo {
  deploymentId: string;
  serviceName: string;
  status: 'active' | 'zombie' | 'reconnecting' | 'closed';
  lastMessageAt: string | null;
}

export type RailwayApiStatus = 'connected' | 'disconnected' | 'rate-limited' | 'circuit-open';

export interface DiagnosticsInfo {
  subscriptions: SubscriptionInfo[];
  circuitBreaker: string;
  railwayApiRateLimit: {
    remaining: number | null;
    resetsAt: string | null;
  };
  errorsPerMinute: number;
  totalLogsProcessed: number;
  totalErrorsDetected: number;
  memoryUsage: {
    rss: number;
    heapUsed: number;
  };
}

// --- Copy for Claude Payload ---

export type CopyForClaudePayload = string;

// --- Direct Error Payload (POST /api/errors body) ---

export interface DirectErrorPayload {
  service: string;
  message: string;
  stackTrace?: string;
  severity?: Severity;
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

// --- API Response Types ---

export interface ErrorListResponse {
  errors: ErrlyErrorSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  success: boolean;
  retryAfter?: number;
}

export interface DeleteErrorsRequest {
  ids?: string[];
  confirm?: boolean;
}
