// ============================================================================
// Errly — SettingsPage Component
// Settings dashboard: Retention, Password, Railway API Token, Integration Token,
// Service Aliases, Webhook, Diagnostics, Active Sessions, Danger zone.
// ============================================================================

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Settings, DiagnosticsInfo, ServiceInfo } from '@shared/types';

// ---- Section wrapper ----

function SettingsSection({
  title,
  description,
  children,
  danger,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`bg-slate-800 border rounded-lg p-6 ${
        danger ? 'border-red-500/30' : 'border-slate-700'
      }`}
    >
      <h3
        className={`text-base font-semibold mb-1 ${
          danger ? 'text-red-400' : 'text-slate-100'
        }`}
      >
        {title}
      </h3>
      {description && (
        <p className="text-sm text-slate-400 mb-4">{description}</p>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

// ---- Status badge ----

function StatusBadge({
  status,
  label,
}: {
  status: 'ok' | 'warning' | 'error';
  label: string;
}) {
  const colors = {
    ok: 'bg-green-500/10 text-green-400 border-green-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20',
  }[status];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${colors}`}
    >
      {label}
    </span>
  );
}

// ---- Main Component ----

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  // Form state
  const [retentionDays, setRetentionDays] = useState(7);
  const [railwayToken, setRailwayToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [aliases, setAliases] = useState<Record<string, string>>({});

  // Load data
  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get<Settings>('/api/settings');
      setSettings(data);
      setRetentionDays(data.retentionDays);
      setWebhookUrl(data.webhookUrl ?? '');
      setWebhookEnabled(!!data.webhookUrl);
      setAliases(data.serviceAliases ?? {});
    } catch {
      // handled by layout
    }
  }, []);

  const loadDiagnostics = useCallback(async () => {
    try {
      const data = await api.get<DiagnosticsInfo>('/api/diagnostics');
      setDiagnostics(data);
    } catch {
      // non-critical
    }
  }, []);

  const loadServices = useCallback(async () => {
    try {
      const data = await api.get<ServiceInfo[]>('/api/services');
      setServices(data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    Promise.all([loadSettings(), loadDiagnostics(), loadServices()]).finally(
      () => setIsLoading(false),
    );
    const interval = setInterval(loadDiagnostics, 15000);
    return () => clearInterval(interval);
  }, [loadSettings, loadDiagnostics, loadServices]);

  // Helpers
  const showSaveStatus = useCallback(
    (key: string, message: string, durationMs = 3000) => {
      setSaveStatus((prev) => ({ ...prev, [key]: message }));
      setTimeout(() => {
        setSaveStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, durationMs);
    },
    [],
  );

  const updateSettings = useCallback(
    async (key: string, payload: Record<string, unknown>) => {
      try {
        await api.put('/api/settings', payload);
        showSaveStatus(key, 'Saved');
        await loadSettings();
      } catch (err) {
        const message =
          err instanceof ApiError && err.body
            ? typeof err.body === 'object' && err.body !== null && 'message' in err.body
              ? String((err.body as { message: string }).message)
              : String(err.body)
            : 'Failed to save';
        showSaveStatus(key, message);
      }
    },
    [showSaveStatus, loadSettings],
  );

  // Clipboard helper
  const copyToClipboard = useCallback(
    async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showSaveStatus(key, 'Copied!');
      } catch {
        showSaveStatus(key, 'Copy failed');
      }
    },
    [showSaveStatus],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <a
            href="#/"
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </a>
          <h2 className="text-xl font-semibold text-slate-100">Settings</h2>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-slate-800 border border-slate-700 rounded-lg p-6"
          >
            <div className="skeleton w-48 h-5 rounded mb-3" />
            <div className="skeleton w-full h-10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <a
          href="#/"
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </a>
        <h2 className="text-xl font-semibold text-slate-100">Settings</h2>
      </div>

      {/* Retention */}
      <SettingsSection
        title="Data Retention"
        description="How long to keep error records before automatic cleanup."
      >
        <div className="flex items-center gap-3">
          <select
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value={1}>24 hours</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            onClick={() =>
              updateSettings('retention', { retentionDays })
            }
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors"
          >
            Save
          </button>
          {saveStatus.retention && (
            <span className="text-sm text-green-400">
              {saveStatus.retention}
            </span>
          )}
        </div>
      </SettingsSection>

      {/* Password */}
      <SettingsSection
        title="Dashboard Password"
        description="The dashboard password is set via the ERRLY_PASSWORD environment variable."
      >
        <p className="text-sm text-slate-400">
          To change the password, update the{' '}
          <code className="px-1 py-0.5 bg-slate-900 rounded text-indigo-400 text-xs">
            ERRLY_PASSWORD
          </code>{' '}
          environment variable in your Railway dashboard and redeploy. After changing
          the password, use the &quot;Invalidate all sessions&quot; button below to
          force all users to re-authenticate.
        </p>
      </SettingsSection>

      {/* Railway API Token */}
      <SettingsSection
        title="Railway API Token"
        description="Required for auto-capture mode. Enables real-time error detection from all project services."
      >
        {settings?.railwayApiToken ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-sm text-slate-400 font-mono">
              {'*'.repeat(20)}{settings.railwayApiToken}
            </div>
            <button
              onClick={() => setShowTokenInput(!showTokenInput)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-md transition-colors"
            >
              Update
            </button>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
            <p className="text-sm text-amber-400">
              No Railway API token configured. Auto-capture is disabled.
            </p>
          </div>
        )}

        {(showTokenInput || !settings?.railwayApiToken) && (
          <div className="flex items-center gap-3 mt-3">
            <input
              type="password"
              value={railwayToken}
              onChange={(e) => setRailwayToken(e.target.value)}
              placeholder="Enter Railway API token"
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={async () => {
                if (!railwayToken.trim()) return;
                await updateSettings('token', {
                  railwayApiToken: railwayToken,
                });
                setRailwayToken('');
                setShowTokenInput(false);
              }}
              disabled={!railwayToken.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-md transition-colors disabled:cursor-not-allowed"
            >
              Save Token
            </button>
            {saveStatus.token && (
              <span className="text-sm text-green-400">
                {saveStatus.token}
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-slate-500 mt-2">
          The log watcher will restart when you update the token.
        </p>
      </SettingsSection>

      {/* Integration Token */}
      <SettingsSection
        title="Integration Token"
        description="Use this token to send errors directly to Errly via the POST /api/errors endpoint."
      >
        {settings?.integrationToken && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-sm text-indigo-400 font-mono select-all break-all">
                {settings.integrationToken}
              </code>
              <button
                onClick={() =>
                  copyToClipboard(settings.integrationToken, 'copyToken')
                }
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md transition-colors shrink-0"
              >
                {saveStatus.copyToken === 'Copied!' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={async () => {
                if (
                  !confirm(
                    'Regenerating the token will immediately break existing integrations. Continue?',
                  )
                )
                  return;
                await updateSettings('regenToken', {
                  regenerateIntegrationToken: true,
                });
              }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-md transition-colors"
            >
              Regenerate Token
            </button>
            {saveStatus.regenToken && (
              <span className="text-sm text-green-400 ml-2">
                {saveStatus.regenToken}
              </span>
            )}

            {/* Usage example */}
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-2">Usage example:</p>
              <pre className="bg-slate-900 border border-slate-700 rounded-md p-3 text-xs text-slate-400 overflow-x-auto">
                <code>{`curl -X POST ${window.location.origin}/api/errors \\
  -H "Content-Type: application/json" \\
  -H "X-Errly-Token: ${settings.integrationToken}" \\
  -d '{"service":"my-api","message":"Something failed","severity":"error"}'`}</code>
              </pre>
            </div>
          </div>
        )}
      </SettingsSection>

      {/* Service Aliases */}
      <SettingsSection
        title="Service Aliases"
        description="Map auto-generated service names to human-readable aliases."
      >
        {services.length > 0 ? (
          <div className="space-y-2">
            {services.map((svc) => (
              <div key={svc.name} className="flex items-center gap-3">
                <span className="w-48 text-sm text-slate-300 font-mono truncate" title={svc.name}>
                  {svc.name}
                </span>
                <svg
                  className="w-4 h-4 text-slate-600 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  />
                </svg>
                <input
                  type="text"
                  value={aliases[svc.name] ?? ''}
                  onChange={(e) =>
                    setAliases((prev) => ({
                      ...prev,
                      [svc.name]: e.target.value,
                    }))
                  }
                  placeholder="Alias"
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-600 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() =>
                  updateSettings('aliases', {
                    serviceAliases: aliases,
                  })
                }
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors"
              >
                Save Aliases
              </button>
              {saveStatus.aliases && (
                <span className="text-sm text-green-400">
                  {saveStatus.aliases}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No services discovered yet. Services appear once errors are captured.
          </p>
        )}
      </SettingsSection>

      {/* Webhook */}
      <SettingsSection
        title="Webhook Notifications"
        description="Receive a POST request when a new error type (new fingerprint) is detected."
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={webhookEnabled}
              onChange={(e) => {
                setWebhookEnabled(e.target.checked);
                if (!e.target.checked) {
                  updateSettings('webhook', { webhookUrl: null });
                }
              }}
              className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">
              Enable webhook notifications
            </span>
          </label>

          {webhookEnabled && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.example.com/errly"
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={() =>
                    updateSettings('webhook', {
                      webhookUrl: webhookUrl || null,
                    })
                  }
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.post('/api/settings/webhook-test');
                      showSaveStatus('webhookTest', 'Test sent!');
                    } catch {
                      showSaveStatus('webhookTest', 'Test failed');
                    }
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md transition-colors"
                >
                  Test
                </button>
              </div>
              {saveStatus.webhook && (
                <span className="text-sm text-green-400">
                  {saveStatus.webhook}
                </span>
              )}
              {saveStatus.webhookTest && (
                <span className="text-sm text-green-400 ml-2">
                  {saveStatus.webhookTest}
                </span>
              )}
              <p className="text-xs text-slate-500">
                URL must use http:// or https:// scheme. Private/reserved IP
                ranges are rejected (127.x, 10.x, 172.16-31.x, 192.168.x) to
                prevent SSRF.
              </p>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Diagnostics */}
      <SettingsSection
        title="Diagnostics"
        description="Live system diagnostics for auto-capture and Railway API status."
      >
        {diagnostics ? (
          <div className="space-y-4">
            {/* System stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-900/50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Circuit Breaker</p>
                <div className="mt-1">
                  <StatusBadge
                    status={
                      diagnostics.circuitBreaker === 'closed'
                        ? 'ok'
                        : diagnostics.circuitBreaker === 'half-open'
                          ? 'warning'
                          : 'error'
                    }
                    label={diagnostics.circuitBreaker}
                  />
                </div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Rate Limit</p>
                <p className="text-sm font-medium text-slate-200 mt-1 tabular-nums">
                  {diagnostics.railwayApiRateLimit.remaining ?? '--'} remaining
                </p>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Errors/min</p>
                <p className="text-sm font-medium text-slate-200 mt-1 tabular-nums">
                  {diagnostics.errorsPerMinute.toFixed(1)}
                </p>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Memory (RSS)</p>
                <p className="text-sm font-medium text-slate-200 mt-1 tabular-nums">
                  {diagnostics.memoryUsage.rss} MB
                </p>
              </div>
            </div>

            {/* Subscriptions */}
            {diagnostics.subscriptions.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  Active Subscriptions ({diagnostics.subscriptions.length})
                </p>
                <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">
                          Service
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">
                          Status
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">
                          Last Message
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.subscriptions.map((sub) => (
                        <tr
                          key={sub.deploymentId}
                          className="border-b border-slate-800 last:border-0"
                        >
                          <td className="px-3 py-2 text-slate-300 font-mono text-xs truncate max-w-[200px]">
                            {sub.serviceName}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge
                              status={
                                sub.status === 'active'
                                  ? 'ok'
                                  : sub.status === 'reconnecting'
                                    ? 'warning'
                                    : 'error'
                              }
                              label={sub.status}
                            />
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-xs">
                            {sub.lastMessageAt
                              ? new Date(sub.lastMessageAt).toLocaleTimeString()
                              : '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {diagnostics.subscriptions.length === 0 && (
              <p className="text-sm text-slate-500">
                No active subscriptions. Auto-capture may be disabled or no
                deployments discovered.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading diagnostics...</p>
        )}
      </SettingsSection>

      {/* Active Sessions */}
      <SettingsSection
        title="Active Sessions"
        description="Manage active login sessions. Use the emergency button if the password is compromised."
      >
        <button
          onClick={async () => {
            if (
              !confirm(
                'This will log out ALL users immediately, including yourself. You will need to re-authenticate. Continue?',
              )
            )
              return;
            try {
              await api.del('/api/auth/sessions');
              showSaveStatus('sessions', 'All sessions invalidated');
              // The 401 handler will redirect to login
            } catch {
              showSaveStatus('sessions', 'Failed to invalidate sessions');
            }
          }}
          className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-400 text-sm font-medium rounded-md transition-colors"
        >
          Invalidate All Sessions
        </button>
        {saveStatus.sessions && (
          <span className="text-sm text-amber-400 ml-3">
            {saveStatus.sessions}
          </span>
        )}
        <p className="text-xs text-slate-500 mt-2">
          Emergency response: invalidate every active session immediately.
          All connected users will be forced to re-authenticate.
        </p>
      </SettingsSection>

      {/* Danger Zone */}
      <SettingsSection
        title="Danger Zone"
        description="Destructive actions that cannot be undone."
        danger
      >
        <button
          onClick={async () => {
            if (
              !confirm(
                'This will permanently delete ALL error records. This cannot be undone. Continue?',
              )
            )
              return;
            try {
              await api.del('/api/errors', { confirm: true });
              showSaveStatus('clearErrors', 'All errors cleared');
            } catch {
              showSaveStatus('clearErrors', 'Failed to clear errors');
            }
          }}
          className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 text-sm font-medium rounded-md transition-colors"
        >
          Clear All Errors
        </button>
        {saveStatus.clearErrors && (
          <span className="text-sm text-red-400 ml-3">
            {saveStatus.clearErrors}
          </span>
        )}
        <p className="text-xs text-slate-500 mt-2">
          Permanently delete all stored error records. Connected dashboards
          will be updated in real-time via SSE.
        </p>
      </SettingsSection>
    </div>
  );
}
