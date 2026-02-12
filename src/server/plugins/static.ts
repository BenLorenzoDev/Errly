// ============================================================================
// Errly — Static File Serving Plugin (Task 7.5)
// Static file serving with SPA fallback excluding /api/ and /health paths.
// ============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

// --- Resolve dist/client directory ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In production, the compiled server is at dist/server/plugins/static.js
// The client build is at dist/client/
const clientDistPath = path.resolve(__dirname, '..', '..', 'client');

export default async function staticPlugin(fastify: FastifyInstance): Promise<void> {
  // Only serve static files in production (Vite handles dev)
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    logger.debug('Static plugin skipped in development (Vite dev server handles frontend)');
    return;
  }

  // Check if client dist directory exists
  if (!fs.existsSync(clientDistPath)) {
    logger.warn('Client dist directory not found — static serving disabled', {
      path: clientDistPath,
    });
    return;
  }

  // Register @fastify/static for the client build
  const fastifyStatic = await import('@fastify/static');
  await fastify.register(fastifyStatic.default, {
    root: clientDistPath,
    prefix: '/',
    decorateReply: false,
    wildcard: false, // Disable wildcard so we can handle SPA fallback manually
  });

  // Read index.html once for SPA fallback
  const indexPath = path.join(clientDistPath, 'index.html');
  let indexHtml = '';

  try {
    indexHtml = fs.readFileSync(indexPath, 'utf-8');
  } catch {
    logger.error('index.html not found for SPA fallback', { path: indexPath });
  }

  // SPA fallback: serve index.html for all non-API, non-health, non-static routes
  fastify.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    // Do NOT serve index.html for API routes or health check
    if (request.url.startsWith('/api/') || request.url === '/health') {
      return reply.status(404).send({
        error: 'Not found',
        path: request.url,
      });
    }

    // Only serve index.html for GET requests
    if (request.method !== 'GET') {
      return reply.status(404).send({
        error: 'Not found',
        path: request.url,
      });
    }

    if (!indexHtml) {
      return reply.status(500).send({ error: 'SPA fallback unavailable' });
    }

    return reply.status(200).header('Content-Type', 'text/html; charset=utf-8').send(indexHtml);
  });

  logger.info('Static file serving configured', { root: clientDistPath });
}
