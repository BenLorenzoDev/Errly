// ============================================================================
// Errly — Layout Component
// Dashboard shell: header with logo, connection status, auto-capture status,
// stats, settings link, logout. Banner if auto-capture disabled.
// ============================================================================

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useSSE } from '../hooks/useSSE';
import { useErrors } from '../hooks/useErrors';
import { useTheme } from '../hooks/useTheme';
import { useErrorsContext } from '../App';
import type { DashboardStats, HealthStatus } from '@shared/types';

interface LayoutProps {
  children: ReactNode;
  onLogout: () => void;
}

export function Layout({ children, onLogout }: LayoutProps) {
  const { dispatch } = useErrorsContext();
  const { fetchErrors, handleSSEEvent } = useErrors();
  const { theme, toggleTheme } = useTheme();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  // Fetch stats
  const loadStats = useCallback(async () => {
    try {
      const data = await api.get<DashboardStats>('/api/stats');
      setStats(data);
    } catch {
      // Silent fail — stats are non-critical
    }
  }, []);

  // Fetch health
  const loadHealth = useCallback(async () => {
    try {
      const data = await api.get<HealthStatus>('/health');
      setHealth(data);
    } catch {
      // Silent fail
    }
  }, []);

  // Initial data load
  useEffect(() => {
    fetchErrors();
    loadStats();
    loadHealth();
    // Refresh stats every 30s
    const statsInterval = setInterval(loadStats, 30000);
    const healthInterval = setInterval(loadHealth, 30000);
    return () => {
      clearInterval(statsInterval);
      clearInterval(healthInterval);
    };
  }, [fetchErrors, loadStats, loadHealth]);

  // SSE connection
  const handleAuthExpired = useCallback(() => {
    onLogout();
  }, [onLogout]);

  const handleReconnect = useCallback(() => {
    fetchErrors();
    loadStats();
  }, [fetchErrors, loadStats]);

  const handleSSE = useCallback(
    (event: Parameters<typeof handleSSEEvent>[0]) => {
      handleSSEEvent(event);
      // Refresh stats on new/updated errors
      if (event.type === 'new-error' || event.type === 'error-updated') {
        loadStats();
      }
    },
    [handleSSEEvent, loadStats],
  );

  const { isConnected } = useSSE({
    enabled: true,
    onEvent: handleSSE,
    onAuthExpired: handleAuthExpired,
    onReconnect: handleReconnect,
  });

  // Clear new error highlight IDs after animation duration
  const { state } = useErrorsContext();
  useEffect(() => {
    if (state.newErrorIds.size > 0) {
      const timer = setTimeout(() => {
        dispatch({ type: 'CLEAR_NEW_ERROR_IDS' });
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [state.newErrorIds, dispatch]);

  const autoCaptureEnabled = health?.autoCaptureEnabled ?? false;

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="header-gradient border-b border-slate-700/50 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Left: Logo + Name */}
            <div className="flex items-center gap-3">
              <a href="#/" className="flex items-center gap-2.5 group">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center group-hover:border-indigo-400/50 transition-colors">
                  <svg
                    className="w-4.5 h-4.5 text-indigo-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                </div>
                <span className="text-lg font-semibold text-slate-100 tracking-tight">
                  Errly
                </span>
              </a>
            </div>

            {/* Center: Stats Summary */}
            <div className="hidden md:flex items-center gap-1.5">
              <StatPill
                label="Errors"
                value={stats?.totalErrors}
                color="text-slate-100"
              />
              <StatPill
                label="Services"
                value={stats?.activeServices}
                color="text-slate-100"
              />
              <StatPill
                label="Last hour"
                value={stats?.errorsLastHour}
                color={
                  (stats?.errorsLastHour ?? 0) > 0
                    ? 'text-amber-400'
                    : 'text-slate-100'
                }
              />
            </div>

            {/* Right: Status indicators + Actions */}
            <div className="flex items-center gap-2">
              {/* Connection status */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                  isConnected
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-red-500/10 text-red-400'
                }`}
                title={
                  isConnected ? 'Live connection active' : 'Disconnected — reconnecting...'
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected
                      ? 'bg-green-400 pulse-dot'
                      : 'bg-red-400'
                  }`}
                />
                {isConnected ? 'Live' : 'Offline'}
              </div>

              {/* Auto-capture status */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                  autoCaptureEnabled
                    ? 'bg-indigo-500/10 text-indigo-400'
                    : 'bg-slate-700/50 text-slate-500'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    autoCaptureEnabled ? 'bg-indigo-400' : 'bg-slate-500'
                  }`}
                />
                {autoCaptureEnabled ? 'Auto' : 'Manual'}
              </div>

              {/* Separator */}
              <div className="w-px h-5 bg-slate-700/70 mx-0.5" />

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/5 transition-colors"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? (
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                  </svg>
                ) : (
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                  </svg>
                )}
              </button>

              {/* Settings */}
              <a
                href="#/settings"
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/5 transition-colors"
                title="Settings"
              >
                <svg
                  className="w-[18px] h-[18px]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </a>

              {/* Logout */}
              <button
                onClick={onLogout}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/5 transition-colors"
                title="Logout"
              >
                <svg
                  className="w-[18px] h-[18px]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Auto-capture disabled banner */}
      {health && !autoCaptureEnabled && (
        <div className="bg-amber-500/5 border-b border-amber-500/15">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <svg
                className="w-4 h-4 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <span>
                Auto-capture disabled &mdash;{' '}
                <a
                  href="#/settings"
                  className="underline underline-offset-2 hover:text-amber-300 transition-colors"
                >
                  configure Railway API token in Settings
                </a>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined | null;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/[0.03] text-sm">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>
        {value ?? '--'}
      </span>
    </div>
  );
}
