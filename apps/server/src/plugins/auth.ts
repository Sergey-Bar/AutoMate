import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export interface AuthPluginOptions {
  apiKey?: string;
}

/**
 * Constant-time API key comparison.
 */
function safeKeyCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Optional API key authentication plugin for Automate.
 *
 * When `AUTOMATE_API_KEY` is set, all `/api/*` routes require a valid
 * `Authorization: Bearer <key>` header.  The `/health` endpoint and
 * WebSocket upgrade (`/ws`) are always exempt so load-balancers and
 * the real-time event stream keep working without credentials.
 *
 * When no API key is configured the plugin is a no-op, preserving
 * backward compatibility for local development.
 */
export async function registerAuthPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  const { apiKey } = options;

  if (!apiKey) {
    app.log.warn('AUTOMATE_API_KEY is not set — all routes are unauthenticated. Set it in production.');
    return;
  }

  app.addHook('onRequest', async (request, reply) => {
    // Parse the pathname to prevent path traversal bypasses
    let pathname: string;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      pathname = request.url;
    }

    // Public endpoints — strict match, never require auth
    if (pathname === '/health' || pathname === '/ws') {
      return;
    }

    // Only protect /api/* routes
    if (!pathname.startsWith('/api/')) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // Strip 'Bearer '
    if (!safeKeyCompare(token, apiKey)) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid API key' });
    }
  });
}
