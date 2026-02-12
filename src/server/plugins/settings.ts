// ============================================================================
// Errly — Settings Plugin (Task 7.3)
// Settings CRUD with webhook URL validation (SSRF protection), integration
// token management.
// ============================================================================

import crypto from 'node:crypto';
import { URL } from 'node:url';
import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from './auth.js';
import { config } from '../config.js';
import type { Settings } from '../../shared/types.js';

// --- Private/reserved IP detection (SSRF protection) ---

function isPrivateIp(hostname: string): boolean {
  // Check for literal IPv6
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Check for localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  // Check IPv4 private ranges
  if (net.isIPv4(hostname)) {
    const parts = hostname.split('.').map(Number);

    // 127.x.x.x (loopback)
    if (parts[0] === 127) return true;
    // 10.x.x.x (private)
    if (parts[0] === 10) return true;
    // 172.16.x.x - 172.31.x.x (private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.x.x (private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.x.x (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.x.x.x (unspecified)
    if (parts[0] === 0) return true;
  }

  // Check IPv6 private ranges
  if (net.isIPv6(hostname)) {
    const lower = hostname.toLowerCase();
    // ::1 (loopback)
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    // fc00::/7 (unique local)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // fe80::/10 (link-local)
    if (lower.startsWith('fe80')) return true;
  }

  return false;
}

// --- Validate webhook URL ---

function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    // Scheme check
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Webhook URL must use http:// or https:// scheme' };
    }

    // SSRF protection — reject private IPs
    if (isPrivateIp(parsed.hostname)) {
      return {
        valid: false,
        error: 'Webhook URL must not point to private/reserved IP addresses',
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// --- Helper: get setting value ---

function getSetting(key: string): string | null {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? null;
}

// --- Helper: set setting value ---

function setSetting(key: string, value: string): void {
  const existing = db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  } else {
    db.insert(settings).values({ key, value }).run();
  }
}

// --- Build settings response ---

function safeParse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildSettingsResponse(): Settings {
  const retentionDays = safeParse<number>(getSetting('retention_days'), 7);
  const serviceAliases = safeParse<Record<string, string>>(getSetting('service_aliases'), {});
  const webhookUrl = safeParse<string | null>(getSetting('webhook_url'), null);
  const integrationToken = safeParse<string>(getSetting('integration_token'), '');

  // Mask Railway API token
  const rawToken = config.railwayApiToken ?? '';
  const maskedToken = rawToken.length > 4
    ? '****' + rawToken.slice(-4)
    : rawToken ? '****' : '';

  return {
    retentionDays,
    serviceAliases,
    webhookUrl,
    railwayApiToken: maskedToken,
    integrationToken,
  };
}

// --- Plugin ---

// Callback for restarting log watcher when token changes
type RestartLogWatcherFn = (token: string) => Promise<void>;
let restartLogWatcherCallback: RestartLogWatcherFn | null = null;

export function setRestartLogWatcherCallback(fn: RestartLogWatcherFn): void {
  restartLogWatcherCallback = fn;
}

// Callback for triggering immediate retention cleanup
type RunRetentionFn = () => void;
let runRetentionCallback: RunRetentionFn | null = null;

export function setRunRetentionCallback(fn: RunRetentionFn): void {
  runRetentionCallback = fn;
}

export default async function settingsPlugin(fastify: FastifyInstance): Promise<void> {

  // GET /api/settings — read all settings
  fastify.get('/api/settings', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const settingsResponse = buildSettingsResponse();
    return reply.status(200).send(settingsResponse);
  });

  // PUT /api/settings — update settings
  fastify.put('/api/settings', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = request.body as Partial<{
      retentionDays: number;
      serviceAliases: Record<string, string>;
      webhookUrl: string | null;
      railwayApiToken: string;
      regenerateIntegrationToken: boolean;
    }> | undefined;

    if (!body) {
      return reply.status(400).send({ error: 'Request body required' });
    }

    const changes: string[] = [];

    // Update retention days
    if (body.retentionDays !== undefined) {
      const days = body.retentionDays;
      if (typeof days !== 'number' || days < 1 || days > 90) {
        return reply.status(400).send({
          error: 'retentionDays must be between 1 and 90',
        });
      }
      setSetting('retention_days', JSON.stringify(days));
      changes.push('retentionDays');

      // Trigger immediate cleanup
      if (runRetentionCallback) {
        runRetentionCallback();
      }
    }

    // Update service aliases
    if (body.serviceAliases !== undefined) {
      if (typeof body.serviceAliases !== 'object' || body.serviceAliases === null) {
        return reply.status(400).send({
          error: 'serviceAliases must be an object',
        });
      }
      setSetting('service_aliases', JSON.stringify(body.serviceAliases));
      changes.push('serviceAliases');
    }

    // Update webhook URL
    if (body.webhookUrl !== undefined) {
      if (body.webhookUrl === null || body.webhookUrl === '') {
        setSetting('webhook_url', JSON.stringify(null));
        changes.push('webhookUrl');
      } else {
        const validation = validateWebhookUrl(body.webhookUrl);
        if (!validation.valid) {
          return reply.status(400).send({ error: validation.error });
        }
        setSetting('webhook_url', JSON.stringify(body.webhookUrl));
        changes.push('webhookUrl');
      }
    }

    // Update Railway API token
    if (body.railwayApiToken !== undefined && body.railwayApiToken !== '') {
      // Don't store the token in settings DB — it's set via env var
      // But we can trigger log watcher restart with the new token
      if (restartLogWatcherCallback) {
        try {
          await restartLogWatcherCallback(body.railwayApiToken);
          changes.push('railwayApiToken');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to restart log watcher with new token', { error: msg });
          return reply.status(500).send({ error: 'Failed to apply new token' });
        }
      }
    }

    // Regenerate integration token
    if (body.regenerateIntegrationToken) {
      const newToken = crypto.randomUUID();
      setSetting('integration_token', JSON.stringify(newToken));
      changes.push('integrationToken');
      logger.info('Integration token regenerated');
    }

    logger.info('Settings updated', { changes });

    const settingsResponse = buildSettingsResponse();
    return reply.status(200).send(settingsResponse);
  });

  // POST /api/settings/webhook-test — send a test webhook
  fastify.post('/api/settings/webhook-test', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const webhookUrl = JSON.parse(getSetting('webhook_url') ?? 'null') as string | null;

    if (!webhookUrl) {
      return reply.status(400).send({ error: 'No webhook URL configured' });
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'test',
          message: 'Errly webhook test',
          timestamp: Date.now(),
        }),
        signal: AbortSignal.timeout(5000),
      });

      return reply.status(200).send({
        success: response.ok,
        status: response.status,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Webhook test failed: ${msg}` });
    }
  });
}

// --- Initialize default settings on first boot ---

export function initializeDefaultSettings(): void {
  const defaults: Record<string, string> = {
    retention_days: '7',
    webhook_url: 'null',
    service_aliases: '{}',
    integration_token: JSON.stringify(crypto.randomUUID()),
  };

  for (const [key, value] of Object.entries(defaults)) {
    const existing = getSetting(key);
    if (existing === null) {
      setSetting(key, value);
      logger.info('Initialized default setting', { key });
    }
  }
}
