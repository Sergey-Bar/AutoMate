import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export async function registerRateLimitPlugin(app: FastifyInstance) {
  const max = Number(process.env.RATE_LIMIT_MAX) || 200;
  await app.register(rateLimit, {
    max,
    timeWindow: '1 minute',
    allowList: (req) => {
      // No rate limit on health endpoints
      return req.url?.startsWith('/health') ?? false;
    },
  });
}
