// ============================================================================
// Errly — CopyForClaude Component
// Format error for AI debugging. Clipboard API with fallbacks.
// Button states: default -> "Copied!" (2s) -> default, or "Copy failed".
// ============================================================================

import { useState, useCallback, useRef } from 'react';
import type { ErrlyError, ErrlyErrorSummary } from '@shared/types';

interface CopyForClaudeProps {
  error: ErrlyError;
  relatedErrors?: ErrlyErrorSummary[];
}

type CopyState = 'default' | 'copied' | 'failed';

function formatForClaude(
  error: ErrlyError,
  relatedErrors?: ErrlyErrorSummary[],
): string {
  const lines: string[] = [];

  lines.push('[Errly Error Report]');
  lines.push(`Service: ${error.serviceName}`);
  lines.push(`Severity: ${error.severity}`);

  const firstSeen = new Date(error.firstSeenAt).toISOString();
  const lastSeen = new Date(error.lastSeenAt).toISOString();
  lines.push(
    `Occurred: ${error.occurrenceCount} times (first: ${firstSeen}, last: ${lastSeen})`,
  );

  if (error.endpoint) {
    lines.push(`Endpoint: ${error.endpoint}`);
  }

  lines.push(`Error: ${error.message}`);

  if (error.stackTrace) {
    lines.push('Stack trace:');
    // Indent each line of the stack trace
    const traceLines = error.stackTrace.split('\n');
    for (const traceLine of traceLines) {
      lines.push(`  ${traceLine}`);
    }
  }

  if (relatedErrors && relatedErrors.length > 0) {
    lines.push('Related errors from other services in the same timeframe:');
    for (const related of relatedErrors) {
      lines.push(
        `  - ${related.serviceName}: ${related.message} (${related.occurrenceCount} times)`,
      );
    }
  }

  return lines.join('\n');
}

async function copyToClipboard(text: string): Promise<boolean> {
  // Method 1: Clipboard API
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to fallback
  }

  // Method 2: execCommand fallback
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (success) return true;
  } catch {
    // Fall through
  }

  return false;
}

export function CopyForClaude({ error, relatedErrors }: CopyForClaudeProps) {
  const [copyState, setCopyState] = useState<CopyState>('default');
  const [showFallbackText, setShowFallbackText] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formattedText = formatForClaude(error, relatedErrors);

  const handleCopy = useCallback(async () => {
    if (copyState !== 'default') return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const success = await copyToClipboard(formattedText);

    if (success) {
      setCopyState('copied');
      timerRef.current = setTimeout(() => {
        setCopyState('default');
      }, 2000);
    } else {
      setCopyState('failed');
      setShowFallbackText(true);
      timerRef.current = setTimeout(() => {
        setCopyState('default');
      }, 2000);
    }
  }, [formattedText, copyState]);

  const buttonLabel = {
    default: 'Copy for Claude',
    copied: 'Copied!',
    failed: 'Copy failed',
  }[copyState];

  const buttonStyles = {
    default:
      'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500',
    copied:
      'bg-green-600 text-white border-green-500',
    failed:
      'bg-red-600/50 text-red-200 border-red-500',
  }[copyState];

  return (
    <div className="space-y-3">
      <button
        onClick={handleCopy}
        disabled={copyState !== 'default'}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-all ${buttonStyles} disabled:cursor-not-allowed`}
      >
        {copyState === 'default' && (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
        {copyState === 'copied' && (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        {copyState === 'failed' && (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        )}
        {buttonLabel}
      </button>

      {/* Fallback: show text for manual selection */}
      {showFallbackText && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">
            Copy failed -- select text manually:
          </p>
          <textarea
            readOnly
            value={formattedText}
            className="w-full h-48 px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-xs text-slate-300 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
      )}
    </div>
  );
}
