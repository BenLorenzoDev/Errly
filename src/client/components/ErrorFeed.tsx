// ============================================================================
// Errly — ErrorFeed Component
// Error list with FilterBar, ErrorCards. Three UI states: Loading, Empty, Error.
// Pagination. New error highlight animation.
// ============================================================================

import { useCallback } from 'react';
import { useErrorsContext } from '../App';
import { useErrors } from '../hooks/useErrors';
import { FilterBar } from './FilterBar';
import { ErrorCard } from './ErrorCard';

export function ErrorFeed() {
  const { state } = useErrorsContext();
  const { fetchErrors, clearFilters, setFilter } = useErrors();

  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  const currentPage = state.page;

  const handleRetry = useCallback(() => {
    fetchErrors();
  }, [fetchErrors]);

  const handlePageChange = useCallback(
    (page: number) => {
      setFilter('page', page);
    },
    [setFilter],
  );

  // Check if any filters are active
  const hasActiveFilters =
    state.filters.service ||
    state.filters.severity ||
    state.filters.status ||
    state.filters.timeRange ||
    state.filters.search;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <FilterBar />

      {/* Error state: API fetch failed */}
      {state.error && (
        <div className="bg-red-500/8 border border-red-500/15 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-red-400">
            <svg
              className="w-5 h-5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm">
              Failed to load errors: {state.error}
            </span>
          </div>
          <button
            onClick={handleRetry}
            className="px-3.5 py-1.5 text-sm bg-red-500/15 hover:bg-red-500/25 text-red-300 rounded-lg transition-colors font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state: Skeleton placeholders */}
      {state.isLoading && state.errors.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-slate-800/80 border border-slate-700/60 border-l-[3px] border-l-slate-600/50 rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="skeleton w-20 h-5 rounded-md" />
                    <div className="skeleton w-14 h-5 rounded-md" />
                  </div>
                  <div className="skeleton w-full h-4 rounded" />
                  <div className="skeleton w-3/5 h-4 rounded" />
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="skeleton w-20 h-5 rounded-full" />
                  <div className="skeleton w-10 h-4 rounded-full" />
                  <div className="skeleton w-12 h-3 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!state.isLoading && !state.error && state.errors.length === 0 && (
        <div className="text-center py-20">
          {hasActiveFilters ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/60 mb-5 shadow-lg shadow-black/10">
                <svg
                  className="w-8 h-8 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-200 mb-1.5">
                No errors match your filters
              </h3>
              <p className="text-sm text-slate-500 mb-5">
                Try adjusting or clearing your filters to see more results.
              </p>
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-500/10"
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 mb-5 shadow-lg shadow-green-500/5">
                <svg
                  className="w-8 h-8 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-200 mb-1.5">
                All clear! No errors detected.
              </h3>
              <p className="text-sm text-slate-500">
                Errors will appear here in real-time as they are captured.
              </p>
            </>
          )}
        </div>
      )}

      {/* Error cards */}
      {state.errors.length > 0 && (
        <div className="space-y-2">
          {state.errors.map((error) => (
            <ErrorCard
              key={error.id}
              error={error}
              isNew={state.newErrorIds.has(error.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {state.total > state.limit && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
          <p className="text-sm text-slate-500 tabular-nums">
            Showing {(currentPage - 1) * state.limit + 1}--
            {Math.min(currentPage * state.limit, state.total)} of{' '}
            {state.total.toLocaleString()} errors
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 text-sm bg-slate-800/80 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/80 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            {/* Page numbers */}
            {generatePageNumbers(currentPage, totalPages).map((page, i) =>
              page === null ? (
                <span key={`ellipsis-${i}`} className="px-2 text-slate-600">
                  ...
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    page === currentPage
                      ? 'bg-indigo-500/20 text-indigo-300 font-medium shadow-sm'
                      : 'bg-slate-800/80 border border-slate-700/60 text-slate-400 hover:text-slate-300 hover:bg-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  {page}
                </button>
              ),
            )}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-sm bg-slate-800/80 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/80 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Generate an array of page numbers with ellipsis gaps. */
function generatePageNumbers(
  current: number,
  total: number,
): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | null)[] = [];

  // Always show first page
  pages.push(1);

  if (current > 3) {
    pages.push(null); // ellipsis
  }

  // Show pages around current
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push(null); // ellipsis
  }

  // Always show last page
  if (total > 1) {
    pages.push(total);
  }

  return pages;
}
