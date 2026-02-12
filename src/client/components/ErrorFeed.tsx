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
    state.filters.timeRange ||
    state.filters.search;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <FilterBar />

      {/* Error state: API fetch failed */}
      {state.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-400">
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
            className="px-3 py-1 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state: Skeleton placeholders */}
      {state.isLoading && state.errors.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-slate-800 border border-slate-700 border-l-4 border-l-slate-600 rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="skeleton w-2.5 h-2.5 rounded-full" />
                    <div className="skeleton w-24 h-5 rounded" />
                    <div className="skeleton w-12 h-5 rounded" />
                  </div>
                  <div className="skeleton w-full h-4 rounded" />
                  <div className="skeleton w-2/3 h-4 rounded" />
                </div>
                <div className="space-y-1">
                  <div className="skeleton w-10 h-5 rounded-full" />
                  <div className="skeleton w-14 h-3 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!state.isLoading && !state.error && state.errors.length === 0 && (
        <div className="text-center py-16">
          {hasActiveFilters ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 border border-slate-700 mb-4">
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
              <h3 className="text-lg font-medium text-slate-300 mb-1">
                No errors match your filters
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                Try adjusting or clearing your filters to see more results.
              </p>
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors"
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 mb-4">
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
              <h3 className="text-lg font-medium text-slate-300 mb-1">
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
        <div className="flex items-center justify-between pt-4 border-t border-slate-700">
          <p className="text-sm text-slate-500">
            Showing {(currentPage - 1) * state.limit + 1}--
            {Math.min(currentPage * state.limit, state.total)} of{' '}
            {state.total.toLocaleString()} errors
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1 text-sm bg-slate-800 border border-slate-600 rounded-md text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            {/* Page numbers */}
            {generatePageNumbers(currentPage, totalPages).map((page, i) =>
              page === null ? (
                <span key={`ellipsis-${i}`} className="px-2 text-slate-500">
                  ...
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    page === currentPage
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {page}
                </button>
              ),
            )}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 text-sm bg-slate-800 border border-slate-600 rounded-md text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
