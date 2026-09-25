import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createReporterRoutes, adaptLegacyEvent, type ReporterRouteOptions } from './reporter.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(secret?: string, options?: Omit<ReporterRouteOptions, 'repository' | 'bus'>): Hono {
  const app = new Hono();
  app.route('/', createReporterRoutes(secret, options));
  return app;
}

function buildAppWithRepo(repo: InMemoryRunRepository, secret?: string): Hono {
  const app = new Hono();
  app.route('/', createReporterRoutes(secret, { repository: repo }));
  return app;
}

const LEGACY_EVENT = {
  type: 'run:start' as const,
  runId: 'run-legacy-001',
  payload: { total: 5, projects: ['chromium'] },
};

const VERSIONED_EVENT = {
  version: '1',
  type: 'run:started',
  runId: 'run-versioned-001',
  timestamp: '2026-05-05T10:00:00.000Z',
  payload: { total: 3, branch: 'main' },
};

// ---------------------------------------------------------------------------
// Reporter compatibility — legacy format
// ---------------------------------------------------------------------------

describe('Reporter routes — legacy compatibility', () => {
  it('accepts legacy run:start event and returns 202', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['runId']).toBe('run-legacy-001');
    expect(body['type']).toBe('run:start');
    expect(body['version']).toBe('1');
  });

  it('accepts all 8 legacy event types', async () => {
    const app = buildApp();
    const types = [
      'run:start',
      'test:begin',
      'test:end',
      'step:begin',
      'step:end',
      'stdout',
      'stderr',
      'run:end',
    ] as const;
    for (const type of types) {
      const res = await app.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, runId: 'run-1', payload: {} }),
      });
      expect(res.status, `Expected 202 for legacy type "${type}"`).toBe(202);
    }
  });

  it('normalizes legacy event: injects version="1" and timestamp', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['version']).toBe('1');
  });

  it('returns 400 for legacy event missing runId', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', payload: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
    expect((body['error'] as string)).toContain('Invalid legacy reporter event');
  });

  it('returns 400 for unknown legacy event type', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unknown:custom', runId: 'run-1', payload: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['error']).toContain('Invalid JSON body');
  });

  it('returns 400 when body is an array', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([LEGACY_EVENT]),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Reporter compatibility — new versioned format
// ---------------------------------------------------------------------------

describe('Reporter routes — versioned format', () => {
  it('rejects payload with version but no timestamp and normalizes error shape', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: '2',
        type: 'run:start',
        runId: 'run-partial-1',
        payload: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
    expect((body['error'] as string)).toContain('Invalid versioned reporter event');
    expect(body['details']).toBeTypeOf('object');
    expect(Array.isArray(body['details'])).toBe(false);
  });

  it('rejects payload with timestamp but no version and normalizes error shape', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: '2026-05-05T10:00:00.000Z',
        type: 'run:start',
        runId: 'run-partial-2',
        payload: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
    expect((body['error'] as string)).toContain('Invalid versioned reporter event');
    expect(body['details']).toBeTypeOf('object');
    expect(Array.isArray(body['details'])).toBe(false);
  });

  it('accepts a new versioned event and returns 202', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VERSIONED_EVENT),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['runId']).toBe('run-versioned-001');
    expect(body['type']).toBe('run:started');
    expect(body['version']).toBe('1');
  });

  it('accepts versioned event with arbitrary type string', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: '2',
        type: 'suite:nested',
        runId: 'run-xyz',
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { depth: 3 },
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['version']).toBe('2');
    expect(body['type']).toBe('suite:nested');
  });

  it('returns 400 for versioned event missing runId', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: '1',
        type: 'run:started',
        timestamp: '2026-05-05T10:00:00.000Z',
        payload: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('Invalid versioned reporter event');
  });
});

// ---------------------------------------------------------------------------
// Auth — negative cases (missing / invalid REPORTER_SECRET)
// ---------------------------------------------------------------------------

describe('Reporter routes — auth negative cases', () => {
  it('returns 401 when secret set but no token provided', async () => {
    const app = buildApp('super-secret');
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('Missing');
  });

  it('returns 403 when secret set but wrong token in Authorization header', async () => {
    const app = buildApp('super-secret');
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token',
      },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('Invalid');
  });

  it('returns 403 when secret set but wrong token in query param (allowQueryToken enabled)', async () => {
    const app = buildApp('super-secret', { allowQueryToken: true });
    const res = await app.request('/api/v1/reporter/events?token=bad-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('Invalid');
  });

  it('returns 403 when empty string token provided via query param', async () => {
    const app = buildApp('super-secret');
    const res = await app.request('/api/v1/reporter/events?token=', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    // Empty query token is treated as absent → 401
    expect(res.status).toBe(401);
  });

  it('enforces auth when reporterSecret is empty string (not treated as open mode)', async () => {
    const app = buildApp('');
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Auth — positive cases
// ---------------------------------------------------------------------------

describe('Reporter routes — auth positive cases', () => {
  it('allows request when no REPORTER_SECRET configured (open mode)', async () => {
    const app = buildApp(undefined);
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(202);
  });

  it('accepts valid token via Authorization Bearer header', async () => {
    const app = buildApp('super-secret');
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer super-secret',
      },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(202);
  });

  it('accepts valid token via ?token= query param (allowQueryToken enabled)', async () => {
    const app = buildApp('super-secret', { allowQueryToken: true });
    const res = await app.request('/api/v1/reporter/events?token=super-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Query token compatibility — allowQueryToken flag behaviour
// ---------------------------------------------------------------------------

describe('Reporter routes — query token compatibility', () => {
  it('rejects ?token= when allowQueryToken is false (default) — returns 401', async () => {
    // Default: allowQueryToken not set → query token ignored → no token found
    const app = buildApp('correct-secret-value');
    const res = await app.request('/api/v1/reporter/events?token=correct-secret-value', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('Missing');
  });

  it('accepts ?token= when allowQueryToken is true — returns 202', async () => {
    const app = buildApp('correct-secret-value', { allowQueryToken: true });
    const res = await app.request('/api/v1/reporter/events?token=correct-secret-value', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(202);
  });

  it('Authorization header always works regardless of allowQueryToken setting', async () => {
    // allowQueryToken: false (default) — header auth must still work
    const appDefault = buildApp('correct-secret-value');
    const resDefault = await appDefault.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer correct-secret-value',
      },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(resDefault.status).toBe(202);

    // allowQueryToken: true — header auth must also still work
    const appEnabled = buildApp('correct-secret-value', { allowQueryToken: true });
    const resEnabled = await appEnabled.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer correct-secret-value',
      },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(resEnabled.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// adaptLegacyEvent unit tests
// ---------------------------------------------------------------------------

describe('adaptLegacyEvent', () => {
  it('converts run:start to normalized shape with version=1', () => {
    const raw = { type: 'run:start' as const, runId: 'r1', payload: { total: 2 } };
    const normalized = adaptLegacyEvent(raw);
    expect(normalized.version).toBe('1');
    expect(normalized.type).toBe('run:start');
    expect(normalized.runId).toBe('r1');
    expect(normalized.payload).toEqual({ total: 2 });
    expect(typeof normalized.timestamp).toBe('string');
    expect(normalized.timestamp.length).toBeGreaterThan(0);
  });

  it('preserves payload as-is', () => {
    const payload = { testId: 'test-1', status: 'failed', retry: 1 };
    const raw = { type: 'test:end' as const, runId: 'r2', payload };
    const normalized = adaptLegacyEvent(raw);
    expect(normalized.payload).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
// Reporter upload ingestion (JSON upload path)
// ---------------------------------------------------------------------------

describe('Reporter routes — upload ingestion', () => {
  it('persists uploaded run and tests when repository is configured', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'upload-run-001',
        status: 'passed',
        branch: 'main',
        commitSha: 'abc123',
        tests: [
          {
            testId: 't-1',
            title: 'login works',
            file: 'tests/auth/login.spec.ts',
            status: 'passed',
            durationMs: 120,
          },
          {
            id: 't-2',
            title: 'logout works',
            file: '../unsafe/path.spec.ts',
            status: 'failed',
            durationMs: 80,
          },
        ],
      }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['runId']).toBe('upload-run-001');
    expect(body['ingestedTests']).toBe(2);

    const run = await repo.getRun('upload-run-001');
    expect(run).not.toBeNull();
    expect(run?.status).toBe('passed');
    expect(run?.total).toBe(2);
    expect(run?.passed).toBe(1);
    expect(run?.failed).toBe(1);
    expect(run?.branch).toBe('main');
    expect(run?.commitSha).toBe('abc123');

    const tests = await repo.listTests('upload-run-001');
    expect(tests).toHaveLength(2);
    expect(tests.find((t) => t.id === 't-1')?.status).toBe('passed');
    // Path traversal must be sanitized before persistence.
    expect(tests.find((t) => t.id === 't-2')?.file).toBe('path.spec.ts');
  });

  it('returns 503 when upload persistence repository is not configured', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'upload-run-002' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('not configured');
  });

  it('returns 400 for invalid upload payload', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);
    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: '', tests: [{ title: 'missing id', file: 'a', status: 'passed' }] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body['error'] as string)).toContain('Invalid reporter upload payload');
  });

  it('enforces reporter auth for upload endpoint when secret is configured', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo, 'upload-secret');

    const unauthorized = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'upload-run-003' }),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer upload-secret',
      },
      body: JSON.stringify({ runId: 'upload-run-003', tests: [] }),
    });
    expect(authorized.status).toBe(202);
  });

  it('accepts multipart Playwright JSON upload artifact', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const report = {
      suites: [
        {
          title: 'Auth',
          file: 'tests/auth.spec.ts',
          specs: [
            {
              title: 'logs in',
              tests: [
                {
                  results: [{ status: 'passed', duration: 145 }],
                },
              ],
            },
          ],
          suites: [],
        },
      ],
    };

    const form = new FormData();
    form.set('runId', 'upload-playwright-001');
    form.set('artifactType', 'playwright-json');
    form.set('file', new File([JSON.stringify(report)], 'playwright-report.json', { type: 'application/json' }));

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(202);
    const run = await repo.getRun('upload-playwright-001');
    expect(run).not.toBeNull();
    expect(run?.total).toBe(1);
    expect(run?.passed).toBe(1);

    const tests = await repo.listTests('upload-playwright-001');
    expect(tests).toHaveLength(1);
    expect(tests[0]?.title).toContain('logs in');
    expect(tests[0]?.status).toBe('passed');
  });

  it('accepts multipart JUnit XML upload artifact', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const junitXml = [
      '<testsuite name="suite" tests="2" failures="1">',
      '<testcase classname="auth" name="login" file="tests/auth.spec.ts" time="0.12" />',
      '<testcase classname="auth" name="logout" file="tests/auth.spec.ts" time="0.05"><failure>boom</failure></testcase>',
      '</testsuite>',
    ].join('');

    const form = new FormData();
    form.set('runId', 'upload-junit-001');
    form.set('artifactType', 'junit');
    form.set('file', new File([junitXml], 'junit.xml', { type: 'application/xml' }));

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(202);
    const run = await repo.getRun('upload-junit-001');
    expect(run).not.toBeNull();
    expect(run?.total).toBe(2);
    expect(run?.failed).toBe(1);

    const tests = await repo.listTests('upload-junit-001');
    expect(tests).toHaveLength(2);
    expect(tests.some((t) => t.status === 'failed')).toBe(true);
  });

  it('handles additional Playwright result statuses and nested suites', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const report = {
      suites: [
        {
          title: 'Parent',
          file: 'tests/parent.spec.ts',
          specs: [
            {
              title: 'timed out test',
              tests: [{ results: [{ status: 'timedOut', duration: 3000 }] }],
            },
            {
              title: 'interrupted test',
              tests: [{ results: [{ status: 'interrupted', duration: 50 }] }],
            },
            {
              title: 'skipped test',
              tests: [{ results: [{ status: 'skipped', duration: 0 }] }],
            },
          ],
          suites: [
            {
              title: 'Child',
              file: 'tests/child.spec.ts',
              specs: [
                {
                  title: 'unknown status fallback',
                  tests: [{ results: [{ status: 'something-else' }] }],
                },
              ],
              suites: [],
            },
          ],
        },
      ],
    };

    const form = new FormData();
    form.set('runId', 'upload-playwright-branches-001');
    form.set('artifactType', 'playwright-json');
    form.set('file', new File([JSON.stringify(report)], 'playwright-branches.json', { type: 'application/json' }));

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(202);
    const run = await repo.getRun('upload-playwright-branches-001');
    expect(run?.status).toBe('failed');

    const tests = await repo.listTests('upload-playwright-branches-001');
    expect(tests).toHaveLength(4);
    expect(tests.some((t) => t.status === 'timedOut')).toBe(true);
    expect(tests.some((t) => t.status === 'failed')).toBe(true);
    expect(tests.some((t) => t.status === 'skipped')).toBe(true);
    expect(tests.some((t) => t.status === 'queued')).toBe(true);
  });

  it('parses junit skipped and error outcomes', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const junitXml = [
      '<testsuite name="suite" tests="3" failures="1">',
      '<testcase name="smoke" file="tests/smoke.spec.ts" time="0.02"><skipped /></testcase>',
      '<testcase name="api error" classname="api" time="0.03"><error>oops</error></testcase>',
      '<testcase name="ok" file="tests/ok.spec.ts" time="0.04" />',
      '</testsuite>',
    ].join('');

    const form = new FormData();
    form.set('runId', 'upload-junit-branches-001');
    form.set('artifactType', 'junit');
    form.set('file', new File([junitXml], 'junit-branches.xml', { type: 'application/xml' }));

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(202);
    const tests = await repo.listTests('upload-junit-branches-001');
    expect(tests).toHaveLength(3);
    expect(tests.some((t) => t.status === 'skipped')).toBe(true);
    expect(tests.some((t) => t.status === 'failed')).toBe(true);
    expect(tests.some((t) => t.status === 'passed')).toBe(true);
  });

  it('keeps run open when upload status is running and honors summary override', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'upload-running-001',
        status: 'running',
        summary: {
          total: 10,
          passed: 9,
          failed: 1,
          flaky: 0,
          skipped: 0,
        },
        tests: [
          {
            id: 'r-1',
            title: 'still running',
            file: 'tests/running.spec.ts',
            status: 'running',
            durationMs: null,
          },
        ],
      }),
    });

    expect(res.status).toBe(202);
    const run = await repo.getRun('upload-running-001');
    expect(run).not.toBeNull();
    expect(run?.status).toBe('running');
    expect(run?.finishedAt).toBeNull();
    expect(run?.total).toBe(10);
    expect(run?.passed).toBe(9);
    expect(run?.failed).toBe(1);
  });
});
