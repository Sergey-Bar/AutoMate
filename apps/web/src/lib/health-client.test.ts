import { describe, expect, it, vi } from 'vitest';
import { HEALTH_DIMENSIONS } from '@automate/shared-contracts';
import { createHealthClient } from './health-client.js';
import { QaApiError } from './qa-client.js';

const GRADE = {
  score: 90,
  letter: 'A',
  incomplete: false,
  incompleteReason: null,
  cappedBy: 'security',
  cappingValue: 90,
  limiter: 'Limited by Security',
  dimensions: HEALTH_DIMENSIONS.map((dimension) => ({
    dimension,
    measured: false,
    score: null,
    letter: null,
    weight: 1,
    tools: [],
    openFindings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    summary: [],
  })),
  gates: [
    { id: 'open-secret', tripped: false, enabled: true, statement: 's' },
    { id: 'fixable-critical-vulnerability', tripped: false, enabled: true, statement: 's' },
    { id: 'failing-tests', tripped: false, enabled: true, statement: 's' },
  ],
  fixNext: [],
};
const FINDING = {
  id: 'f1',
  branch: 'main',
  fingerprint: 'fp',
  tool: 't',
  ruleId: 'r',
  kind: 'issue',
  severity: 'low',
  dimension: 'security',
  path: null,
  line: null,
  message: 'm',
  helpUri: null,
  fixAvailable: null,
  state: 'accepted',
  triageReason: 'x',
  triageExpiresAt: null,
  triagedBy: 'op',
  owner: null,
  firstSeenAt: '2026-10-23T00:00:00.000Z',
  lastSeenAt: '2026-10-23T00:00:00.000Z',
};
const TOKEN = {
  id: 't1',
  name: 'n',
  role: 'viewer',
  projectId: null,
  displayPrefix: 'amt_x',
  createdBy: 's',
  createdAt: 'x',
  lastUsedAt: null,
  revokedAt: null,
};

/** Answers by path, records every request. */
function server(routes: Record<string, unknown>, status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown; credentials: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://api.test', '').split('?')[0] ?? '';
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      credentials: init?.credentials,
    });
    const key = `${init?.method ?? 'GET'} ${path}`;
    return new Response(JSON.stringify(routes[key] ?? { error: { message: `no route ${key}` } }), {
      status: key in routes ? status : 404,
    });
  });
  return { client: createHealthClient('https://api.test', fetchImpl as typeof fetch), calls };
}

describe('createHealthClient', () => {
  it('reads the portfolio, the health, findings with a query, and history, all with credentials', async () => {
    const { client, calls } = server({
      'GET /api/v1/portfolio': { projects: [] },
      'GET /api/v1/projects/p%201/health': {
        projectId: 'p 1',
        name: 'n',
        branch: 'main',
        evaluatedAt: '2026-10-23T00:00:00.000Z',
        grade: GRADE,
        reports: [],
      },
      'GET /api/v1/projects/p%201/health/findings': {
        findings: [FINDING],
        total: 1,
        offset: 0,
        limit: 25,
      },
      'GET /api/v1/projects/p%201/health/history': { projectId: 'p', branch: 'main', points: [] },
    });
    expect((await client.getPortfolio()).projects).toEqual([]);
    expect((await client.getHealth('p 1')).grade.letter).toBe('A');
    await client.getFindings('p 1', { severity: 'high', q: '', limit: 25, offset: 0 });
    await client.getFindings('p 1');
    await client.getHistory('p 1', 30.7);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.test/api/v1/portfolio',
      'https://api.test/api/v1/projects/p%201/health',
      'https://api.test/api/v1/projects/p%201/health/findings?severity=high&limit=25&offset=0',
      'https://api.test/api/v1/projects/p%201/health/findings',
      'https://api.test/api/v1/projects/p%201/health/history?days=30',
    ]);
    expect(calls.every((call) => call.credentials === 'include')).toBe(true);
  });

  it('triages, starts a scan, and writes settings', async () => {
    const { client, calls } = server({
      'POST /api/v1/projects/p/health/findings/f1/triage': FINDING,
      'POST /api/v1/projects/p/health/scan': {
        runIds: ['r'],
        scanners: ['gitleaks'],
        notConfigured: [],
      },
      'GET /api/v1/projects/p/health/settings': { alerts: {}, schedule: null, codeowners: false },
      'PUT /api/v1/projects/p/health/schedule': { cadence: 'weekly', scanners: ['gitleaks'] },
      'PUT /api/v1/projects/p/health/alerts': { alerts: { slackChannel: '#q' } },
    });
    expect(
      (
        await client.triage('p', 'f1', {
          state: 'accepted',
          reason: 'x',
          expiresAt: '2026-12-01T00:00:00.000Z',
        })
      ).state,
    ).toBe('accepted');
    expect((await client.startScan('p')).scanners).toEqual(['gitleaks']);
    expect((await client.getSettings('p')).codeowners).toBe(false);
    expect((await client.setSchedule('p', 'weekly')).cadence).toBe('weekly');
    await client.setAlerts('p', { slackChannel: '#q' });
    expect(calls.map((call) => [call.method, call.body])).toEqual([
      ['POST', { state: 'accepted', reason: 'x', expiresAt: '2026-12-01T00:00:00.000Z' }],
      ['POST', {}],
      ['GET', undefined],
      ['PUT', { cadence: 'weekly' }],
      ['PUT', { slackChannel: '#q' }],
    ]);
  });

  it('signs in with a token through token-login, and with anything else through the key login', async () => {
    const { client, calls } = server({
      'POST /api/v1/auth/token-login': { role: 'viewer' },
      'POST /api/v1/auth/login': { sessionId: 's' },
      'POST /api/v1/auth/token-logout': { ok: true },
      'POST /api/v1/auth/logout': { ok: true },
      'GET /api/v1/auth/whoami': { actor: 'session', role: 'admin', mode: 'enforced' },
    });
    await client.signIn('  amt_abc ');
    await client.signIn('installation-key');
    await client.signOut();
    expect((await client.whoami()).role).toBe('admin');
    expect(calls.map((call) => [call.url.replace('https://api.test', ''), call.body])).toEqual([
      ['/api/v1/auth/token-login', { token: 'amt_abc' }],
      ['/api/v1/auth/login', { apiKey: 'installation-key' }],
      ['/api/v1/auth/token-logout', {}],
      ['/api/v1/auth/logout', {}],
      ['/api/v1/auth/whoami', undefined],
    ]);
  });

  it('reads every credential source the API reports, so a person signed in by SSO gets in', async () => {
    // The API answers `source: 'user'` for an OIDC session; a schema without it threw on
    // whoami and left every single-sign-on user on the sign-in screen.
    for (const source of ['token', 'user', 'cloudflare', 'installation', 'anonymous']) {
      const { client } = server({
        'GET /api/v1/auth/whoami': {
          actor: 'user:u1',
          role: 'viewer',
          mode: 'enforced',
          profile: 'team',
          source,
        },
      });
      expect((await client.whoami()).source, source).toBe(source);
    }
  });

  it('signs out even when the key session is already gone', async () => {
    const { client } = server({ 'POST /api/v1/auth/token-logout': { ok: true } });
    await expect(client.signOut()).resolves.toBeUndefined();
  });

  it('lists, issues and revokes access tokens', async () => {
    const { client, calls } = server({
      'GET /api/v1/access-tokens': { tokens: [TOKEN] },
      'POST /api/v1/access-tokens': { token: 'amt_new', summary: TOKEN },
      'DELETE /api/v1/access-tokens/t1': { ...TOKEN, revokedAt: '2026-10-24T00:00:00.000Z' },
    });
    expect(await client.listTokens()).toEqual([TOKEN]);
    expect((await client.createToken({ name: 'n', role: 'viewer' })).token).toBe('amt_new');
    expect((await client.revokeToken('t1')).revokedAt).not.toBeNull();
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'DELETE']);
  });

  it('throws the server’s sentence for a refusal', async () => {
    const { client } = server(
      { 'GET /api/v1/portfolio': { error: { message: 'Sign in, or send an access token' } } },
      401,
    );
    const failure = await client.getPortfolio().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QaApiError);
    expect((failure as QaApiError).detail).toBe('Sign in, or send an access token');
  });
});

describe('device pairing', () => {
  it('issues a code as an admin and pairs a device with it', async () => {
    const issued = {
      id: 'p-1',
      code: '042137',
      deviceName: 'Phone',
      role: 'viewer',
      expiresAt: '2026-10-25T12:10:00.000Z',
      pairUrl: 'https://automate.local:8443/dashboard/pair?code=042137',
    };
    const { client, calls } = server({
      'POST /api/v1/pairing-codes': issued,
      'POST /api/v1/pair': { role: 'viewer', deviceName: 'Phone' },
    });
    expect(await client.issuePairingCode({ deviceName: 'Phone', role: 'viewer' })).toEqual(issued);
    expect(await client.pair(' 042137 ')).toEqual({ role: 'viewer', deviceName: 'Phone' });
    expect(calls.map((call) => [call.url.replace('https://api.test', ''), call.body])).toEqual([
      ['/api/v1/pairing-codes', { deviceName: 'Phone', role: 'viewer' }],
      ['/api/v1/pair', { code: '042137' }],
    ]);
  });
});
