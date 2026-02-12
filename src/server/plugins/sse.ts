// ============================================================================
// Errly — SSE Plugin (Task 7.2)
// SSE streaming with connection cap, session revalidation, backpressure,
// closeConnectionsBySession. ALL events use generic data: {json}\n\n format
// (NO named events).
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { sha256Hex } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import type { SSEEvent } from '../../shared/types.js';

// --- Connection tracking ---

interface SSEConnection {
  id: string;
  response: ServerResponse;
  sessionHash: string;
  connectedAt: number;
  droppedMessages: number;
}

const connections = new Map<string, SSEConnection>();

let connectionIdCounter = 0;

// --- Keepalive interval ---

let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

// --- Session revalidation interval ---

let revalidateTimer: ReturnType<typeof setInterval> | null = null;

// --- Broadcast to all connected SSE clients ---

export function broadcast(event: SSEEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;

  for (const [id, conn] of connections) {
    try {
      const ok = conn.response.write(data);

      if (!ok) {
        // Backpressure — kernel buffer full
        conn.droppedMessages++;

        if (conn.droppedMessages > 50) {
          // Client too slow — evict
          logger.warn('SSE client evicted due to backpressure', {
            connectionId: id,
            droppedMessages: conn.droppedMessages,
          });
          closeConnection(id);
        }
      }
    } catch {
      // Write failed — remove connection
      closeConnection(id);
    }
  }
}

// --- Close connections by session hash ---

export function closeConnectionsBySession(sessionHash: string): void {
  for (const [id, conn] of connections) {
    if (conn.sessionHash === sessionHash) {
      // Send auth-expired event before closing
      try {
        conn.response.write(`data: ${JSON.stringify({ type: 'auth-expired', payload: {} })}\n\n`);
      } catch {
        // Ignore write errors
      }
      closeConnection(id);
    }
  }
}

// --- Close a single connection ---

function closeConnection(id: string): void {
  const conn = connections.get(id);
  if (conn) {
    try {
      conn.response.end();
    } catch {
      // Ignore
    }
    connections.delete(id);
    logger.debug('SSE connection closed', { connectionId: id });
  }
}

// --- Get current client count ---

export function getClientCount(): number {
  return connections.size;
}

// --- Session revalidation ---

function revalidateSessions(): void {
  for (const [id, conn] of connections) {
    const session = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, conn.sessionHash))
      .get();

    if (!session || session.expiresAt < Date.now()) {
      logger.info('SSE session expired during revalidation', {
        connectionId: id,
        sessionHash: conn.sessionHash.substring(0, 8) + '...',
      });

      // Send auth-expired in generic data format (NO named events)
      try {
        conn.response.write(`data: ${JSON.stringify({ type: 'auth-expired', payload: {} })}\n\n`);
      } catch {
        // Ignore
      }

      closeConnection(id);
    }
  }
}

// --- Plugin ---

export default async function ssePlugin(fastify: FastifyInstance): Promise<void> {

  // Start keepalive (every 30 seconds)
  keepaliveTimer = setInterval(() => {
    for (const [id, conn] of connections) {
      try {
        conn.response.write(': keepalive\n\n');
      } catch {
        closeConnection(id);
      }
    }
  }, 30_000);

  // Start session revalidation (every 5 minutes)
  revalidateTimer = setInterval(revalidateSessions, 5 * 60 * 1000);

  // Clean up on server close
  fastify.addHook('onClose', async () => {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    if (revalidateTimer) {
      clearInterval(revalidateTimer);
      revalidateTimer = null;
    }

    // Close all connections
    for (const [id] of connections) {
      closeConnection(id);
    }
  });

  // GET /api/errors/stream — SSE endpoint
  fastify.get('/api/errors/stream', async (request, reply) => {
    // Auth check
    const token = (request.cookies as Record<string, string | undefined>)?.errly_session;

    if (!token) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const sessionHash = sha256Hex(token);
    const session = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionHash))
      .get();

    if (!session || session.expiresAt < Date.now()) {
      return reply.status(401).send({ error: 'Session expired' });
    }

    // Check connection cap
    if (connections.size >= config.maxSseClients) {
      logger.warn('SSE connection limit reached', {
        current: connections.size,
        max: config.maxSseClients,
      });
      return reply.status(503).send({
        error: 'Too many SSE connections — try again later',
      });
    }

    // Set SSE headers
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Generate connection ID
    const connId = `sse-${++connectionIdCounter}`;

    // Register connection
    const conn: SSEConnection = {
      id: connId,
      response: raw,
      sessionHash,
      connectedAt: Date.now(),
      droppedMessages: 0,
    };

    connections.set(connId, conn);

    logger.info('SSE connection opened', {
      connectionId: connId,
      totalConnections: connections.size,
    });

    // Send initial keepalive
    raw.write(': connected\n\n');

    // Handle client disconnect — use closeConnection for consistent cleanup (F15 fix)
    request.raw.on('close', () => {
      closeConnection(connId);
    });

    // Do NOT call reply.send() — we're using raw response for streaming
    // Fastify requires us to hijack the response
    reply.hijack();
  });
}

// --- Exports for other plugins ---

export { connections as sseConnections };

// --- Cleanup function for graceful shutdown ---

export function closeAllSseConnections(): void {
  // Broadcast auth-expired to all clients
  broadcast({ type: 'auth-expired', payload: {} });

  // Close all connections
  for (const [id] of connections) {
    closeConnection(id);
  }

  // Stop timers
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  if (revalidateTimer) {
    clearInterval(revalidateTimer);
    revalidateTimer = null;
  }
}
