// ============================================================================
// Errly — FilterBar Component
// Service dropdown, severity dropdown, status dropdown, time range pills,
// debounced search, active filter indicators, clear all.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useErrors } from '../hooks/useErrors';
import { useErrorsContext } from '../App';
import type { ServiceInfo, TimeRange, Severity, ErrorStatus } from '@shared/types';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'last-hour', label: '1h' },
  { value: 'last-24h', label: '24h' },
  { value: 'last-7d', label: '7d' },
  { value: 'last-30d', label: '30d' },
];

const SEVERITIES: { value: Severity | ''; label: string }[] = [
  { value: '', label: 'All severities' },
  { value: 'fatal', label: 'Fatal' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warning' },
];

const STATUSES: { value: ErrorStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
];

export function FilterBar() {
  const { state } = useErrorsContext();
  const { setFilter, clearFilters } = useErrors();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [searchValue, setSearchValue] = useState(state.filters.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch services for dropdown
  useEffect(() => {
    api
      .get<ServiceInfo[]>('/api/services')
      .then(setServices)
      .catch(() => {
        // silent
      });
  }, []);

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        setFilter('search', value || undefined);
      }, 300);
    },
    [setFilter],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Count active filters
  const activeFilterCount = [
    state.filters.service,
    state.filters.severity,
    state.filters.status,
    state.filters.timeRange,
    state.filters.search,
  ].filter(Boolean).length;

  const handleClearAll = useCallback(() => {
    setSearchValue('');
    clearFilters();
  }, [clearFilters]);

  return (
    <div className="space-y-3">
      {/* Filter controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Service dropdown */}
        <select
          value={state.filters.service ?? ''}
          onChange={(e) => setFilter('service', e.target.value || undefined)}
          className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg text-sm text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/30 transition-colors"
        >
          <option value="">All services</option>
          {services.map((svc) => (
            <option key={svc.id || svc.name} value={svc.name}>
              {svc.alias || svc.name}
            </option>
          ))}
        </select>

        {/* Severity dropdown */}
        <select
          value={state.filters.severity ?? ''}
          onChange={(e) =>
            setFilter(
              'severity',
              (e.target.value as Severity) || undefined,
            )
          }
          className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg text-sm text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/30 transition-colors"
        >
          {SEVERITIES.map((sev) => (
            <option key={sev.value} value={sev.value}>
              {sev.label}
            </option>
          ))}
        </select>

        {/* Status dropdown */}
        <select
          value={state.filters.status ?? ''}
          onChange={(e) =>
            setFilter(
              'status',
              (e.target.value as ErrorStatus) || undefined,
            )
          }
          className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg text-sm text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/30 transition-colors"
        >
          {STATUSES.map((st) => (
            <option key={st.value} value={st.value}>
              {st.label}
            </option>
          ))}
        </select>

        {/* Time range pills */}
        <div className="flex items-center gap-0.5 bg-slate-800/50 border border-slate-700/40 rounded-lg p-0.5">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() =>
                setFilter(
                  'timeRange',
                  state.filters.timeRange === tr.value
                    ? undefined
                    : tr.value,
                )
              }
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                state.filters.timeRange === tr.value
                  ? 'bg-indigo-500/20 text-indigo-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative flex-1 min-w-[180px]">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search errors..."
            className="w-full pl-8 pr-8 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/30 transition-colors"
          />
          {searchValue && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Active filter indicators */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-slate-600 font-medium">Filters</span>

          {state.filters.service && (
            <FilterBadge
              label={state.filters.service}
              color="bg-slate-500"
              onRemove={() => setFilter('service', undefined)}
            />
          )}

          {state.filters.severity && (
            <FilterBadge
              label={state.filters.severity}
              color={
                state.filters.severity === 'fatal' ? 'bg-purple-400'
                  : state.filters.severity === 'error' ? 'bg-red-400'
                  : 'bg-amber-400'
              }
              onRemove={() => setFilter('severity', undefined)}
            />
          )}

          {state.filters.status && (
            <FilterBadge
              label={STATUSES.find((s) => s.value === state.filters.status)?.label ?? state.filters.status}
              color={
                state.filters.status === 'new' ? 'bg-blue-400'
                  : state.filters.status === 'investigating' ? 'bg-amber-400'
                  : state.filters.status === 'in-progress' ? 'bg-indigo-400'
                  : 'bg-green-400'
              }
              onRemove={() => setFilter('status', undefined)}
            />
          )}

          {state.filters.timeRange && (
            <FilterBadge
              label={TIME_RANGES.find((t) => t.value === state.filters.timeRange)?.label ?? state.filters.timeRange}
              color="bg-indigo-400"
              onRemove={() => setFilter('timeRange', undefined)}
            />
          )}

          {state.filters.search && (
            <FilterBadge
              label={`"${state.filters.search}"`}
              color="bg-slate-400"
              onRemove={() => {
                setSearchValue('');
                setFilter('search', undefined);
              }}
            />
          )}

          <button
            onClick={handleClearAll}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors ml-1 underline underline-offset-2"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function FilterBadge({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-800/60 border border-slate-700/50 rounded-full text-xs text-slate-300">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
      <button
        onClick={onRemove}
        className="text-slate-500 hover:text-slate-300 transition-colors ml-0.5"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
