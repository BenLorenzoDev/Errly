// ============================================================================
// Errly — Log Parser Service (Task 5.2)
// Error pattern detection + StackTraceAssembler state machine
// Per-deployment assembler instances. 2000ms timeout. 100-line buffer max.
// Handles Node.js, Python, Go, Java stack traces. Endpoint extraction.
// ============================================================================

import { logger } from '../../utils/logger.js';

// --- Types ---

export interface ParsedLogLine {
  isError: boolean;
  severity: 'error' | 'warn' | 'fatal';
  parsedMessage: string;
  endpoint?: string;
}

export interface CompleteError {
  message: string;
  stackTrace: string;
  severity: 'error' | 'warn' | 'fatal';
  endpoint: string | null;
  rawLog: string;
}

type AssemblerState = 'IDLE' | 'COLLECTING' | 'DONE';

type TraceLanguage = 'nodejs' | 'python' | 'go' | 'java' | 'unknown';

// --- Error Pattern Detection ---

const ERROR_MARKERS = [
  /\[ERROR\]/i,
  /\[FATAL\]/i,
  /\[CRITICAL\]/i,
  /\bERROR:/,
  /\bFATAL:/,
  /\bCRITICAL:/,
];

const UNCAUGHT_PATTERNS = [
  /\bError:/,
  /\bTypeError:/,
  /\bReferenceError:/,
  /\bSyntaxError:/,
  /\bRangeError:/,
  /\bURIError:/,
  /\bEvalError:/,
  /\bUnhandled/i,
  /\buncaughtException/i,
  /\bunhandledRejection/i,
];

const FATAL_PATTERNS = [
  /\bpanic:/i,
  /\bSIGTERM\b/,
  /\bSIGSEGV\b/,
  /\bSIGABRT\b/,
  /\bOOM\b/i,
  /\bout of memory\b/i,
  /\bkilled\b/i,
  /\bFATAL\b/,
  /\bCRITICAL\b/,
];

const EXIT_CODE_PATTERNS = [
  /exit code [1-9]\d*/i,
  /exited with code [1-9]\d*/i,
  /process exited/i,
];

const HTTP_5XX_PATTERN = /"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s"]*?)"\s*(5\d{2})/;
const HTTP_5XX_STRUCTURED = /method=(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+path=(\/\S+)\s+status=(5\d{2})/;
const HTTP_ENDPOINT_FAILED = /(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S+)\s+failed/i;

const PYTHON_ERROR_PATTERNS = [
  /\braise\b/,
  /\bException:/,
  /Traceback \(most recent call last\):/,
];

const JAVA_ERROR_PATTERNS = [
  /Exception in thread/,
  /Caused by:/,
];

const STACK_TRACE_START_PATTERNS = [
  /^\s+at\s+/,           // Node.js / Java
  /^Traceback/,          // Python
  /^goroutine\s+\d+/,   // Go
  /^panic:/,             // Go
];

// --- Endpoint Extraction ---

export function extractEndpoint(message: string): string | null {
  // Pattern: "METHOD /path" STATUS
  const match1 = message.match(HTTP_5XX_PATTERN);
  if (match1) {
    return `${match1[1]} ${match1[2]}`;
  }

  // Pattern: method=GET path=/foo status=500
  const match2 = message.match(HTTP_5XX_STRUCTURED);
  if (match2) {
    return `${match2[1]} ${match2[2]}`;
  }

  // Pattern: POST /api/... failed
  const match3 = message.match(HTTP_ENDPOINT_FAILED);
  if (match3) {
    return `${match3[1]} ${match3[2]}`;
  }

  // Generic HTTP method + path pattern (broader match)
  const genericMatch = message.match(/"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s"]*?)"/);
  if (genericMatch) {
    return `${genericMatch[1]} ${genericMatch[2]}`;
  }

  return null;
}

// --- Severity Classification ---

function classifySeverity(message: string): 'error' | 'warn' | 'fatal' {
  for (const pattern of FATAL_PATTERNS) {
    if (pattern.test(message)) return 'fatal';
  }

  if (/\[FATAL\]/i.test(message) || /\bFATAL:/i.test(message)) return 'fatal';

  for (const pattern of ERROR_MARKERS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of UNCAUGHT_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of EXIT_CODE_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  if (HTTP_5XX_PATTERN.test(message) || HTTP_5XX_STRUCTURED.test(message)) return 'error';

  for (const pattern of PYTHON_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of JAVA_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  if (/\[WARN\]/i.test(message) || /\bWARN:/i.test(message) || /\bWARNING:/i.test(message)) {
    return 'warn';
  }

  return 'error';
}

// --- Error Detection ---

export function isErrorLog(message: string): ParsedLogLine {
  const trimmed = message.trim();

  // Check stack trace start patterns
  for (const pattern of STACK_TRACE_START_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: classifySeverity(trimmed),
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check explicit error markers
  for (const pattern of ERROR_MARKERS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: classifySeverity(trimmed),
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check uncaught exception patterns
  for (const pattern of UNCAUGHT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: classifySeverity(trimmed),
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check HTTP 5xx
  if (HTTP_5XX_PATTERN.test(trimmed) || HTTP_5XX_STRUCTURED.test(trimmed)) {
    return {
      isError: true,
      severity: 'error',
      parsedMessage: trimmed,
      endpoint: extractEndpoint(trimmed) ?? undefined,
    };
  }

  // Check exit codes
  for (const pattern of EXIT_CODE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: classifySeverity(trimmed),
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check Python errors
  for (const pattern of PYTHON_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: classifySeverity(trimmed),
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check Java errors
  for (const pattern of JAVA_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: classifySeverity(trimmed),
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check fatal patterns
  for (const pattern of FATAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'fatal',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  return {
    isError: false,
    severity: 'error',
    parsedMessage: trimmed,
  };
}

// --- Detect trace language from a line ---

function detectTraceLanguage(line: string): TraceLanguage {
  if (/^\s+at\s+/.test(line)) {
    // Could be Node.js or Java — distinguish by parens content
    if (/\(.*\.java:\d+\)/.test(line) || /\(.*\.kt:\d+\)/.test(line)) return 'java';
    return 'nodejs';
  }
  if (/^Traceback/.test(line) || /^\s+File "/.test(line)) return 'python';
  if (/^goroutine/.test(line) || /^panic:/.test(line)) return 'go';
  if (/Caused by:/.test(line) || /Exception in thread/.test(line)) return 'java';
  return 'unknown';
}

// --- Check if a line continues a stack trace ---

function isStackTraceContinuation(line: string, language: TraceLanguage): boolean {
  const trimmed = line.trimStart();

  // Node.js: "    at ..."
  if (/^\s+at\s+/.test(line)) return true;

  // Python: "  File ..." or "    ..." (indented continuation) or "...Error:" at end
  if (language === 'python') {
    if (/^\s+File "/.test(line)) return true;
    if (/^\s+/.test(line) && trimmed.length > 0) return true;
    if (/\w+Error:/.test(trimmed)) return true;
    if (/\w+Exception:/.test(trimmed)) return true;
  }

  // Go: goroutine continuation lines are indented or have specific patterns
  if (language === 'go') {
    if (/^\s+/.test(line) && trimmed.length > 0) return true;
    if (/^goroutine/.test(trimmed)) return true;
    if (/^\t/.test(line)) return true;
    // Go stack frames: path/to/file.go:123 +0x...
    if (/\.go:\d+/.test(trimmed)) return true;
  }

  // Java: "    at ...", "Caused by:", "... N more"
  if (language === 'java' || /Caused by:/.test(trimmed) || /^\s+\.\.\.\s+\d+\s+more/.test(line)) {
    if (/^\s+at\s+/.test(line)) return true;
    if (/Caused by:/.test(trimmed)) return true;
    if (/^\s+\.\.\.\s+\d+\s+more/.test(line)) return true;
  }

  // Node.js Error.cause chains
  if (/\[cause\]:/.test(trimmed)) return true;
  if (/Caused by:/.test(trimmed)) return true;

  // Generic: indented lines that look like stack frames
  if (/^\s{2,}/.test(line) && trimmed.length > 0) {
    // But not if it looks like a normal log line with a timestamp
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;
    if (/^\[/.test(trimmed) && /\]/.test(trimmed)) return false;
    return true;
  }

  return false;
}

// --- StackTraceAssembler State Machine ---

const MAX_BUFFER_LINES = 100;
const ASSEMBLY_TIMEOUT_MS = 2000;

export class StackTraceAssembler {
  private state: AssemblerState = 'IDLE';
  private buffer: string[] = [];
  private errorMessage: string = '';
  private severity: 'error' | 'warn' | 'fatal' = 'error';
  private endpoint: string | null = null;
  private rawLogFirstLine: string = '';
  private language: TraceLanguage = 'unknown';
  private lastLineTimestamp: number = 0;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private onComplete: ((error: CompleteError) => void) | null = null;

  constructor(private deploymentId: string) {}

  setCompletionHandler(handler: (error: CompleteError) => void): void {
    this.onComplete = handler;
  }

  feed(message: string, timestamp: number): CompleteError | null {
    const now = timestamp || Date.now();

    // Check if we're collecting and the timeout has been exceeded by the time of the new line
    if (this.state === 'COLLECTING' && this.lastLineTimestamp > 0) {
      const gap = now - this.lastLineTimestamp;
      if (gap > ASSEMBLY_TIMEOUT_MS) {
        // Timeout — flush current assembly
        const completed = this.flush();
        // Dispatch completed trace via onComplete so it's not lost
        if (completed && this.onComplete) {
          this.onComplete(completed);
        }
        // Then process this new line from IDLE state
        return this.processFromIdle(message, now);
      }
    }

    if (this.state === 'IDLE') {
      return this.processFromIdle(message, now);
    }

    if (this.state === 'COLLECTING') {
      return this.processWhileCollecting(message, now);
    }

    return null;
  }

  private processFromIdle(message: string, timestamp: number): CompleteError | null {
    const parsed = isErrorLog(message);
    if (!parsed.isError) return null;

    // Detect if this is the start of a multi-line stack trace
    const language = detectTraceLanguage(message);
    const isTraceStart = this.isStackTraceEntry(message);

    if (isTraceStart) {
      // Start collecting
      this.state = 'COLLECTING';
      this.buffer = [message];
      this.errorMessage = parsed.parsedMessage;
      this.severity = parsed.severity;
      this.endpoint = parsed.endpoint ?? extractEndpoint(message);
      this.rawLogFirstLine = message;
      this.language = language !== 'unknown' ? language : this.inferLanguage(message);
      this.lastLineTimestamp = timestamp;
      this.resetTimeout();
      return null;
    }

    // Single-line error — return immediately
    return {
      message: parsed.parsedMessage,
      stackTrace: message,
      severity: parsed.severity,
      endpoint: parsed.endpoint ?? extractEndpoint(message),
      rawLog: message,
    };
  }

  private processWhileCollecting(message: string, timestamp: number): CompleteError | null {
    // Check if this line continues the stack trace
    if (isStackTraceContinuation(message, this.language)) {
      if (this.buffer.length >= MAX_BUFFER_LINES) {
        // Buffer full — flush
        return this.flush();
      }
      this.buffer.push(message);
      this.lastLineTimestamp = timestamp;
      this.resetTimeout();

      // Update endpoint if we detect one in continuation
      if (!this.endpoint) {
        this.endpoint = extractEndpoint(message);
      }

      return null;
    }

    // Check if this is a new error entry (not continuation) — also check error.cause chains
    if (/\[cause\]:/.test(message) || (/Caused by:/.test(message) && this.language !== 'unknown')) {
      if (this.buffer.length < MAX_BUFFER_LINES) {
        this.buffer.push(message);
        this.lastLineTimestamp = timestamp;
        this.resetTimeout();
        return null;
      }
    }

    // Not a continuation — flush current trace and process this line from IDLE
    const completed = this.flush();

    // Dispatch the completed trace via onComplete so it's not lost
    if (completed && this.onComplete) {
      this.onComplete(completed);
    }

    // Process the new line from IDLE state
    return this.processFromIdle(message, timestamp);
  }

  private isStackTraceEntry(message: string): boolean {
    const trimmed = message.trim();

    // Node.js / JS errors
    if (/\w*(Error|Exception):/.test(trimmed)) return true;
    if (/^\s+at\s+/.test(trimmed)) return true;
    if (/^Uncaught/.test(trimmed)) return true;
    if (/^unhandledRejection/.test(trimmed)) return true;

    // Python
    if (/^Traceback/.test(trimmed)) return true;

    // Go
    if (/^panic:/.test(trimmed)) return true;
    if (/^goroutine\s+\d+/.test(trimmed)) return true;

    // Java
    if (/^Exception in thread/.test(trimmed)) return true;

    return false;
  }

  private inferLanguage(message: string): TraceLanguage {
    if (/\w*(Error|TypeError|ReferenceError):/.test(message)) return 'nodejs';
    if (/Traceback/.test(message)) return 'python';
    if (/panic:/.test(message)) return 'go';
    if (/Exception in thread/.test(message)) return 'java';
    return 'unknown';
  }

  flush(): CompleteError | null {
    if (this.state !== 'COLLECTING' || this.buffer.length === 0) {
      this.reset();
      return null;
    }

    this.clearTimeout();

    const result: CompleteError = {
      message: this.errorMessage,
      stackTrace: this.buffer.join('\n'),
      severity: this.severity,
      endpoint: this.endpoint,
      rawLog: this.rawLogFirstLine,
    };

    this.reset();

    // NOTE: Do NOT call onComplete here — callers handle the return value.
    // onComplete is only used for timeout-initiated flushes (see resetTimeout).
    return result;
  }

  private reset(): void {
    this.state = 'IDLE';
    this.buffer = [];
    this.errorMessage = '';
    this.severity = 'error';
    this.endpoint = null;
    this.rawLogFirstLine = '';
    this.language = 'unknown';
    this.lastLineTimestamp = 0;
    this.clearTimeout();
  }

  private resetTimeout(): void {
    this.clearTimeout();
    // Save onComplete ref before timeout fires (flush resets state)
    const handler = this.onComplete;
    this.timeoutHandle = setTimeout(() => {
      if (this.state === 'COLLECTING') {
        const result = this.flush();
        if (result && handler) {
          handler(result);
        }
      }
    }, ASSEMBLY_TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  isCollecting(): boolean {
    return this.state === 'COLLECTING';
  }

  destroy(): void {
    this.clearTimeout();
    this.reset();
  }
}

// --- Per-deployment assembler management ---

const assemblers = new Map<string, StackTraceAssembler>();

export function getAssembler(deploymentId: string): StackTraceAssembler {
  let assembler = assemblers.get(deploymentId);
  if (!assembler) {
    assembler = new StackTraceAssembler(deploymentId);
    assemblers.set(deploymentId, assembler);
    logger.debug('Created new StackTraceAssembler', { deploymentId });
  }
  return assembler;
}

export function removeAssembler(deploymentId: string): void {
  const assembler = assemblers.get(deploymentId);
  if (assembler) {
    assembler.destroy();
    assemblers.delete(deploymentId);
    logger.debug('Removed StackTraceAssembler', { deploymentId });
  }
}

export function clearAllAssemblers(): void {
  for (const [, assembler] of assemblers) {
    assembler.destroy();
  }
  assemblers.clear();
}

export function getAssemblerKeys(): Set<string> {
  return new Set(assemblers.keys());
}
