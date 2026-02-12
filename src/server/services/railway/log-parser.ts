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

type TraceLanguage = 'nodejs' | 'python' | 'go' | 'java' | 'ruby' | 'rust' | 'php' | 'dotnet' | 'unknown';

// --- Error Pattern Detection ---

const ERROR_MARKERS = [
  /\[ERROR\]/i,
  /\[ERR\]/i,                       // Abbreviated bracket style (e.g. campaign-service)
  /\[FATAL\]/i,
  /\[CRITICAL\]/i,
  /\bERROR:/,
  /\bFATAL:/,
  /\bCRITICAL:/,
  /"level"\s*:\s*"error"/i,         // JSON structured logs
  /"level"\s*:\s*"fatal"/i,
  /"level"\s*:\s*"critical"/i,
  /\blevel=error\b/i,               // Key-value structured logs (logfmt)
  /\blevel=fatal\b/i,
  /\blevel=critical\b/i,
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

const HTTP_4XX_PATTERN = /"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s"]*?)"\s*(4\d{2})/;
const HTTP_4XX_STRUCTURED = /method=(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+path=(\/\S+)\s+status=(4\d{2})/;

const WARNING_PATTERNS = [
  /DeprecationWarning/,
  /ExperimentalWarning/,
  /\bDEPRECATED\b/,
  /slow query/i,
  /query took/i,
];

const WARN_MARKERS = [
  /\[WARN\]/i,
  /\[WRN\]/i,                      // Abbreviated bracket style (e.g. campaign-service)
  /\[WARNING\]/i,
  /\bWARN:/i,
  /\bWARNING:/i,
  /"level"\s*:\s*"warn(ing)?"/i,   // JSON structured logs (Winston, Bunyan, etc.)
  /\blevel=warn(ing)?\b/i,         // Key-value structured logs (logfmt)
];

const INFRA_ERROR_PATTERNS = [
  /\bECONNREFUSED\b/,
  /\bECONNRESET\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  /\bEHOSTUNREACH\b/,
  /\bconnection refused\b/i,
  /\btimed out\b/i,
  /\bdeadline exceeded\b/i,
  /\bpool exhausted\b/i,
  /\btoo many connections\b/i,
  /\bEMFILE\b/,
  /\bENOMEM\b/,
  // Postgres / Supabase
  /\bFATAL:\s+too many connections\b/i,
  /\bFATAL:\s+password authentication failed\b/i,
  /\bFATAL:\s+database .* does not exist\b/i,
  /\bFATAL:\s+role .* does not exist\b/i,
  /\bconnection to server at .* failed\b/i,
  /\bremaining connection slots are reserved\b/i,
  /\bSSL connection has been closed unexpectedly\b/i,
  /\bcould not translate host name\b/i,
  /\bno pg_hba\.conf entry\b/i,
  /\bconnection terminated unexpectedly\b/i,
  /\bprepared statement .* already exists\b/i,
  /\bsupabase.*5[0-9]{2}\b/i,
  // Redis
  /\bRedis connection .* failed\b/i,
  /\bREADONLY You can't write against a read only\b/i,
  /\bNOAUTH Authentication required\b/i,
  // Generic DB/service
  /\bconnection pool timeout\b/i,
  /\bquery timeout\b/i,
  /\bsocket hang up\b/i,
  /\bfetch failed\b/i,
  /\bservice unavailable\b/i,
  /\bgateway timeout\b/i,
  /\bbad gateway\b/i,
];

const PYTHON_ERROR_PATTERNS = [
  /\braise\b/,
  /\bException:/,
  /Traceback \(most recent call last\):/,
];

const JAVA_ERROR_PATTERNS = [
  /Exception in thread/,
  /Caused by:/,
];

const RUBY_ERROR_PATTERNS = [
  /\bRuntimeError\b/,
  /\bNoMethodError\b/,
  /\bArgumentError\b/,
  /\bNameError\b/,
  /\bLoadError\b/,
  /\bActiveRecord::/,
  /\bActionController::/,
];

const RUST_ERROR_PATTERNS = [
  /thread '.*' panicked/,
  /Result::unwrap\(\)/,
  /stack backtrace:/,
];

const PHP_ERROR_PATTERNS = [
  /\bFatal error:/,
  /\bParse error:/,
  /\bPHP Fatal/,
  /\bPHP Warning/,
  /\bPHP Notice/,
  /\bUncaught Exception/,
];

const DOTNET_ERROR_PATTERNS = [
  /System\.\w+Exception/,
  /\bUnhandled exception\b/,
  /\bNullReferenceException\b/,
];

// Info/debug level markers — lines containing these are NOT errors even if
// the bracket prefix says [err] (common with stderr-routed info logs on Railway)
const INFO_LEVEL_OVERRIDES = [
  /\blevel=info\b/i,
  /\blevel=debug\b/i,
  /\blevel=trace\b/i,
  /"level"\s*:\s*"info"/i,
  /"level"\s*:\s*"debug"/i,
  /"level"\s*:\s*"trace"/i,
  /\blevel=INFO\b/,       // Prometheus/Go exact match
  /\bINFO\s+source=/,     // Go-style: `level=INFO source=compact.go`
];

const STACK_TRACE_START_PATTERNS = [
  /^\s+at\s+/,                    // Node.js / Java / .NET
  /^Traceback/,                   // Python
  /^goroutine\s+\d+/,            // Go
  /^panic:/,                      // Go
  /thread '.*' panicked/,         // Rust
  /^stack backtrace:/,            // Rust
  /^Fatal error:/,                // PHP
  /^PHP Fatal/,                   // PHP
  /^Unhandled exception/,         // .NET
];

// --- Endpoint Extraction ---

/** Returns true if the message contains a structured info/debug/trace level
 *  marker, meaning it should NOT be treated as an error even if the outer
 *  bracket prefix or Railway severity says otherwise. */
export function isInfoLevelOverride(message: string): boolean {
  for (const pattern of INFO_LEVEL_OVERRIDES) {
    if (pattern.test(message)) return true;
  }
  return false;
}

export function extractEndpoint(message: string): string | null {
  // Pattern: "METHOD /path" 5xx STATUS
  const match1 = message.match(HTTP_5XX_PATTERN);
  if (match1) {
    return `${match1[1]} ${match1[2]}`;
  }

  // Pattern: "METHOD /path" 4xx STATUS
  const match1b = message.match(HTTP_4XX_PATTERN);
  if (match1b) {
    return `${match1b[1]} ${match1b[2]}`;
  }

  // Pattern: method=GET path=/foo status=500
  const match2 = message.match(HTTP_5XX_STRUCTURED);
  if (match2) {
    return `${match2[1]} ${match2[2]}`;
  }

  // Pattern: method=GET path=/foo status=4xx
  const match2b = message.match(HTTP_4XX_STRUCTURED);
  if (match2b) {
    return `${match2b[1]} ${match2b[2]}`;
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

  for (const pattern of INFRA_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of RUBY_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of RUST_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of PHP_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  for (const pattern of DOTNET_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'error';
  }

  // HTTP 4xx → warn
  if (HTTP_4XX_PATTERN.test(message) || HTTP_4XX_STRUCTURED.test(message)) return 'warn';

  // Warning patterns
  for (const pattern of WARNING_PATTERNS) {
    if (pattern.test(message)) return 'warn';
  }

  for (const pattern of WARN_MARKERS) {
    if (pattern.test(message)) return 'warn';
  }

  return 'error';
}

// --- Error Detection ---

export function isErrorLog(message: string): ParsedLogLine {
  const trimmed = message.trim();

  // Skip lines that contain structured info/debug/trace level markers.
  // These are often info logs routed through stderr and tagged [err] by Railway.
  for (const pattern of INFO_LEVEL_OVERRIDES) {
    if (pattern.test(trimmed)) {
      return {
        isError: false,
        severity: 'error',
        parsedMessage: trimmed,
      };
    }
  }

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

  // Check HTTP 4xx
  if (HTTP_4XX_PATTERN.test(trimmed) || HTTP_4XX_STRUCTURED.test(trimmed)) {
    return {
      isError: true,
      severity: 'warn',
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

  // Check infrastructure errors
  for (const pattern of INFRA_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'error',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check Ruby errors
  for (const pattern of RUBY_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'error',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check Rust errors
  for (const pattern of RUST_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'error',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check PHP errors
  for (const pattern of PHP_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'error',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check .NET errors
  for (const pattern of DOTNET_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'error',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check warning patterns
  for (const pattern of WARNING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'warn',
        parsedMessage: trimmed,
        endpoint: extractEndpoint(trimmed) ?? undefined,
      };
    }
  }

  // Check generic warn markers ([WARN], WARN:, WARNING:, structured logs)
  for (const pattern of WARN_MARKERS) {
    if (pattern.test(trimmed)) {
      return {
        isError: true,
        severity: 'warn',
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
    // Could be Node.js, Java, or .NET
    if (/\(.*\.java:\d+\)/.test(line) || /\(.*\.kt:\d+\)/.test(line)) return 'java';
    if (/\bat\s+\S+\.\S+\(/.test(line) && /System\./.test(line)) return 'dotnet';
    return 'nodejs';
  }
  if (/^Traceback/.test(line) || /^\s+File "/.test(line)) return 'python';
  if (/^goroutine/.test(line) || /^panic:/.test(line)) return 'go';
  if (/Caused by:/.test(line) || /Exception in thread/.test(line)) return 'java';
  if (/from \/.*\.rb:\d+/.test(line) || /RuntimeError|NoMethodError|ActiveRecord::/.test(line)) return 'ruby';
  if (/thread '.*' panicked/.test(line) || /stack backtrace:/.test(line)) return 'rust';
  if (/PHP Fatal|Fatal error:|Parse error:/.test(line)) return 'php';
  if (/System\.\w+Exception/.test(line) || /Unhandled exception/.test(line)) return 'dotnet';
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

  // Ruby: "from /path/to/file.rb:123:in `method'"
  if (language === 'ruby' || /from \//.test(trimmed)) {
    if (/^\s+from \//.test(line)) return true;
  }

  // Rust: "at src/main.rs:42" or numbered backtrace frames
  if (language === 'rust') {
    if (/^\s+at src\//.test(line)) return true;
    if (/^\s+\d+:/.test(line)) return true;
  }

  // PHP: "#0 /path/to/file.php(123):" numbered stack frames
  if (language === 'php') {
    if (/^\s*#\d+\s+/.test(line)) return true;
  }

  // .NET: "at Namespace.Class.Method()" style frames
  if (language === 'dotnet') {
    if (/^\s+at\s+\S+\.\S+/.test(line)) return true;
    if (/^---\s+End of/.test(trimmed)) return true;
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

    // Ruby
    if (/from \/.*\.rb:\d+/.test(trimmed)) return true;

    // Rust
    if (/thread '.*' panicked/.test(trimmed)) return true;
    if (/stack backtrace:/.test(trimmed)) return true;

    // PHP
    if (/^Fatal error:/.test(trimmed)) return true;
    if (/^PHP Fatal/.test(trimmed)) return true;

    // .NET
    if (/^Unhandled exception/.test(trimmed)) return true;
    if (/System\.\w+Exception/.test(trimmed)) return true;

    return false;
  }

  private inferLanguage(message: string): TraceLanguage {
    if (/\w*(Error|TypeError|ReferenceError):/.test(message)) return 'nodejs';
    if (/Traceback/.test(message)) return 'python';
    if (/panic:/.test(message)) return 'go';
    if (/Exception in thread/.test(message)) return 'java';
    if (/RuntimeError|NoMethodError|ActiveRecord::/.test(message)) return 'ruby';
    if (/thread '.*' panicked|Result::unwrap\(\)/.test(message)) return 'rust';
    if (/PHP Fatal|Fatal error:|Parse error:/.test(message)) return 'php';
    if (/System\.\w+Exception|Unhandled exception/.test(message)) return 'dotnet';
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
