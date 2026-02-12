// ============================================================================
// Errly — Stack Trace Fingerprinting
// Normalizes stack traces and generates SHA-256 fingerprints for error grouping
// ============================================================================

import { createHash } from 'node:crypto';

/**
 * Normalize a stack trace by stripping variable data so that the same logical
 * error groups together even across redeployments (different line numbers,
 * different file paths, different timestamps, etc.).
 *
 * Strips:
 *   - Line numbers and column numbers (e.g., :42:10)
 *   - File paths reduced to basenames (e.g., /app/src/server/index.ts -> index.ts)
 *   - Hex memory addresses (e.g., 0x7fff5fbff8a0)
 *   - Timestamps (ISO 8601, Unix-style, common log formats)
 *   - Request IDs / UUIDs
 *   - PID and thread IDs
 *
 * Keeps:
 *   - Function names
 *   - Error types (TypeError, ReferenceError, etc.)
 *   - General structure of the trace
 */
export function normalizeStackTrace(stack: string): string {
  return stack
    .split('\n')
    .map((line) => {
      let normalized = line;

      // Strip UUIDs / request IDs (before path processing to avoid partial matches)
      // Matches standard UUID format: 8-4-4-4-12 hex chars
      normalized = normalized.replace(
        /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
        '<uuid>'
      );

      // Strip hex memory addresses (e.g., 0x7fff5fbff8a0, 0x0000004)
      normalized = normalized.replace(/0x[0-9a-fA-F]{4,}/g, '<addr>');

      // Strip ISO 8601 timestamps (e.g., 2026-02-11T14:30:00.000Z)
      normalized = normalized.replace(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
        '<timestamp>'
      );

      // Strip common log timestamp formats (e.g., 2026-02-11 14:30:00, 2026/02/11 14:30:00)
      normalized = normalized.replace(
        /\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?/g,
        '<timestamp>'
      );

      // Strip Unix timestamps (10+ digit numbers that look like epoch ms or s)
      normalized = normalized.replace(/\b\d{10,13}\b/g, '<timestamp>');

      // Strip PID / thread IDs (e.g., pid=12345, thread-42, [12345])
      normalized = normalized.replace(/\bpid[=:]\s*\d+/gi, 'pid=<pid>');
      normalized = normalized.replace(/\bthread[-_]?\d+/gi, 'thread-<tid>');

      // Reduce file paths to basenames
      // Unix paths: /app/src/server/utils/fingerprint.ts -> fingerprint.ts
      normalized = normalized.replace(
        /(?:\/[\w.@_-]+)+\/([\w.@_-]+)/g,
        '$1'
      );
      // Windows paths: C:\Users\...\file.ts -> file.ts
      normalized = normalized.replace(
        /(?:[A-Za-z]:\\[\w.@_\- ]+\\)+?([\w.@_-]+)/g,
        '$1'
      );

      // Strip line numbers and column numbers (e.g., :42, :42:10)
      // Match patterns like filename.ts:42:10 or filename.js:100
      normalized = normalized.replace(
        /([\w.-]+\.(?:ts|js|tsx|jsx|py|go|java|rb|rs|cs|cpp|c|mjs|cjs)):\d+(?::\d+)?/g,
        '$1'
      );
      // Also strip standalone :line:col patterns after parentheses
      normalized = normalized.replace(/:\d+:\d+\)/g, ')');
      normalized = normalized.replace(/:\d+\)/g, ')');

      // Strip Node.js internal module line references (e.g., node:internal/modules/cjs/loader:1234)
      normalized = normalized.replace(
        /(node:[\w/]+):\d+(?::\d+)?/g,
        '$1'
      );

      // Strip Go goroutine IDs (goroutine 42)
      normalized = normalized.replace(/goroutine\s+\d+/g, 'goroutine <id>');

      // Strip port numbers in URLs (localhost:3000 -> localhost:<port>)
      normalized = normalized.replace(
        /localhost:\d+/g,
        'localhost:<port>'
      );

      return normalized;
    })
    .join('\n')
    .trim();
}

/**
 * Generate a SHA-256 fingerprint from service name, error message, and
 * optionally a normalized stack trace.
 *
 * The fingerprint uniquely identifies a logical error group. Two errors with
 * the same fingerprint are considered the same error occurring again.
 */
export function generateFingerprint(
  serviceName: string,
  message: string,
  stackTrace?: string | null
): string {
  const normalizedStack = stackTrace ? normalizeStackTrace(stackTrace) : '';

  // Concatenate with a null byte separator to avoid collisions where
  // the end of one field bleeds into the start of another
  const input = [serviceName, message, normalizedStack].join('\0');

  return createHash('sha256').update(input).digest('hex');
}
