import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import type { CallerResolver } from '../http/roles.js';
import { authenticateToken } from '../services/access-service.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { createPairingRoutes } from './pairing.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: 'ws-1' };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: (token) => authenticateToken(options, token),
    hasSession: async (context) =>
      context.req.header('cookie')?.includes('automate_session=valid') === true,
  };
  const app: Hono = withErrorBoundary(
    createPairingRoutes({
      ...options,
      access,
      pepper: 'pairing-route-pepper-that-is-long-enough-12',
      publicAppUrl: 'https://automate.local:8443',
      clientKey: (context) => context.req.header('x-test-client') ?? 'one-client',
    }),
  );
  const admin = { cookie: 'automate_session=valid', 'content-type': 'application/json' };
  return { app, admin };
}

const json = (body: unknown) => JSON.stringify(body);

describe('pairing routes', () => {
  it('only an admin issues a code, and the answer carries a link a QR can hold', async () => {
    const { app, admin } = await setup();
    const anonymous = await app.request('/api/v1/pairing-codes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ deviceName: 'Phone', role: 'viewer' }),
    });
    expect(anonymous.status).toBe(401);
    const issued = await app.request('/api/v1/pairing-codes', {
      method: 'POST',
      headers: admin,
      body: json({ deviceName: 'Phone', role: 'viewer' }),
    });
    expect(issued.status).toBe(201);
    const body = (await issued.json()) as { code: string; pairUrl: string };
    expect(body.pairUrl).toBe(`https://automate.local:8443/dashboard/pair?code=${body.code}`);
  });

  it('a device redeems the code for an httpOnly sign-in cookie of the code’s role', async () => {
    const { app, admin } = await setup();
    const { code } = (await (
      await app.request('/api/v1/pairing-codes', {
        method: 'POST',
        headers: admin,
        body: json({ deviceName: 'Laptop', role: 'operator' }),
      })
    ).json()) as { code: string };
    const paired = await app.request('/api/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ code }),
    });
    expect(paired.status).toBe(200);
    expect(await paired.json()).toMatchObject({ role: 'operator', deviceName: 'Laptop' });
    expect(paired.headers.get('set-cookie')).toMatch(/automate_token=amt_.*HttpOnly/iu);
  });

  it('stops a guessing client after five wrong codes, whatever it sends next', async () => {
    const { app } = await setup();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await app.request('/api/v1/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: json({ code: String(100000 + attempt) }),
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
  });

  it('stops guessing spread across many clients, with an installation-wide budget', async () => {
    const { app } = await setup();
    let limited = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await app.request('/api/v1/pair', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-client': `client-${String(attempt)}`,
        },
        body: json({ code: String(200000 + attempt) }),
      });
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBe(10);
  });
});
