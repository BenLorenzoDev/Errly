// ============================================================================
// Errly — ErrorCard Component
// Collapsed error summary card with severity indicator, service badge,
// truncated message, endpoint badge, occurrence count, timestamps.
// ============================================================================

import type { ErrlyErrorSummary } from '@shared/types';

interface ErrorCardProps {
  error: ErrlyErrorSummary;
  isNew?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function severityColor(severity: string): {
  dot: string;
  border: string;
  bg: string;
  text: string;
} {
  switch (severity) {
    case 'fatal':
      return {
        dot: 'bg-purple-500',
        border: 'border-l-purple-500',
        bg: 'bg-purple-500/10',
        text: 'text-purple-400',
      };
    case 'error':
      return {
        dot: 'bg-red-500',
        border: 'border-l-red-500',
        bg: 'bg-red-500/10',
        text: 'text-red-400',
      };
    case 'warn':
      return {
        dot: 'bg-amber-500',
        border: 'border-l-amber-500',
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
      };
    default:
      return {
        dot: 'bg-slate-500',
        border: 'border-l-slate-500',
        bg: 'bg-slate-500/10',
        text: 'text-slate-400',
      };
  }
}

export function ErrorCard({ error, isNew }: ErrorCardProps) {
  const colors = severityColor(error.severity);

  const handleClick = () => {
    window.location.hash = `#/errors/${error.id}`;
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left bg-slate-800 hover:bg-slate-800/80 border border-slate-700 border-l-4 ${colors.border} rounded-lg p-4 transition-all cursor-pointer group ${isNew ? 'error-new' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Severity + Message */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {/* Severity dot */}
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.dot}`}
              title={error.severity}
            />

            {/* Service badge */}
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-700 rounded text-xs font-medium text-slate-300 truncate max-w-[200px]">
              {error.serviceName}
            </span>

            {/* Severity label */}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}
            >
              {error.severity}
            </span>

            {/* Endpoint badge */}
            {error.endpoint && (
              <span className="inline-flex items-center px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-xs font-mono text-indigo-400 truncate max-w-[250px]">
                {error.endpoint}
              </span>
            )}
          </div>

          {/* Error message (truncated to 2 lines) */}
          <p className="text-sm text-slate-200 line-clamp-2 group-hover:text-slate-100 transition-colors">
            {error.message}
          </p>
        </div>

        {/* Right: Occurrence count + Timestamps */}
        <div className="shrink-0 text-right space-y-1">
          {/* Occurrence count */}
          {error.occurrenceCount > 1 && (
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-700 rounded-full text-xs font-medium text-slate-300 tabular-nums">
              x{error.occurrenceCount.toLocaleString()}
            </span>
          )}

          {/* Timestamps */}
          <div className="text-xs text-slate-500 space-y-0.5">
            <div title={new Date(error.lastSeenAt).toISOString()}>
              {formatRelativeTime(error.lastSeenAt)}
            </div>
            {error.occurrenceCount > 1 && (
              <div
                className="text-slate-600"
                title={`First seen: ${new Date(error.firstSeenAt).toISOString()}`}
              >
                first {formatRelativeTime(error.firstSeenAt)}
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
