// ============================================================================
// Errly — Root Application Component
// useReducer for global error state, context provider, hash-based routing,
// filter persistence in URL hash params, auth gating.
// ============================================================================

import {
  useReducer,
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type Dispatch,
  type ReactNode,
} from 'react';
import { setOnUnauthorized } from './lib/api';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './components/LoginPage';
import { Layout } from './components/Layout';
import { ErrorFeed } from './components/ErrorFeed';
import { ErrorDetail } from './components/ErrorDetail';
import { SettingsPage } from './components/SettingsPage';
import type { ErrlyErrorSummary, ErrorFilters, ErrorStatus } from '@shared/types';

// ---- State & Reducer ----

interface ErrorsState {
  errors: ErrlyErrorSummary[];
  total: number;
  page: number;
  limit: number;
  filters: ErrorFilters;
  isLoading: boolean;
  error: string | null;
  /** IDs of errors that just arrived via SSE — used for highlight animation */
  newErrorIds: Set<string>;
}

type ErrorsAction =
  | {
      type: 'SET_ERRORS';
      payload: {
        errors: ErrlyErrorSummary[];
        total: number;
        page: number;
        limit: number;
      };
    }
  | { type: 'PREPEND_ERROR'; payload: ErrlyErrorSummary }
  | { type: 'UPDATE_ERROR'; payload: ErrlyErrorSummary }
  | { type: 'REMOVE_ERRORS'; payload: string[] }
  | { type: 'SET_FILTERS'; payload: ErrorFilters }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR_STATE'; payload: string }
  | { type: 'CLEAR_NEW_ERROR_IDS' };

const initialState: ErrorsState = {
  errors: [],
  total: 0,
  page: 1,
  limit: 50,
  filters: { page: 1, limit: 50 },
  isLoading: true,
  error: null,
  newErrorIds: new Set(),
};

function errorsReducer(state: ErrorsState, action: ErrorsAction): ErrorsState {
  switch (action.type) {
    case 'SET_ERRORS':
      return {
        ...state,
        errors: action.payload.errors,
        total: action.payload.total,
        page: action.payload.page,
        limit: action.payload.limit,
        isLoading: false,
        error: null,
      };

    case 'PREPEND_ERROR': {
      // Add to top of list, avoid duplicates
      const exists = state.errors.some(
        (e) => e.id === action.payload.id,
      );
      const updatedErrors = exists
        ? state.errors.map((e) =>
            e.id === action.payload.id ? action.payload : e,
          )
        : [action.payload, ...state.errors];
      const newIds = new Set(state.newErrorIds);
      newIds.add(action.payload.id);
      return {
        ...state,
        errors: updatedErrors,
        total: exists ? state.total : state.total + 1,
        newErrorIds: newIds,
      };
    }

    case 'UPDATE_ERROR': {
      const updatedErrors = state.errors.map((e) =>
        e.id === action.payload.id ? action.payload : e,
      );
      const newIds = new Set(state.newErrorIds);
      newIds.add(action.payload.id);
      return {
        ...state,
        errors: updatedErrors,
        newErrorIds: newIds,
      };
    }

    case 'REMOVE_ERRORS': {
      const idsToRemove = new Set(action.payload);
      return {
        ...state,
        errors: state.errors.filter((e) => !idsToRemove.has(e.id)),
        total: Math.max(0, state.total - action.payload.length),
      };
    }

    case 'SET_FILTERS':
      return {
        ...state,
        filters: action.payload,
      };

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
        error: action.payload ? null : state.error,
      };

    case 'SET_ERROR_STATE':
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };

    case 'CLEAR_NEW_ERROR_IDS':
      return {
        ...state,
        newErrorIds: new Set(),
      };

    default:
      return state;
  }
}

// ---- Context ----

interface ErrorsContextValue {
  state: ErrorsState;
  dispatch: Dispatch<ErrorsAction>;
}

export const ErrorsContext = createContext<ErrorsContextValue | null>(null);

export function useErrorsContext(): ErrorsContextValue {
  const ctx = useContext(ErrorsContext);
  if (!ctx) {
    throw new Error('useErrorsContext must be used within ErrorsContext.Provider');
  }
  return ctx;
}

// ---- Hash Router ----

interface Route {
  path: 'dashboard' | 'settings' | 'error-detail';
  errorId?: string;
}

function parseHash(hash: string): { route: Route; filters: ErrorFilters } {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathname, queryString] = cleaned.split('?');
  const path = pathname || '/';

  // Parse filters from query string
  const filters: ErrorFilters = { page: 1, limit: 50 };
  if (queryString) {
    const params = new URLSearchParams(queryString);
    if (params.get('service')) filters.service = params.get('service')!;
    if (params.get('severity'))
      filters.severity = params.get('severity') as ErrorFilters['severity'];
    if (params.get('status'))
      filters.status = params.get('status') as ErrorStatus;
    if (params.get('timeRange'))
      filters.timeRange = params.get('timeRange') as ErrorFilters['timeRange'];
    if (params.get('search')) filters.search = params.get('search')!;
    if (params.get('page')) filters.page = parseInt(params.get('page')!, 10);
    if (params.get('limit')) filters.limit = parseInt(params.get('limit')!, 10);
  }

  // Match routes
  if (path === '/settings') {
    return { route: { path: 'settings' }, filters };
  }

  const errorMatch = path.match(/^\/errors\/(.+)$/);
  if (errorMatch) {
    return {
      route: { path: 'error-detail', errorId: errorMatch[1] },
      filters,
    };
  }

  return { route: { path: 'dashboard' }, filters };
}

function filtersToHash(filters: ErrorFilters): string {
  const params = new URLSearchParams();
  if (filters.service) params.set('service', filters.service);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.status) params.set('status', filters.status);
  if (filters.timeRange) params.set('timeRange', filters.timeRange);
  if (filters.search) params.set('search', filters.search);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const qs = params.toString();
  return qs ? `#/?${qs}` : '#/';
}

// ---- App Component ----

export function App() {
  const [state, dispatch] = useReducer(errorsReducer, initialState);
  const {
    isAuthenticated,
    isLoading: authLoading,
    login,
    logout,
    handleUnauthorized,
  } = useAuth();

  const [route, setRoute] = useState<Route>(() => {
    return parseHash(window.location.hash).route;
  });

  // Register 401 handler
  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
  }, [handleUnauthorized]);

  // Hash change listener
  useEffect(() => {
    function handleHashChange() {
      const { route: newRoute, filters } = parseHash(window.location.hash);
      setRoute(newRoute);
      // Only apply filters from URL when navigating to dashboard
      if (newRoute.path === 'dashboard') {
        dispatch({ type: 'SET_FILTERS', payload: filters });
      }
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sync filters to URL hash when they change (dashboard only)
  useEffect(() => {
    if (route.path === 'dashboard') {
      const expectedHash = filtersToHash(state.filters);
      if (window.location.hash !== expectedHash) {
        // Use replaceState to avoid polluting history with every filter change
        window.history.replaceState(null, '', expectedHash);
      }
    }
  }, [state.filters, route.path]);

  // Auth loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // Not authenticated: show login
  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  // Render content based on route
  let content: ReactNode;
  switch (route.path) {
    case 'settings':
      content = <SettingsPage />;
      break;
    case 'error-detail':
      content = <ErrorDetail errorId={route.errorId!} />;
      break;
    default:
      content = <ErrorFeed />;
  }

  return (
    <ErrorsContext.Provider value={{ state, dispatch }}>
      <Layout onLogout={logout}>{content}</Layout>
    </ErrorsContext.Provider>
  );
}
