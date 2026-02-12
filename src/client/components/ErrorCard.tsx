// ============================================================================
// Errly — ErrorCard Component
// Collapsed error summary card with severity indicator, service badge,
// truncated message, endpoint badge, status badge, occurrence count, timestamps.
// ============================================================================

import type { ErrlyErrorSummary, ErrorStatus } from '@shared/types';

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
        border: 'border-l-purple-500/70',
        bg: 'bg-purple-500/10',
        text: 'text-purple-400',
      };
    case 'error':
      return {
        dot: 'bg-red-500',
        border: 'border-l-red-500/70',
        bg: 'bg-red-500/10',
        text: 'text-red-400',
      };
    case 'warn':
      return {
        dot: 'bg-amber-500',
        border: 'border-l-amber-500/70',
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
      };
    default:
      return {
        dot: 'bg-slate-500',
        border: 'border-l-slate-500/70',
        bg: 'bg-slate-500/10',
        text: 'text-slate-400',
      };
  }
}

function statusStyle(status: ErrorStatus): { dot: string; bg: string; text: string; label: string } {
  switch (status) {
    case 'new':
      return { dot: 'bg-blue-400', bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'New' };
    case 'investigating':
      return { dot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Investigating' };
    case 'in-progress':
      return { dot: 'bg-indigo-400', bg: 'bg-indigo-500/10', text: 'text-indigo-400', label: 'In Progress' };
    case 'resolved':
      return { dot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-400', label: 'Resolved' };
    default:
      return { dot: 'bg-slate-400', bg: 'bg-slate-500/10', text: 'text-slate-400', label: status };
  }
}

export function ErrorCard({ error, isNew }: ErrorCardProps) {
  const colors = severityColor(error.severity);
  const stStyle = statusStyle(error.status);
  const isResolved = error.status === 'resolved';

  const handleClick = () => {
    window.location.hash = `#/errors/${error.id}`;
  };

  return (
    <button
      onClick={handleClick}
      className={`card-hover w-full text-left bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600/80 border-l-[3px] ${colors.border} rounded-lg p-4 cursor-pointer group ${isNew ? 'error-new' : ''} ${isResolved ? 'opacity-45' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Severity + Message */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            {/* Service badge */}
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-700/70 rounded-md text-xs font-medium text-slate-300 truncate max-w-[200px]">
              {error.serviceName}
            </span>

            {/* Severity label */}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide ${colors.bg} ${colors.text}`}
            >
              {error.severity}
            </span>

            {/* Endpoint badge */}
            {error.endpoint && (
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 bg-indigo-500/8 border border-indigo-500/15 rounded-md text-[11px] font-mono text-indigo-400 truncate max-w-[220px]">
                {error.endpoint}
              </span>
            )}
          </div>

          {/* Error message (truncated to 2 lines) */}
          <p className="text-sm text-slate-300 leading-relaxed line-clamp-2 group-hover:text-slate-100 transition-colors">
            {error.message}
          </p>
        </div>

        {/* Right: Status + Occurrence + Timestamps */}
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {/* Status badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${stStyle.bg} ${stStyle.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
            {stStyle.label}
          </span>

          {/* Occurrence count */}
          {error.occurrenceCount > 1 && (
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-700/50 rounded-full text-[11px] font-medium text-slate-400 tabular-nums">
              {error.occurrenceCount.toLocaleString()}x
            </span>
          )}

          {/* Timestamps */}
          <div className="text-[11px] text-slate-500 text-right">
            <span title={new Date(error.lastSeenAt).toISOString()}>
              {formatRelativeTime(error.lastSeenAt)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
