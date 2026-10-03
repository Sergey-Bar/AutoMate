import { describe, it, expect } from 'vitest';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import {
  LEGACY_FLAT_V1_CONTRACT_ID,
  REPORTER_EVENT_VERSION,
  RUN_CONTRACT_VERSION,
} from '@automate/shared-contracts';
import { createReporterRoutes, adaptLegacyEvent, type ReporterRouteOptions } from './reporter.js';
import { junitXmlAdapter } from '@automate/reporter';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { DEFAULT_WORKSPACE_ID } from '../repositories/run-repository.js';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { reporterHarness } from '../test-support/reporter-harness.js';

// ---------------------------------------------------------------------------
/**
 * The boundary's body, named.
 *
 * A reporter reads these programmatically, so the shape is the contract: a `code` to
 * branch on, a `message` to show a person, and a `details` object — always present,
 * empty when there is nothing to say — when the refusal has something specific to add.
 * The suite used to cast every body to `Record<string, unknown>`, which can read any
 * shape and so checked none.
 */
interface ErrorBody {
  /** The success shapes this same file also reads: `ok`, `runId`, `version`. */
  [key: string]: unknown;
  error: {
    code: string;
    message: string;
    requestId: string;
    details: Record<string, unknown> & {
      fieldErrors?: Record<string, unknown>;
      supportedVersions?: string[];
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(
  secret?: string,
  options?: Omit<ReporterRouteOptions, 'repository' | 'bus'>,
): Hono {
  return withErrorBoundary(createReporterRoutes(secret, options));
}

/**
 * A repository and the canonical store behind it, as `index.ts` wires them.
 *
 * Both are required for an upload to land: the canonical row is the authority and the
 * repository rows are its projection. A harness with only the repository answers
 * `503 NOT_CONFIGURED` at the upload door — see `test-support/reporter-harness.ts`.
 */
function buildAppWithRepo(repo: InMemoryRunRepository, secret?: string): Hono {
  return reporterHarness(secret, { repository: repo }).app;
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
    const body = (await res.json()) as ErrorBody;
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
    const body = (await res.json()) as ErrorBody;
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid legacy reporter event');
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid JSON body');
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid versioned reporter event');
    expect(body.error.details).toBeTypeOf('object');
    expect(Array.isArray(body.error.details.fieldErrors)).toBe(false);
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid versioned reporter event');
    expect(body.error.details).toBeTypeOf('object');
    expect(Array.isArray(body.error.details.fieldErrors)).toBe(false);
  });

  it('accepts a reporter v1 versioned event and returns 202', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VERSIONED_EVENT),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as ErrorBody;
    expect(body['ok']).toBe(true);
    expect(body['runId']).toBe('run-versioned-001');
    expect(body['type']).toBe('run:started');
    expect(body['version']).toBe('1');
  });

  it('accepts a canonical automate.run@2 event and returns 202', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: RUN_CONTRACT_VERSION,
        type: 'run.started',
        runId: 'run-canonical-001',
        timestamp: '2026-05-05T10:00:00.000Z',
        payload: { total: 3 },
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as ErrorBody;
    expect(body['type']).toBe('run.started');
    expect(body['version']).toBe(RUN_CONTRACT_VERSION);
  });

  it('rejects incompatible versioned envelopes with an explicit error', async () => {
    const app = buildApp();
    for (const version of ['3', '999', 'latest', '2.0', '']) {
      const res = await app.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          type: 'run.started',
          runId: 'run-bad-version',
          timestamp: '2026-05-05T10:00:00.000Z',
          payload: {},
        }),
      });
      expect(res.status, `version ${version}`).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.message).toContain('Invalid versioned reporter event');
      expect(body.error.details.supportedVersions).toEqual([
        REPORTER_EVENT_VERSION,
        RUN_CONTRACT_VERSION,
      ]);
      expect(body.error.details.legacyContract).toBe(LEGACY_FLAT_V1_CONTRACT_ID);
    }
  });

  it('rejects unknown versioned event types instead of accepting and dropping them', async () => {
    const app = buildAppWithRepo(new InMemoryRunRepository());
    for (const type of ['suite:nested', 'run.ended', 'check.flaky', 'totally:unknown']) {
      const res = await app.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: RUN_CONTRACT_VERSION,
          type,
          runId: 'run-unknown-type',
          timestamp: '2026-05-05T10:00:00.000Z',
          payload: { depth: 3 },
        }),
      });
      expect(res.status, `type ${type}`).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.message).toContain('Invalid versioned reporter event');
      const details = body.error.details.fieldErrors as Record<string, unknown>;
      expect(details['type']).toBeDefined();
    }
  });

  it('keeps the legacy flat-v1 path accepted after versioned strictness', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'run:start',
        runId: 'run-legacy-still-ok',
        payload: { total: 1 },
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as ErrorBody;
    expect(body['version']).toBe(REPORTER_EVENT_VERSION);
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid versioned reporter event');
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Missing');
  });

  it('returns 403 when secret set but wrong token in Authorization header', async () => {
    const app = buildApp('super-secret');
    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid');
  });

  it('returns 403 when secret set but wrong token in query param (allowQueryToken enabled)', async () => {
    const app = buildApp('super-secret', { allowQueryToken: true });
    const res = await app.request('/api/v1/reporter/events?token=bad-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LEGACY_EVENT),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid');
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
        Authorization: 'Bearer super-secret',
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
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Missing');
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
        Authorization: 'Bearer correct-secret-value',
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
        Authorization: 'Bearer correct-secret-value',
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

/**
 * The minimal producer context the JUnit adapter needs.
 *
 * Declared at module scope rather than inside the one test that uses it, because a
 * `const` inside a test body is invisible to the next one and the next one will
 * declare its own — which is how a file ends up with three producer contexts that
 * differ in exactly the field nobody checked.
 */
const producerContext = {
  workspaceId: 'ws',
  runId: 'r',
  sourceUri: 'x',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1',
  adapterVersion: '1',
  startedAt: '2026-09-25T00:00:00.000Z',
};

describe('Reporter routes — upload ingestion', () => {
  it('persists uploaded run and tests when repository is configured', async () => {
    /** The minimal producer context the adapter needs; the run identity is irrelevant to a status. */
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
    const body = (await res.json()) as ErrorBody;
    expect(body['ok']).toBe(true);
    expect(body['runId']).toBe('upload-run-001');
    expect(body['ingestedTests']).toBe(2);

    const run = await repo.getRun('upload-run-001');
    expect(run).not.toBeNull();
    expect(run?.status).toBe('failed');
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

  it('retains raw upload bytes in the configured artifact store', async () => {
    const repo = new InMemoryRunRepository();
    const writes: Array<{ key: string; bytes: Uint8Array }> = [];
    const app = withErrorBoundary(
      createReporterRoutes(undefined, {
        repository: repo,
        canonicalStore: new ReporterIngestionService(DEFAULT_WORKSPACE_ID),
        artifactStore: {
          putAt: async (key, bytes) => {
            writes.push({ key, bytes });
          },
        },
      }),
    );
    const response = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'raw-upload',
        status: 'passed',
        tests: [{ id: 't-1', title: 'a test', status: 'passed' }],
      }),
    });
    expect(response.status).toBe(202);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toContain('legacy/raw-upload/raw/');
    expect(new TextDecoder().decode(writes[0]?.bytes)).toContain('raw-upload');
  });

  it('returns 503 when upload persistence repository is not configured', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'upload-run-002' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('not configured');
  });

  it('rejects an unsupported producer format instead of accepting unknown data', async () => {
    const app = buildAppWithRepo(new InMemoryRunRepository());
    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'upload-format-001', format: 'cypress', tests: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid upload payload', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);
    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: '',
        tests: [{ title: 'missing id', file: 'a', status: 'passed' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain('Invalid reporter upload payload');
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
        Authorization: 'Bearer upload-secret',
      },
      body: JSON.stringify({
        runId: 'upload-run-003',
        tests: [{ id: 't-1', title: 'a test', status: 'passed' }],
      }),
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
    form.set(
      'file',
      new File([JSON.stringify(report)], 'playwright-report.json', { type: 'application/json' }),
    );

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
    form.set(
      'file',
      new File([JSON.stringify(report)], 'playwright-branches.json', { type: 'application/json' }),
    );

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(202);
    const run = await repo.getRun('upload-playwright-branches-001');
    expect(run?.status).toBe('failed');

    const tests = await repo.listTests('upload-playwright-branches-001');
    expect(tests).toHaveLength(4);
    // Playwright reports `timedOut`; it is stored in the one spelling the
    // database accepts, so the two can no longer be counted separately.
    expect(tests.some((t) => t.status === 'timed_out')).toBe(true);
    expect(tests.some((t) => t.status === 'skipped')).toBe(true);
    expect(tests.some((t) => t.status === 'queued')).toBe(true);
    // **`interrupted` is not a failure.** The suite was stopped — Ctrl-C, a cancelled CI
    // job, a global timeout — so the product produced no outcome at all. The upload door
    // used to record it `failed` and the run's `failed` counter counted the harness's own
    // interruptions as product defects. `cancelled` is the canonical non-product status for
    // exactly this, and `tests` has no `cancelled` member, so it lands as unobserved.
    expect(tests.some((t) => t.status === 'failed')).toBe(false);
    expect(
      tests.find((t) => t.title === 'interrupted test')?.status,
      'an interrupted test is unobserved, not failed',
    ).toBe('queued');
    expect(run?.failed, 'only the timeout is a product failure').toBe(1);
  });

  it('stores a Playwright timeout under one spelling, whatever the reporter sends', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);
    for (const [index, status] of ['timedOut', 'timed_out'].entries()) {
      const form = new FormData();
      form.set('runId', `upload-spelling-${index}`);
      form.set('artifactType', 'playwright-json');
      form.set(
        'file',
        new File(
          [
            JSON.stringify({
              suites: [
                {
                  title: 'suite',
                  file: 'tests/a.spec.ts',
                  specs: [{ title: 'hangs', tests: [{ results: [{ status, duration: 1 }] }] }],
                  suites: [],
                },
              ],
            }),
          ],
          'report.json',
          { type: 'application/json' },
        ),
      );
      const res = await app.request('/api/v1/reporter/upload', { method: 'POST', body: form });
      expect(res.status).toBe(202);
      const tests = await repo.listTests(`upload-spelling-${index}`);
      expect(tests[0]?.status, `input spelling ${status}`).toBe('timed_out');
    }
  });

  it('parses junit skipped and error outcomes, and fails closed on an undeclared one', async () => {
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
    const byTitle = new Map(tests.map((t) => [t.title, t.status]));
    expect(byTitle.get('smoke')).toBe('skipped');
    // The title is the canonical one — the `<testcase name>` — and the `classname` is the
    // canonical `suite`. The upload door concatenated them into `api :: api error`, which
    // put a class name in the field the dashboard groups tests by and made the same test
    // carry two different titles depending on which door it arrived through.
    expect(byTitle.get('api error')).toBe('failed');
    // The third testcase declares no `status` attribute and carries no outcome child —
    // which is how every dialect of the format writes a **pass**. It was expected to
    // be `queued`, on the reasoning that it "proves nothing"; but Surefire, Gradle,
    // Jest, pytest, RSpec and PHPUnit all emit exactly this element for a test that
    // ran and did not fail, and reading it as unobserved made every one of those
    // ecosystems ingest as a run of unobserved tests.
    expect(byTitle.get('ok')).toBe('passed');
    // The property this assertion was protecting survives on the input that warrants
    // it: an **undeclared `status` attribute** still fails closed to `unknown`,
    // rather than defaulting to a pass. Asserted through a parse rather than
    // through `TestStatus`, because the projected column's type has no `unknown`
    // member and widening it would be a lie.
    expect(
      junitXmlAdapter.parse(
        new TextEncoder().encode(
          '<testsuite><testcase name="mystery" status="not-a-status"/></testsuite>',
        ),
        { ...producerContext, startedAt: new Date().toISOString() },
      ).status,
    ).toBe('unknown');
    expect(byTitle.get('ok')).toBe('passed');
  });

  it('rejects a JUnit body past its own size cap instead of parsing it', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);
    // Comfortably past MAX_JUNIT_BYTES (5 MiB) of well-formed testcases.
    const filler = 'a'.repeat(1_000);
    const body = `<testsuite>${`<testcase name="${filler}" time="0.1" />`.repeat(6_000)}</testsuite>`;
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(5 * 1024 * 1024);

    const form = new FormData();
    form.set('runId', 'junit-oversize');
    form.set('artifactType', 'junit');
    form.set('file', new File([body], 'junit.xml', { type: 'application/xml' }));

    const started = Date.now();
    const res = await app.request('/api/v1/reporter/upload', { method: 'POST', body: form });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await repo.getRun('junit-oversize')).toBeNull();
  });

  it('parses a malformed JUnit document as far as it goes, and marks what it could not finish', async () => {
    const repo = new InMemoryRunRepository();
    const harness = reporterHarness(undefined, { repository: repo });
    const app = harness.app;

    const upload = async (runId: string, xml: string): Promise<Response> => {
      const form = new FormData();
      form.set('runId', runId);
      form.set('artifactType', 'junit');
      form.set('file', new File([xml], 'junit.xml', { type: 'application/xml' }));
      return app.request('/api/v1/reporter/upload', { method: 'POST', body: form });
    };

    // An unterminated element still terminates the request, instead of rescanning the tail
    // for every opener. The testcase that was open when the document stopped did run, so
    // it is recorded — and the result is marked `completeness: 'unknown'`, because a
    // document cut short cannot have said what the rest of the run did.
    const unterminated = await upload(
      'junit-unterminated',
      '<testsuite><testcase name="a" time="0.1"><testcase name="b" time="0.2">',
    );
    expect(unterminated.status).toBe(202);
    const unterminatedTests = await repo.listTests('junit-unterminated');
    expect(unterminatedTests).toHaveLength(1);
    expect(unterminatedTests[0]?.title).toBe('b');
    const unterminatedResult = await harness.store.get('junit-unterminated');
    expect(
      unterminatedResult?.completeness.state,
      'a document the parser could not finish is not a complete account of the run',
    ).toBe('unknown');

    // A tag whose name merely starts with `testcase` is not a testcase.
    const lookalike = await upload(
      'junit-lookalike',
      '<testsuite><testcaseextra name="nope" /><testcase name="real" time="0.1" /></testsuite>',
    );
    expect(lookalike.status).toBe(202);
    const lookalikeTests = await repo.listTests('junit-lookalike');
    expect(lookalikeTests).toHaveLength(1);
    expect(lookalikeTests[0]?.title).toBe('real');

    // An encoded `>` inside an attribute value must not truncate the element. A real XML
    // parser *decodes* the entity, so the stored title is the decoded `a > b` — which is
    // what proves the element was one element and the `>` did not split it.
    const quoted = await upload(
      'junit-quoted',
      '<testsuite><testcase name="a &gt; b" classname="pkg.Cls" time="0.1" /></testsuite>',
    );
    expect(quoted.status).toBe(202);
    expect((await repo.listTests('junit-quoted'))[0]?.title).toBe('a > b');

    // Entity-bearing and deeply repeated markup must not expand or recurse.
    const bomb = await upload(
      'junit-entity',
      '<testsuite><testcase name="x" time="0.1"><system-out>&lol;</system-out>' +
        '&lol;'.repeat(50_000) +
        '</testcase></testsuite>',
    );
    expect(bomb.status).toBe(202);
  });

  it('keeps a streaming run open, and counts only what its rows show', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'upload-running-001',
        status: 'running',
        // **The declared summary no longer overrides the rows.** It used to be read as
        // `summary?.failed ?? derived.failed`, so a partial report could declare ten tests
        // and nine passes and have that written over what its single row showed. A summary
        // is a claim about the rows, and the run's counters are a count of the rows.
        summary: { total: 10, passed: 9, failed: 1 },
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
    // `status: 'running'` is honoured, and it is now a state the canonical row can also
    // express — before `running` entered the canonical vocabulary the only way to say it
    // was `runs.status`, so the projection and the authority disagreed about every
    // streaming run.
    expect(run?.status).toBe('running');
    expect(run?.phase).toBe('running');
    expect(run?.outcome).toBeNull();
    expect(run?.finishedAt).toBeNull();
    expect(run?.total).toBe(1);
    expect(run?.passed).toBe(0);
    expect(run?.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Upload status derivation — fail-closed, never a false green
// ---------------------------------------------------------------------------

describe('Reporter upload — status derivation without an explicit status', () => {
  it('refuses a status-less JSON upload that carries no tests', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'derive-empty-json' }),
    });

    // **Refused, not recorded as `interrupted`.** This used to persist a run row with
    // zero tests so the dashboard could show that a job had produced nothing — which is
    // not what a row with no evidence can tell you, and `interrupted` on a run that
    // reported zero attempts is a claim about a run nobody observed. A report with no
    // observable attempt has observed nothing, and inventing an attempt for it would
    // record a test that never ran.
    //
    // The producer sees a non-2xx and its CI fails loudly, which is the difference between
    // this and silently filing it. `CanonicalRunResultSchema` requires at least one attempt
    // for the same reason.
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    // The refusal names the cause. "Invalid reporter upload payload" was the answer to
    // every malformed report this door ever produced, and it is not actionable.
    expect(body.error.details['adapterMessage']).toContain('no test rows');
    expect(await repo.getRun('derive-empty-json')).toBeNull();
  });

  it('derives passed for a status-less JSON upload that has real passing evidence', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'derive-passing-json',
        tests: [
          {
            id: 'd-1',
            title: 'login works',
            file: 'tests/auth/login.spec.ts',
            status: 'passed',
            durationMs: 12,
          },
        ],
      }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as ErrorBody;
    expect(body['status']).toBe('passed');

    const run = await repo.getRun('derive-passing-json');
    expect(run?.status).toBe('passed');
    expect(run?.total).toBe(1);
    expect(run?.passed).toBe(1);
  });

  it('derives failed for a status-less JSON upload that carries a failing test', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'derive-failed-json',
        tests: [
          { id: 'd-1', title: 'a', file: 'a.spec.ts', status: 'passed' },
          { id: 'd-2', title: 'b', file: 'b.spec.ts', status: 'timedOut' },
        ],
      }),
    });

    const run = await repo.getRun('derive-failed-json');
    expect(run?.status).toBe('failed');
  });

  it('keeps a status-less JSON upload non-green when its tests never resolved', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'derive-unresolved-json',
        tests: [{ id: 'd-1', title: 'never ran', file: 'a.spec.ts', status: 'queued' }],
      }),
    });

    const run = await repo.getRun('derive-unresolved-json');
    expect(run?.status).toBe('interrupted');
  });

  it('keeps a status-less JSON upload non-green when nothing actually passed', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'derive-all-skipped-json',
        tests: [{ id: 'd-1', title: 'skipped', file: 'a.spec.ts', status: 'skipped' }],
      }),
    });

    const run = await repo.getRun('derive-all-skipped-json');
    expect(run?.status).toBe('interrupted');
    expect(run?.skipped).toBe(1);
  });

  it('derives failed when the declared summary reports a failure', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'derive-summary-failed',
        summary: { total: 3, passed: 2, failed: 1 },
        tests: [
          { id: 'd-1', title: 'a', file: 'a.spec.ts', status: 'passed' },
          { id: 'd-2', title: 'b', file: 'b.spec.ts', status: 'passed' },
        ],
      }),
    });

    const run = await repo.getRun('derive-summary-failed');
    expect(run?.status).toBe('failed');
  });

  it('honours an explicit status instead of deriving one (legacy compatibility)', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    // A declared `passed` with no evidence is downgraded, not honoured: the claim goes onto
    // the same ladder as the rows and cannot outrank them.
    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'explicit-passed-no-evidence',
        status: 'passed',
        tests: [{ id: 'd-1', title: 'never resolved', file: 'a.spec.ts', status: 'queued' }],
      }),
    });
    expect((await repo.getRun('explicit-passed-no-evidence'))?.status).toBe('interrupted');

    // A declared `interrupted` — the harness stopped the run — lands on `cancelled` in the
    // canonical vocabulary, which the projection reads as "evidence without a verdict". A
    // declared `running` keeps the run open; that state now exists canonically too, which
    // it did not before this change.
    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'explicit-interrupted-with-passing-tests',
        status: 'interrupted',
        tests: [{ id: 'd-1', title: 'a', file: 'a.spec.ts', status: 'passed' }],
      }),
    });
    const interrupted = await repo.getRun('explicit-interrupted-with-passing-tests');
    expect(interrupted?.status).toBe('interrupted');
    expect(interrupted?.outcome).toBe('cancelled');

    await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'explicit-running-with-passing-tests',
        status: 'running',
        tests: [{ id: 'd-1', title: 'a', file: 'a.spec.ts', status: 'passed' }],
      }),
    });
    expect((await repo.getRun('explicit-running-with-passing-tests'))?.status).toBe('running');
  });

  it('refuses a declared run that carries no rows at all', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);
    const res = await app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'explicit-passed-no-tests', status: 'passed', tests: [] }),
    });
    // A run with no observable attempt has observed nothing, and a status declared beside
    // it does not make it observable. This used to persist `interrupted` — a claim about a
    // run nobody watched.
    expect(res.status).toBe(400);
    expect(await repo.getRun('explicit-passed-no-tests')).toBeNull();
  });
});

describe('Reporter upload — Playwright artifact status derivation', () => {
  async function uploadPlaywright(
    app: Hono,
    runId: string,
    report: unknown,
    fields: Record<string, string> = {},
  ): Promise<Response> {
    const form = new FormData();
    form.set('runId', runId);
    form.set('artifactType', 'playwright-json');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set('file', new File([JSON.stringify(report)], 'playwright-report.json'));
    return app.request('/api/v1/reporter/upload', { method: 'POST', body: form });
  }

  it('refuses an empty Playwright report rather than filing it as a run', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await uploadPlaywright(app, 'pw-empty', {
      suites: [null, { title: 'Empty', file: 'tests/empty.spec.ts', specs: [null] }],
    });

    // The document parsed; it had nothing in it. `interrupted` on a run with zero attempts
    // is a claim about a run nobody observed, and `total: 0` beside it makes the row
    // unreadable rather than non-green. The refusal is the honest answer, and the producer
    // sees a non-2xx so its CI fails loudly instead of filing it.
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details['adapterMessage']).toContain('no test attempts');
    expect(await repo.getRun('pw-empty')).toBeNull();
    expect(await repo.listTests('pw-empty')).toHaveLength(0);
  });

  it('keeps a spec with no results unresolved instead of green', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await uploadPlaywright(app, 'pw-no-results', {
      suites: [
        {
          title: 'Auth',
          file: 'tests/auth.spec.ts',
          specs: [
            {
              title: 'never executed',
              tests: [{ results: [] }, { projectName: 'firefox' }, null],
            },
          ],
        },
      ],
    });

    // A spec that declared tests but reported no result for them has one unobserved test
    // each, and a report with one unobserved test is a run with no verdict. `queued` is
    // this table's word for "declared, no outcome", and it is not `passed`.
    expect(res.status).toBe(202);
    const tests = await repo.listTests('pw-no-results');
    expect(tests).toHaveLength(2);
    expect(tests.every((t) => t.status === 'queued')).toBe(true);

    const run = await repo.getRun('pw-no-results');
    expect(run?.status).toBe('interrupted');
  });

  it('collapses a retry into one test row, and records the run as flaky', async () => {
    const harness = reporterHarness(undefined);
    const app = harness.app;

    const res = await uploadPlaywright(app, 'pw-retries', {
      suites: [
        {
          title: 'Flaky',
          file: 'tests/flaky.spec.ts',
          specs: [
            {
              title: 'eventually passes',
              tests: [
                {
                  results: [
                    { status: 'failed', duration: 1200 },
                    { status: 'passed', duration: 300 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as ErrorBody;
    // **One test, one row.** The upload door wrote a `tests` row per *attempt*, so a test
    // that failed once and passed on retry appeared twice in the dashboard and pushed
    // `runs.total` to 2 for a single test. `runStatusFrom` already said a retry history is
    // not a set of independent tests; the projection now agrees with it.
    expect(body['ingestedTests']).toBe(1);
    expect(body['canonicalStatus']).toBe('flaky');

    const tests = await harness.runs.listTests('pw-retries');
    expect(tests).toHaveLength(1);
    // The retry is not erased by collapsing it: the row is `flaky`, because the verdict
    // exists and is not one a release should be read from. Recording `passed` here is the
    // failure this product exists to prevent.
    expect(tests[0]?.status).toBe('flaky');
    // The last attempt's own duration, because the row is the test's final state.
    expect(tests[0]?.durationMs).toBe(300);

    const run = await harness.runs.getRun('pw-retries');
    // A flaky run is not a pass and not a product failure: `phase: 'partial'` is the
    // vocabulary's own name for "evidence without a terminal verdict", which keeps it on
    // `interrupted` in the four-value `runs.status`.
    expect(run?.status).toBe('interrupted');
    expect(run?.phase).toBe('partial');
    expect(run?.total).toBe(1);
    expect(run?.flaky).toBe(1);
    expect(run?.failed).toBe(0);
    expect(run?.passed).toBe(0);

    // **And both attempts are still in the authority**, which is the whole point of
    // collapsing rather than discarding: the projection is one row per test, and the
    // canonical row keeps the retry history the projection summarised.
    const stored = await harness.store.get('pw-retries');
    expect(stored?.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
    expect(stored?.attempts.map((attempt) => attempt.index)).toEqual([1, 2]);
    expect(stored?.attempts.every((attempt) => attempt.flakiness === 'observed')).toBe(true);
  });

  it('preserves every test entry of a multi-project Playwright spec', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await uploadPlaywright(app, 'pw-projects', {
      suites: [
        {
          title: 'Checkout',
          file: 'tests/checkout.spec.ts',
          specs: [
            {
              title: 'pays',
              tests: [
                { title: 'pays on chromium', results: [{ status: 'passed', duration: 10 }] },
                { title: 'pays on firefox', results: [{ status: 'passed', duration: 20 }] },
              ],
            },
          ],
        },
      ],
    });

    const tests = await repo.listTests('pw-projects');
    expect(tests).toHaveLength(2);
    expect(new Set(tests.map((t) => t.id)).size).toBe(2);
    // The title is the canonical one — the test's own title. The upload door prefixed it
    // with the suite path (`Checkout > pays on chromium`), which put a hierarchy in a field
    // the dashboard groups by `file` and made the same test carry two titles depending on
    // which door it arrived through. The suite is a separate canonical field.
    expect(tests.some((t) => t.title === 'pays on chromium')).toBe(true);
    expect(tests.some((t) => t.title === 'pays on firefox')).toBe(true);

    const run = await repo.getRun('pw-projects');
    expect(run?.status).toBe('passed');
    expect(run?.total).toBe(2);
  });

  it('derives passed for a non-empty Playwright report with no failures', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await uploadPlaywright(app, 'pw-clean', {
      suites: [
        {
          title: 'Auth',
          file: 'tests/auth.spec.ts',
          specs: [
            { title: 'a', tests: [{ results: [{ status: 'passed' }] }] },
            { title: 'b', tests: [{ results: [{ status: 'skipped' }] }] },
          ],
        },
      ],
    });

    const run = await repo.getRun('pw-clean');
    expect(run?.status).toBe('passed');
    expect(run?.passed).toBe(1);
    expect(run?.skipped).toBe(1);
  });

  it('honours an explicit multipart status over the derived Playwright status', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await uploadPlaywright(
      app,
      'pw-explicit-status',
      {
        suites: [
          {
            title: 'Auth',
            file: 'tests/auth.spec.ts',
            specs: [{ title: 'a', tests: [{ results: [{ status: 'failed' }] }] }],
          },
        ],
      },
      { status: 'running' },
    );

    const run = await repo.getRun('pw-explicit-status');
    expect(run?.status).toBe('running');
    expect(run?.finishedAt).toBeNull();
  });
});

describe('Reporter upload — JUnit artifact status derivation', () => {
  async function uploadJunit(
    app: Hono,
    runId: string,
    xml: string,
    fields: Record<string, string> = {},
  ): Promise<Response> {
    const form = new FormData();
    form.set('runId', runId);
    form.set('artifactType', 'junit');
    form.set('file', new File([xml], 'junit.xml', { type: 'application/xml' }));
    if (fields['status'] !== undefined) form.set('status', fields['status']);
    if (fields['summary'] !== undefined) form.set('summary', fields['summary']);
    return app.request('/api/v1/reporter/upload', { method: 'POST', body: form });
  }

  it('refuses an empty JUnit report rather than filing it as a run', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await uploadJunit(
      app,
      'junit-empty',
      '<testsuites tests="0" failures="0"></testsuites>',
    );

    // Zero `<testcase>` elements is not a run that failed or was interrupted; it is a
    // report with nothing in it, and the two answers have different remedies. This used to
    // persist `interrupted` with `total: 0` — a row whose only content was the absence of
    // anything — and refused is what `CanonicalRunResultSchema`'s `min(1)` on `attempts`
    // already meant.
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details['adapterMessage']).toContain('no test cases');
    expect(await repo.getRun('junit-empty')).toBeNull();
    expect(await repo.listTests('junit-empty')).toHaveLength(0);
  });

  it('keeps a JUnit report whose testcases declare no outcome non-green', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    const res = await uploadJunit(
      app,
      'junit-clean',
      '<testsuite name="s" tests="1">' +
        '<testcase name="ok" file="a.spec.ts" time="0.1" /></testsuite>',
    );

    // **This expectation was `interrupted`, and that was wrong.** The comment above
    // it said "a bare `<testcase>` used to be recorded as a pass, so the whole report
    // went green on nothing but the reporter's own optimism" — and the fix over-
    // corrected. A complete, attribute-less `<testcase>` is how every dialect of the
    // format writes a **pass**: Surefire, Gradle, Jest, pytest, RSpec and PHPUnit all
    // do. Reading it as `unknown` made every Maven, Gradle, Jest, pytest and RSpec run
    // ingest as a run of unobserved tests, so the QA score read those repositories as
    // having no tests at all.
    //
    // The property that comment was protecting is preserved on the input that
    // actually warrants it: a document cut short mid-element cannot report a pass, and
    // `packages/reporter/src/junit.test.ts` asserts exactly that, at both the
    // adapter and the route.
    expect(res.status).toBe(202);
    const run = await repo.getRun('junit-clean');
    expect(run?.status).toBe('passed');
    expect(run?.passed).toBe(1);
  });

  it('keeps an all-skipped JUnit report non-green', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildAppWithRepo(repo);

    await uploadJunit(
      app,
      'junit-skipped',
      '<testsuite name="s" tests="1"><testcase name="skipped"><skipped /></testcase></testsuite>',
    );

    const run = await repo.getRun('junit-skipped');
    expect(run?.status).toBe('interrupted');
    expect(run?.skipped).toBe(1);
  });
});

describe('Reporter upload — derived status is broadcast', () => {
  it('publishes the projected status for a run that lands', async () => {
    const harness = reporterHarness(undefined);

    await harness.app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'derive-broadcast-001',
        tests: [{ id: 'd-1', title: 'never resolved', file: 'a.spec.ts', status: 'queued' }],
      }),
    });

    // One event, carrying the *projected* status — the same four-value narrowing the
    // dashboard reads, not the canonical one. Broadcasting the canonical status here would
    // tell every subscriber a state `RunEventEnvelope` does not have.
    expect(harness.bus.published).toHaveLength(1);
    expect(harness.bus.published[0]?.runId).toBe('derive-broadcast-001');
    expect(harness.bus.published[0]?.status).toBe('interrupted');
  });

  it('broadcasts nothing for a run it refuses', async () => {
    const harness = reporterHarness(undefined);
    const res = await harness.app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'derive-broadcast-002' }),
    });
    expect(res.status).toBe(400);
    // A subscriber that saw an event for this run would render a run that does not exist.
    expect(harness.bus.published).toHaveLength(0);
  });
});

describe('Playwright ingestion is bounded on an untrusted boundary', () => {
  // Ledger P-60. `collectSuite` recursed into `suite['suites']` with no depth cap and
  // no cycle detection, on a body that is attacker-controlled by construction. Three
  // distinct unbounded shapes, and each is asserted separately because a fix for one
  // is not a fix for the others.
  const reportWith = (build: (root: Record<string, unknown>) => void) => {
    const root: Record<string, unknown> = {
      title: 'root',
      file: 'f.spec.ts',
      specs: [],
      suites: [],
    };
    build(root);
    // A `suites` array at the top level is what routes this body to the Playwright
    // converter at all — without it the upload is treated as a raw payload and the
    // recursion never runs, so the test would pass over the defect.
    return { suites: [root] };
  };

  const upload = async (report: unknown) => {
    // A repository is required: the upload route answers `NOT_CONFIGURED` without
    // one, and a 503 would be a pass-or-fail on the wrong thing.
    //
    // **Multipart, not `application/json`.** The Playwright converter is only reached
    // from the multipart branch (`reporter.ts:351`); a plain JSON body goes straight
    // to `ReporterUploadSchema` at `:371` and never touches `collectSuite` at all. A
    // test that posts JSON would therefore pass over the defect entirely — which is
    // what the first draft of this test did, and it "failed" for the wrong reason.
    const app = buildAppWithRepo(new InMemoryRunRepository());
    const form = new FormData();
    form.set('runId', 'run-1');
    form.set(
      'file',
      new File([JSON.stringify(report)], 'report.json', { type: 'application/json' }),
    );
    return app.request('/api/v1/reporter/upload', { method: 'POST', body: form });
  };

  it('refuses a report nested past the depth cap instead of overflowing the stack', async () => {
    // Ledger P-60. The recursion into `suite['suites']` had no depth cap, and deep
    // nesting converts to a `RangeError: Maximum call stack size exceeded` — not a
    // catchable refusal, so the request is taken down rather than answered.
    //
    // `MAX_UPLOAD_BYTES` does not help: it bounds how *large* a body is, not how
    // *deeply* it nests, and a small body of nothing but nested `suites` is well
    // within the size limit.
    //
    // The depth is 200, not 5 000, because 5 000 overflows the *test's* own
    // `JSON.stringify` before the request is ever sent — which is a limit on the
    // fixture, not on the defect. 200 is comfortably past the 32-level cap and
    // serialises fine.
    const response = await upload(
      reportWith((root) => {
        let cursor = root;
        for (let depth = 0; depth < 200; depth += 1) {
          const child: Record<string, unknown> = {
            title: `n${String(depth)}`,
            specs: [],
            suites: [],
          };
          (cursor['suites'] as unknown[]).push(child);
          cursor = child;
        }
      }),
    );

    expect(response.status, 'a pathologically nested report must be refused').toBe(400);
  });

  it('still accepts a legitimately nested report', async () => {
    // The counterweight. A cap that rejected ordinary nesting would make the
    // ingestion path useless for the reports it exists to accept, and it would pass
    // the case above. Playwright nests one level per directory a spec lives in, so a
    // monorepo with deep test trees is the realistic case, not an edge one.
    const response = await upload(
      reportWith((root) => {
        let cursor = root;
        for (let depth = 0; depth < 8; depth += 1) {
          const child: Record<string, unknown> = {
            title: `n${String(depth)}`,
            specs: [],
            suites: [],
          };
          (cursor['suites'] as unknown[]).push(child);
          cursor = child;
        }
        (cursor['specs'] as unknown[]).push({
          title: 'works',
          tests: [{ title: 'a test', results: [{ status: 'passed', duration: 5 }] }],
        });
      }),
    );

    expect(response.status).toBe(202);
  });
});
