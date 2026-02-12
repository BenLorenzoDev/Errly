// ============================================================================
// Errly — useErrors Hook
// Wraps the App-level useReducer dispatch (NOT its own state).
// Provides fetchErrors, setFilter, clearFilters, handleSSEEvent.
// ============================================================================

import { useCallback } from 'react';
import { api } from '../lib/api';
import { useErrorsContext } from '../App';
import type {
  ErrorFilters,
  ErrorListResponse,
  SSEEvent,
  ErrlyErrorSummary,
} from '@shared/types';

export function useErrors() {
  const { state, dispatch } = useErrorsContext();

  const fetchErrors = useCallback(
    async (filters?: ErrorFilters) => {
      const activeFilters = filters ?? state.filters;
      dispatch({ type: 'SET_LOADING', payload: true });

      try {
        const params: Record<string, string | number | undefined> = {};
        if (activeFilters.service) params.service = activeFilters.service;
        if (activeFilters.severity) params.severity = activeFilters.severity;
        if (activeFilters.timeRange) params.timeRange = activeFilters.timeRange;
        if (activeFilters.search) params.search = activeFilters.search;
        if (activeFilters.page) params.page = activeFilters.page;
        if (activeFilters.limit) params.limit = activeFilters.limit;

        const data = await api.get<ErrorListResponse>('/api/errors', params);
        dispatch({
          type: 'SET_ERRORS',
          payload: {
            errors: data.errors,
            total: data.total,
            page: data.page,
            limit: data.limit,
          },
        });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR_STATE',
          payload:
            err instanceof Error ? err.message : 'Failed to fetch errors',
        });
      }
    },
    [state.filters, dispatch],
  );

  const setFilter = useCallback(
    (key: keyof ErrorFilters, value: ErrorFilters[keyof ErrorFilters]) => {
      const updated: ErrorFilters = {
        ...state.filters,
        [key]: value,
        // Reset page when filter changes (except page itself)
        ...(key !== 'page' ? { page: 1 } : {}),
      };
      dispatch({ type: 'SET_FILTERS', payload: updated });
    },
    [state.filters, dispatch],
  );

  const clearFilters = useCallback(() => {
    dispatch({ type: 'SET_FILTERS', payload: { page: 1, limit: 50 } });
  }, [dispatch]);

  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case 'new-error':
          dispatch({
            type: 'PREPEND_ERROR',
            payload: event.payload as ErrlyErrorSummary,
          });
          break;
        case 'error-updated':
          dispatch({
            type: 'UPDATE_ERROR',
            payload: event.payload as ErrlyErrorSummary,
          });
          break;
        case 'error-cleared':
          dispatch({
            type: 'REMOVE_ERRORS',
            payload: (event.payload as { ids: string[] }).ids,
          });
          break;
        case 'bulk-cleared':
          // Trigger full re-fetch
          fetchErrors();
          break;
      }
    },
    [dispatch, fetchErrors],
  );

  return {
    fetchErrors,
    setFilter,
    clearFilters,
    handleSSEEvent,
  };
}
