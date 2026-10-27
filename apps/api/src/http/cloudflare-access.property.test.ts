import { generateKeyPairSync, randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import { createCloudflareAccessVerifier } from './cloudflare-access.js';

/**
 * Property suite for invariant CFA-1 in `docs/quality/property-invariants.json`: a token
 * changed anywhere after Cloudflare signed it never verifies. Fixed seed and `numRuns`; the
 * signing key is generated at runtime, once per process.
 */
const SEED = 20261027;
const params = { seed: SEED, numRuns: 120 } as const;

const kid = randomUUID();
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateJwk = { ...privateKey.export({ format: 'jwk' }), kid, alg: 'RS256' as const };
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' };
const settings = { teamDomain: 'acme.cloudflareaccess.com', audience: 'aud-1' };
const keySet = async () => new Response(JSON.stringify({ keys: [publicJwk] }));

const now = Math.floor(Date.now() / 1000);
const genuine = await sign(
  {
    aud: ['aud-1'],
    email: 'ana@example.com',
    sub: 'user-1',
    iss: 'https://acme.cloudflareaccess.com',
    iat: now - 5,
    exp: now + 3600,
  },
  privateJwk,
);

/** One character of the token replaced by a different base64url character. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const mutationArb = fc.record({
  at: fc.integer({ min: 0, max: genuine.length - 1 }),
  with: fc.constantFrom(...BASE64URL.split('')),
});

function mutate(token: string, at: number, replacement: string): string {
  return `${token.slice(0, at)}${replacement}${token.slice(at + 1)}`;
}

describe('CFA-1: a token changed after signing never verifies', () => {
  it('a single changed character anywhere is refused', async () => {
    const verifier = createCloudflareAccessVerifier(settings, { fetch: keySet });
    expect((await verifier.verify(genuine)).ok).toBe(true);
    await fc.assert(
      fc.asyncProperty(mutationArb, async ({ at, with: replacement }) => {
        fc.pre(genuine[at] !== '.' && genuine[at] !== replacement);
        const changed = mutate(genuine, at, replacement);
        // Base64url's last character can carry unused bits; a change confined to them
        // decodes to the same bytes and is the same token. Only a real change is a mutation.
        fc.pre(
          changed
            .split('.')
            .map((part) => Buffer.from(part, 'base64url').toString('hex'))
            .join() !==
            genuine
              .split('.')
              .map((part) => Buffer.from(part, 'base64url').toString('hex'))
              .join(),
        );
        expect((await verifier.verify(changed)).ok).toBe(false);
      }),
      params,
    );
  });

  it('pinned: the email changed to an administrator is refused', async () => {
    const verifier = createCloudflareAccessVerifier(settings, { fetch: keySet });
    const [header, payload, signature] = genuine.split('.');
    const claims = JSON.parse(Buffer.from(String(payload), 'base64url').toString()) as object;
    const forged = Buffer.from(JSON.stringify({ ...claims, email: 'admin@example.com' })).toString(
      'base64url',
    );
    expect((await verifier.verify(`${String(header)}.${forged}.${String(signature)}`)).ok).toBe(
      false,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a verifier that ignores the signature', async () => {
    // A stand-in that decodes and trusts the payload: the property above must catch it.
    const trusting = async (token: string): Promise<boolean> => token.split('.').length === 3;
    await expect(
      fc.assert(
        fc.asyncProperty(mutationArb, async ({ at, with: replacement }) => {
          fc.pre(genuine[at] !== '.' && genuine[at] !== replacement);
          expect(await trusting(mutate(genuine, at, replacement))).toBe(false);
        }),
        params,
      ),
    ).rejects.toThrow();
  });
});
