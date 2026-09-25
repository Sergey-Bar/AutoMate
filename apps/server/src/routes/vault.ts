import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { timingSafeEqual } from 'node:crypto';
import { validateOrReply } from '../lib/validate-or-reply.js';

const UnlockBody = z.object({ password: z.string().min(1) });
const CredentialsBody = z.object({ credentials: z.record(z.string(), z.string()) });

/** Per-IP in-memory rate limiter for vault unlock attempts. */
const UNLOCK_RATE_LIMIT = {
  maxAttempts: 5,
  windowMs: 60_000,
};

const unlockAttemptsByIp = new Map<string, number[]>();

function isUnlockRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = unlockAttemptsByIp.get(ip) ?? [];
  const recent = timestamps.filter((ts) => now - ts < UNLOCK_RATE_LIMIT.windowMs);
  unlockAttemptsByIp.set(ip, recent);
  return recent.length >= UNLOCK_RATE_LIMIT.maxAttempts;
}

function recordUnlockAttempt(ip: string): void {
  const timestamps = unlockAttemptsByIp.get(ip) ?? [];
  timestamps.push(Date.now());
  unlockAttemptsByIp.set(ip, timestamps);
}

/** Reset rate limit state — exported for testing only. */
export function _resetUnlockRateLimit(): void {
  unlockAttemptsByIp.clear();
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if a === b without leaking length or character differences.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const ConnectorParamSchema = z.object({ connector: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/) });

export interface VaultRouteDeps {
  vaultService: {
    unlock(password: string): Promise<void>;
    lock(): void;
    isUnlocked(): boolean;
    setCredential(connectorName: string, secret: string): Promise<void>;
    getCredential(connectorName: string): Promise<string | null>;
  };
  expectedPassword?: string;
}

export async function vaultRoutes(app: FastifyInstance, deps: VaultRouteDeps): Promise<void> {
  app.get('/api/vault/status', async (): Promise<unknown> => {
    return { isUnlocked: deps.vaultService.isUnlocked() };
  });

  app.post('/api/vault/unlock', async (request, reply): Promise<unknown> => {
    const ip = request.ip;

    if (isUnlockRateLimited(ip)) {
      return reply.code(429).send({ error: 'Too many unlock attempts. Try again later.' });
    }

    const body = await validateOrReply(UnlockBody, request, reply);
    if (!body) return;

    const { password } = body;

    if (deps.expectedPassword === undefined) {
      return reply.code(403).send({
        error: 'Vault password not configured. Set the VAULT_PASSWORD environment variable.',
      });
    }

    recordUnlockAttempt(ip);

    if (!safeCompare(password, deps.expectedPassword)) {
      reply.code(401).send({ error: 'Unlock failed' });
      return;
    }
    try {
      await deps.vaultService.unlock(password);
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof Error) {
        app.log.error({ err }, 'Vault unlock failed');
      }
      reply.code(500).send({ error: 'Unlock failed' });
    }
  });

  app.post('/api/vault/lock', async (): Promise<unknown> => {
    deps.vaultService.lock();
    return { ok: true };
  });

  app.put('/api/vault/credentials/:connector', async (request, reply): Promise<unknown> => {
    if (!deps.vaultService.isUnlocked()) {
      reply.code(403).send({ error: 'Vault is locked' });
      return;
    }

    const params = ConnectorParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid connector name' });
    }
    const { connector } = params.data;

    const body = await validateOrReply(CredentialsBody, request, reply);
    if (!body) return;

    const { credentials } = body;
    try {
      await deps.vaultService.setCredential(connector, JSON.stringify(credentials));
      return { ok: true };
    } catch (err: unknown) {
      app.log.error({ err, connector }, 'Failed to save vault credentials');
      reply.code(500).send({ error: 'Failed to save credentials' });
    }
  });
}
