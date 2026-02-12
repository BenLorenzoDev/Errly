// ============================================================================
// Errly — Auth Plugin (Task 4.1)
// Password auth with rate limiting, session management (SHA-256 hashed tokens
// in DB), CSRF (reject mismatched Origin only, allow missing),
// login/logout/check/delete-all-sessions.
// ============================================================================

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db, sqliteDb } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { safeCompare, sha256Hex } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

// --- Rate Limiting (in-memory) ---

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute
const MAX_RATE_LIMIT_ENTRIES = 10_000; // Cap to prevent memory exhaustion

// Periodic cleanup of expired rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.windowStart > WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60_000).unref();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Window expired or no entry — reset
    loginAttempts.set(ip, { count: 0, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Evict oldest if at capacity
    if (loginAttempts.size >= MAX_RATE_LIMIT_ENTRIES && !loginAttempts.has(ip)) {
      const oldest = loginAttempts.keys().next().value;
      if (oldest !== undefined) loginAttempts.delete(oldest);
    }
    loginAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

// --- Session helpers ---

const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

function cleanupExpiredSessions(sseCloseBySession?: (hash: string) => void): void {
  const now = Date.now();

  // Get expired sessions before deleting
  const expired = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.expiresAt, now))
    .all();

  if (expired.length > 0) {
    db.delete(sessions).where(lt(sessions.expiresAt, now)).run();

    // Close SSE connections for expired sessions
    if (sseCloseBySession) {
      for (const session of expired) {
        sseCloseBySession(session.id);
      }
    }

    logger.debug('Cleaned up expired sessions', { count: expired.length });
  }
}

// --- CSRF Protection ---

function checkCsrf(request: FastifyRequest): boolean {
  // Only on state-changing methods
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return true;

  const origin = request.headers.origin;

  // If Origin is missing, allow (supports curl, non-browser clients)
  if (!origin) return true;

  // If Origin is present, validate against host
  const host = request.headers.host || request.headers[':authority'];
  if (!host) return true; // No host to compare against

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;

    // Compare origin host with request host
    if (originHost !== host) {
      logger.warn('CSRF check failed — origin mismatch', {
        origin,
        host,
        ip: request.ip,
      });
      return false;
    }
  } catch {
    // Malformed origin — reject
    return false;
  }

  return true;
}

// --- Standalone requireAuth preHandler ---
// Exported so sibling plugins can import it directly (avoids Fastify encapsulation)

let sseCloseBySession: ((hash: string) => void) | undefined;

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = (request.cookies as Record<string, string | undefined>)?.errly_session;

  if (!token) {
    reply.status(401).send({ error: 'Authentication required' });
    return;
  }

  const hash = sha256Hex(token);
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, hash))
    .get();

  if (!session) {
    reply.status(401).send({ error: 'Invalid session' });
    return;
  }

  if (session.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, hash)).run();
    if (sseCloseBySession) sseCloseBySession(hash);
    reply.status(401).send({ error: 'Session expired' });
    return;
  }

  // Store session hash on request for SSE tracking
  (request as any).sessionHash = hash;
}

// --- Plugin ---

export function setAuthSseCloseHandler(fn: (hash: string) => void): void {
  sseCloseBySession = fn;
}

export default async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // --- Decorators ---

  // Periodic session cleanup (every 5 minutes) instead of on every request
  const sessionCleanupTimer = setInterval(() => {
    cleanupExpiredSessions(sseCloseBySession);
  }, 5 * 60_000);
  sessionCleanupTimer.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(sessionCleanupTimer);
  });

  // Register requireAuth on the instance for backward compat (not relied upon)
  fastify.decorate('requireAuth', requireAuth);

  // --- CSRF Hook ---

  fastify.addHook('preHandler', async (request, reply) => {
    // Skip CSRF for non-state-changing methods
    if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return;

    // Skip CSRF for direct integration endpoint (uses token auth, not cookies).
    // Use routeOptions.url to avoid query-param mismatch with request.url (F17 fix).
    const routePath = (request.routeOptions as any)?.url ?? request.url.split('?')[0];
    if (routePath === '/api/errors' && request.method === 'POST') {
      if (request.headers['x-errly-token']) return;
    }

    // Skip CSRF for health endpoint
    if (routePath === '/health') return;

    if (!checkCsrf(request)) {
      return reply.status(403).send({ error: 'CSRF validation failed' });
    }
  });

  // --- Routes ---

  // POST /api/auth/login
  fastify.post('/api/auth/login', async (request, reply) => {
    const ip = request.ip;

    // Check rate limit
    const { allowed, retryAfter } = checkRateLimit(ip);
    if (!allowed) {
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({
        error: 'Too many login attempts',
        retryAfter,
      });
    }

    const body = request.body as { password?: string } | undefined;
    const password = body?.password;

    if (!password) {
      return reply.status(400).send({ error: 'Password is required' });
    }

    // Compare password
    if (!safeCompare(password, config.errlyPassword)) {
      recordFailedAttempt(ip);
      logger.warn('Failed login attempt', { ip });
      return reply.status(401).send({ error: 'Invalid password' });
    }

    // Generate session token
    const token = crypto.randomUUID();
    const hash = sha256Hex(token);
    const expiresAt = Date.now() + SESSION_EXPIRY_MS;

    // Store hashed token in DB
    db.insert(sessions).values({
      id: hash,
      expiresAt,
    }).run();

    // Set cookie with raw token
    reply.setCookie('errly_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: isSecureRequest(request),
      maxAge: SESSION_EXPIRY_MS / 1000,
    });

    logger.info('User logged in', { ip });

    return reply.status(200).send({ success: true });
  });

  // POST /api/auth/logout
  fastify.post('/api/auth/logout', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const token = (request.cookies as Record<string, string | undefined>)?.errly_session;

    if (token) {
      const hash = sha256Hex(token);
      db.delete(sessions).where(eq(sessions.id, hash)).run();

      // Close SSE connections for this session
      if (sseCloseBySession) {
        sseCloseBySession(hash);
      }
    }

    // Clear cookie
    reply.clearCookie('errly_session', {
      path: '/',
    });

    logger.info('User logged out', { ip: request.ip });

    return reply.status(200).send({ success: true });
  });

  // GET /api/auth/check
  fastify.get('/api/auth/check', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    return reply.status(200).send({ authenticated: true });
  });

  // DELETE /api/auth/sessions — invalidate ALL sessions
  fastify.delete('/api/auth/sessions', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    // Use raw SQL with RETURNING
    const deleted = sqliteDb.prepare('DELETE FROM sessions RETURNING id').all() as Array<{ id: string }>;

    // Close SSE connections for each deleted session
    if (sseCloseBySession) {
      for (const row of deleted) {
        sseCloseBySession(row.id);
      }
    }

    // Clear the current user's cookie
    reply.clearCookie('errly_session', {
      path: '/',
    });

    logger.info('All sessions invalidated', {
      count: deleted.length,
      ip: request.ip,
    });

    return reply.status(200).send({
      success: true,
      deletedCount: deleted.length,
    });
  });
}
