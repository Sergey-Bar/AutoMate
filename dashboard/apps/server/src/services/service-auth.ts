import type { FastifyReply, FastifyRequest } from 'fastify';

export const SERVICE_SECRET_HEADER = 'x-service-secret';

export function getServiceSecret(): string | undefined {
  return process.env.AUTOMATE_SERVICE_SECRET;
}

function getProvidedSecret(req: FastifyRequest): string | undefined {
  const headerSecret = req.headers[SERVICE_SECRET_HEADER];
  if (typeof headerSecret === 'string' && headerSecret.length > 0) {
    return headerSecret;
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  return undefined;
}

export async function requireServiceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = getServiceSecret();
  if (!secret) {
    await reply.status(503).send({ error: 'Service auth not configured' });
    return;
  }

  const provided = getProvidedSecret(req);
  if (!provided) {
    await reply.status(401).send({ error: 'Service authentication required' });
    return;
  }

  if (provided !== secret) {
    await reply.status(403).send({ error: 'Invalid service secret' });
  }
}

export function buildServiceAuthHeaders(secret: string): Record<string, string> {
  return { [SERVICE_SECRET_HEADER]: secret };
}
