// ============================================================================
// Errly — Structured JSON Logger
// Outputs JSON to stdout for Railway log capture
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  // debug level only outputs in development
  if (level === 'debug' && process.env.NODE_ENV !== 'development') {
    return;
  }

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  // All output to stdout as JSON — Railway captures stdout automatically
  process.stdout.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    writeLog('debug', message, context);
  },

  info(message: string, context?: Record<string, unknown>): void {
    writeLog('info', message, context);
  },

  warn(message: string, context?: Record<string, unknown>): void {
    writeLog('warn', message, context);
  },

  error(message: string, context?: Record<string, unknown>): void {
    writeLog('error', message, context);
  },
};
