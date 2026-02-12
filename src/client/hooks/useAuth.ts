// ============================================================================
// Errly — Auth State Hook
// Manages authentication state, login, logout, and session checking.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../lib/api';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface LoginResult {
  success: boolean;
  retryAfter?: number;
  error?: string;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
  });

  const checkAuth = useCallback(async () => {
    try {
      await api.get('/api/auth/check');
      setState({ isAuthenticated: true, isLoading: false });
    } catch {
      setState({ isAuthenticated: false, isLoading: false });
    }
  }, []);

  const login = useCallback(async (password: string): Promise<LoginResult> => {
    try {
      await api.post('/api/auth/login', { password });
      setState({ isAuthenticated: true, isLoading: false });
      return { success: true };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const body = err.body as { retryAfter?: number } | undefined;
          const retryAfter = body?.retryAfter ?? 60;
          return { success: false, retryAfter, error: 'Too many attempts.' };
        }
        if (err.status === 401) {
          return { success: false, error: 'Invalid password.' };
        }
        return { success: false, error: `Login failed (${err.status}).` };
      }
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Even if the server call fails, clear local state
    }
    setState({ isAuthenticated: false, isLoading: false });
  }, []);

  const handleUnauthorized = useCallback(() => {
    setState({ isAuthenticated: false, isLoading: false });
  }, []);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return {
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    checkAuth,
    login,
    logout,
    handleUnauthorized,
  };
}
