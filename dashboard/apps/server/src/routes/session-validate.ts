/**
 * session-validate.ts — Session introspection endpoint for unified auth gateway
 *
 * GET /api/auth/validate-session?token=<token>
 *   - Protected by service auth (fail-closed): if AUTOMATE_SERVICE_SECRET is not set,
 *     returns 503. Never allows unauthenticated access when this endpoint is reachable.
 *   - Feature-gated behind `unified-auth` flag (checked in route body)
 *   - Returns user info when the session token is valid
 *   - Returns { valid: false } when the token is expired or invalid
 */
import type { FastifyInstance } from 'fastify';
import { isEnabled } from '../services/feature-flags.js';
import { requireServiceAuth } from '../services/service-auth.js';
import { validateSessionToken, loadAuthConfig } from '../services/auth.js';

export interface SessionValidateOptions {
  serviceSecret?: string;
}

/**
 * Extract the keyId from a session token without full validation.
 * Token format: keyId:timestamp:signature
 */
function extractKeyId(token: string): string | null {
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1) return null;
  const keyId = token.slice(0, colonIndex);
  return keyId || null;
}

export async function sessionValidateRoutes(
  app: FastifyInstance,
  _opts: SessionValidateOptions,
): Promise<void> {
  app.get('/api/auth/validate-session', {
    preHandler: [requireServiceAuth],
  }, async (request, reply) => {
    if (!isEnabled('unified-auth')) {
      return reply.code(404).send({ error: "Feature 'unified-auth' is not enabled" });
    }

    const query = request.query as { token?: string };
    const token = query.token;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return reply.code(400).send({ error: 'token query parameter is required' });
    }

    const isValid = validateSessionToken(token);
    if (!isValid) {
      return reply.code(200).send({ valid: false });
    }

    const keyId = extractKeyId(token);
    if (!keyId) {
      return reply.code(200).send({ valid: false });
    }

    const config = loadAuthConfig();
    const apiKey = config.keys.find((k) => k.id === keyId);

    return reply.code(200).send({
      valid: true,
      userId: keyId,
      username: apiKey?.name ?? keyId,
    });
  });
}
