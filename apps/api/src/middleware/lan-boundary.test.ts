import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLIENT_CIDRS } from '@automate/config';
import { createErrorBoundary } from '../errors/boundary.js';
import { createClientAllowlist } from './client-allowlist.js';
import { createOriginCheck } from './origin-check.js';

function app(clientAddress: string, enabled = true): Hono {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'R',
  });
  return new Hono()
    .onError(onError)
    .use(
      '*',
      createClientAllowlist({
        cidrs: DEFAULT_CLIENT_CIDRS,
        enabled,
        clientKey: () => clientAddress,
      }),
    )
    .use('*', createOriginCheck({ allowedOrigins: ['https://automate.local'] }))
    .get('/api/v1/runs', (c) => c.json({ ok: true }))
    .post('/api/v1/runs', (c) => c.json({ ok: true }));
}

describe('the client allowlist', () => {
  it('admits a LAN client and refuses a public address with a stable code', async () => {
    expect((await app('192.168.1.40').request('/api/v1/runs')).status).toBe(200);
    const refused = await app('203.0.113.9').request('/api/v1/runs');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'CLIENT_NOT_ALLOWED' } });
  });

  it('filters nothing on a loopback install', async () => {
    expect((await app('203.0.113.9', false).request('/api/v1/runs')).status).toBe(200);
  });
});

describe('the cross-site check', () => {
  const post = (headers: Record<string, string>) =>
    app('192.168.1.40').request('http://192.168.1.10:8080/api/v1/runs', {
      method: 'POST',
      headers: { host: '192.168.1.10:8080', ...headers },
    });

  it('refuses a POST from another origin on the same network', async () => {
    const refused = await post({ origin: 'http://192.168.1.77:3000' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'CROSS_SITE_REQUEST' } });
  });

  it('refuses an opaque origin and cross-site fetch metadata', async () => {
    expect((await post({ origin: 'null' })).status).toBe(403);
    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('admits the dashboard on its own host, an allowlisted origin, and a client with no origin', async () => {
    expect((await post({ origin: 'http://192.168.1.10:8080' })).status).toBe(200);
    expect((await post({ origin: 'https://automate.local' })).status).toBe(200);
    expect((await post({})).status).toBe(200);
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('never blocks a read', async () => {
    const read = await app('192.168.1.40').request('/api/v1/runs', {
      headers: { origin: 'http://evil.example' },
    });
    expect(read.status).toBe(200);
  });
});
