// ============================================================================
// Errly — SDK Plugin
// Serves the client-side error capture SDK at GET /sdk/errly.js.
// Public (no auth), cached 1 hour, CORS open, rate limited 30/min.
// ============================================================================

import type { FastifyInstance } from 'fastify';
import { ERRLY_SDK_JS } from '../sdk/errly-sdk.js';

export default async function sdkPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.get('/sdk/errly.js', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (_request, reply) => {
    return reply
      .status(200)
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('Access-Control-Allow-Origin', '*')
      .send(ERRLY_SDK_JS);
  });
}
