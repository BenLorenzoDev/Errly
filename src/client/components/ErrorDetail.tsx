// ============================================================================
// Errly — ErrorDetail Component
// Full error view: message, service, endpoint, severity, occurrence timeline,
// stack trace code block, raw log, source badge, metadata, CopyForClaude,
// related errors. Fetches error independently via GET /api/errors/:id.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useErrors } from '../hooks/useErrors';
import { CopyForClaude } from './CopyForClaude';
import type { ErrlyError, ErrlyErrorSummary, ErrorStatus } from '@shared/types';

const STATUS_OPTIONS: { value: ErrorStatus; label: string; dot: string; activeBg: string; activeText: string; activeBorder: string }[] = [
  { value: 'new', label: 'New', dot: 'bg-blue-400', activeBg: 'bg-blue-500/15', activeText: 'text-blue-300', activeBorder: 'border-blue-500/30' },
  { value: 'investigating', label: 'Investigating', dot: 'bg-amber-400', activeBg: 'bg-amber-500/15', activeText: 'text-amber-300', activeBorder: 'border-amber-500/30' },
  { value: 'in-progress', label: 'In Progress', dot: 'bg-indigo-400', activeBg: 'bg-indigo-500/15', activeText: 'text-indigo-300', activeBorder: 'border-indigo-500/30' },
  { value: 'resolved', label: 'Resolved', dot: 'bg-green-400', activeBg: 'bg-green-500/15', activeText: 'text-green-300', activeBorder: 'border-green-500/30' },
];

interface ErrorDetailProps {
  errorId: string;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

function severityStyles(severity: string): {
  bg: string;
  text: string;
  border: string;
} {
  switch (severity) {
    case 'fatal':
      return {
        bg: 'bg-purple-500/10',
        text: 'text-purple-400',
        border: 'border-purple-500/20',
      };
    case 'error':
      return {
        bg: 'bg-red-500/10',
        text: 'text-red-400',
        border: 'border-red-500/20',
      };
    case 'warn':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        border: 'border-amber-500/20',
      };
    default:
      return {
        bg: 'bg-slate-500/10',
        text: 'text-slate-400',
        border: 'border-slate-500/20',
      };
  }
}

export function ErrorDetail({ errorId }: ErrorDetailProps) {
  const [error, setError] = useState<ErrlyError | null>(null);
  const [relatedErrors, setRelatedErrors] = useState<ErrlyErrorSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const { updateStatus } = useErrors();

  const loadError = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const data = await api.get<ErrlyError>(`/api/errors/${errorId}`);
      setError(data);
      // Fetch related errors
      try {
        const related = await api.get<ErrlyErrorSummary[]>(
          `/api/errors/${errorId}/related`,
        );
        setRelatedErrors(related);
      } catch {
        // Related errors are non-critical
      }
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'Failed to load error',
      );
    } finally {
      setIsLoading(false);
    }
  }, [errorId]);

  useEffect(() => {
    loadError();
  }, [loadError]);

  const handleStatusChange = useCallback(async (newStatus: ErrorStatus) => {
    if (!error || error.status === newStatus || statusUpdating) return;
    setStatusUpdating(true);
    try {
      await updateStatus(error.id, newStatus);
      setError((prev) => prev ? { ...prev, status: newStatus, statusChangedAt: Date.now() } : prev);
    } catch {
      // silent — the list will still update via SSE
    } finally {
      setStatusUpdating(false);
    }
  }, [error, statusUpdating, updateStatus]);

  const handleBack = () => {
    history.back();
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-6 space-y-4">
          <div className="skeleton w-3/4 h-6 rounded" />
          <div className="skeleton w-1/2 h-4 rounded" />
          <div className="skeleton w-full h-32 rounded" />
          <div className="skeleton w-2/3 h-4 rounded" />
        </div>
      </div>
    );
  }

  // Error state
  if (fetchError || !error) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="bg-red-500/8 border border-red-500/15 rounded-xl p-8 text-center">
          <p className="text-red-400 mb-4">
            {fetchError ?? 'Error not found'}
          </p>
          <button
            onClick={loadError}
            className="px-4 py-2 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const sevStyles = severityStyles(error.severity);
  const metadata = error.metadata
    ? typeof error.metadata === 'string'
      ? JSON.parse(error.metadata)
      : error.metadata
    : null;

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        onClick={handleBack}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to errors
      </button>

      {/* Main error card */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex-1 min-w-0">
              {/* Badges row */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {/* Severity badge */}
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${sevStyles.bg} ${sevStyles.text} border ${sevStyles.border}`}
                >
                  {error.severity}
                </span>

                {/* Service badge */}
                <span className="inline-flex items-center px-2.5 py-1 bg-slate-700/60 rounded-md text-xs font-medium text-slate-300">
                  {error.serviceName}
                </span>

                {/* Source badge */}
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${
                    error.source === 'auto-capture'
                      ? 'bg-indigo-500/8 text-indigo-400 border border-indigo-500/15'
                      : 'bg-cyan-500/8 text-cyan-400 border border-cyan-500/15'
                  }`}
                >
                  {error.source === 'auto-capture'
                    ? 'Auto-captured'
                    : 'Direct'}
                </span>

                {/* Endpoint badge */}
                {error.endpoint && (
                  <span className="inline-flex items-center px-2.5 py-1 bg-indigo-500/8 border border-indigo-500/15 rounded-md text-xs font-mono text-indigo-400">
                    {error.endpoint}
                  </span>
                )}
              </div>

              {/* Error message */}
              <h2 className="text-lg font-medium text-slate-100 break-words leading-relaxed">
                {error.message}
              </h2>

              {/* Status segmented control */}
              <div className="segmented-control mt-4">
                {STATUS_OPTIONS.map((opt) => {
                  const isActive = error.status === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleStatusChange(opt.value)}
                      disabled={statusUpdating}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-all ${
                        isActive
                          ? `${opt.activeBg} ${opt.activeText} border ${opt.activeBorder}`
                          : 'text-slate-500 hover:text-slate-300 border border-transparent'
                      } ${statusUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? opt.dot : 'bg-slate-600'}`} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CopyForClaude */}
            <div className="shrink-0">
              <CopyForClaude
                error={error}
                relatedErrors={relatedErrors}
              />
            </div>
          </div>

          {/* Occurrence timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="stat-card rounded-lg p-3.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">Occurrences</p>
              <p className="text-xl font-bold text-slate-100 tabular-nums">
                {error.occurrenceCount.toLocaleString()}
              </p>
            </div>
            <div className="stat-card rounded-lg p-3.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">First seen</p>
              <p
                className="text-sm font-medium text-slate-200"
                title={new Date(error.firstSeenAt).toISOString()}
              >
                {formatTimestamp(error.firstSeenAt)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatRelativeTime(error.firstSeenAt)}
              </p>
            </div>
            <div className="stat-card rounded-lg p-3.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">Last seen</p>
              <p
                className="text-sm font-medium text-slate-200"
                title={new Date(error.lastSeenAt).toISOString()}
              >
                {formatTimestamp(error.lastSeenAt)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatRelativeTime(error.lastSeenAt)}
              </p>
            </div>
          </div>
        </div>

        {/* Stack trace */}
        {error.stackTrace && (
          <div className="p-6 border-b border-slate-700/50">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Stack Trace
            </h3>
            <pre className="code-block rounded-lg p-4 overflow-x-auto text-xs text-slate-300 leading-relaxed max-h-96 overflow-y-auto">
              <code>{error.stackTrace}</code>
            </pre>
          </div>
        )}

        {/* Raw log */}
        {error.rawLog && (
          <div className="p-6 border-b border-slate-700/50">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Raw Log
            </h3>
            <pre className="code-block rounded-lg p-4 overflow-x-auto text-xs text-slate-300 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              <code>{error.rawLog}</code>
            </pre>
          </div>
        )}

        {/* Metadata */}
        {metadata && Object.keys(metadata).length > 0 && (
          <div className="p-6 border-b border-slate-700/50">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Metadata
            </h3>
            <div className="bg-slate-900/40 border border-slate-700/50 rounded-lg p-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(metadata as Record<string, unknown>).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                        {key}
                      </dt>
                      <dd className="text-sm text-slate-300 mt-0.5 break-words font-mono">
                        {typeof value === 'object'
                          ? JSON.stringify(value, null, 2)
                          : String(value)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          </div>
        )}

        {/* Additional info */}
        <div className="p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Details
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Error ID</dt>
              <dd className="text-sm text-slate-300 font-mono mt-0.5">
                {error.id}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Fingerprint</dt>
              <dd className="text-sm text-slate-300 font-mono mt-0.5 truncate" title={error.fingerprint}>
                {error.fingerprint}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Deployment ID</dt>
              <dd className="text-sm text-slate-300 font-mono mt-0.5">
                {error.deploymentId || '--'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Created</dt>
              <dd className="text-sm text-slate-300 mt-0.5">
                {formatTimestamp(error.createdAt)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Related errors */}
      {relatedErrors.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl overflow-hidden">
          <div className="p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Related Errors from Other Services
              <span className="text-[11px] text-slate-600 font-normal normal-case tracking-normal ml-2">
                (within 5-minute window)
              </span>
            </h3>
            <div className="space-y-2">
              {relatedErrors.map((related) => {
                const relSev = severityStyles(related.severity);
                return (
                  <a
                    key={related.id}
                    href={`#/errors/${related.id}`}
                    className="card-hover block bg-slate-900/40 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600/60"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold uppercase ${relSev.bg} ${relSev.text}`}
                      >
                        {related.severity}
                      </span>
                      <span className="text-xs font-medium text-slate-300">
                        {related.serviceName}
                      </span>
                      {related.endpoint && (
                        <span className="text-xs font-mono text-indigo-400">
                          {related.endpoint}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 ml-auto tabular-nums">
                        {related.occurrenceCount}x
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 truncate">
                      {related.message}
                    </p>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
