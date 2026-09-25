import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ServiceAuthOptions {
  serviceSecret?: string;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function serviceAuthPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  serviceSecret: string,
): Promise<void> {
  const authHeader = request.headers['x-service-auth'];
  if (!authHeader) {
    return reply.code(401).send({ error: 'Missing service authentication' });
  }

  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  if (!safeCompare(token, serviceSecret)) {
    return reply.code(403).send({ error: 'Invalid service credential' });
  }
}

export async function registerServiceAuthPlugin(app: FastifyInstance, options: ServiceAuthOptions): Promise<void> {
  const { serviceSecret } = options;
  if (!serviceSecret) {
    app.log.warn('AUTOMATE_SERVICE_SECRET is not set — service-to-service auth disabled');
    return;
  }

  app.get('/api/service/ping', {
    preHandler: async (request, reply) => serviceAuthPreHandler(request, reply, serviceSecret),
  }, async () => ({ pong: true }));
}
