import bearerAuth from '@fastify/bearer-auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadAuthConfig, SESSION_COOKIE_NAME, validateSessionTokenAsync } from '../services/auth.js';
import { validateApiKeyDualRead } from '../services/api-key-db.js';

/**
 * @fastify/bearer-auth v10 decorates `verifyBearerAuth` as a **callback-style**
 * function: `(request, reply, done) => void`.  Fastify 5 async hooks do NOT
 * supply a `done` callback, so we must wrap the call in a Promise.
 */
type BearerAuthFastify = FastifyInstance & {
  verifyBearerAuth: (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void;
};

export async function registerAuthPlugin(app: FastifyInstance) {
  await app.register(bearerAuth, {
    keys: new Set<string>([]),
    auth: async (key: string) => {
      return validateApiKeyDualRead(key);
    },
    addHook: false,
    errorResponse: (err: Error) => ({
      error: 'Unauthorized',
      message: err.message,
      statusCode: 401,
    }),
  });

  app.addHook('onRequest', async (request, reply) => {
    const config = loadAuthConfig();
    if (!config.enabled || config.keys.length === 0) return;

    const url = request.url;

    if (
      url.startsWith('/health')
      || url.startsWith('/artifacts/')
      || url === '/ws'
      || url === '/api/auth/login'
      || url === '/api/auth/logout'
      || url === '/api/auth/status'
      || url.startsWith('/api/auth/saml')
      || (url.startsWith('/docs') && process.env.NODE_ENV !== 'production')
      || (process.env.GATE_PUBLIC === 'true' && url.startsWith('/api/ci/gate'))
      || !url.startsWith('/api/')
    ) {
      return;
    }

    const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];
    if (typeof sessionToken === 'string' && await validateSessionTokenAsync(sessionToken)) {
      return;
    }

    // verifyBearerAuth is callback-based (request, reply, done).
    // Wrap in a Promise so the async onRequest hook awaits correctly.
    return new Promise<void>((resolve, reject) => {
      (app as BearerAuthFastify).verifyBearerAuth(request, reply, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
