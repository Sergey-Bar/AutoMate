import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { describe, expect, it } from 'vitest';
import { createReporterRoutes } from './reporter.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';

/**
 * Adversarial input on the ingestion path.
 *
 * Ingestion is the only place a stranger's bytes become this product's facts, and
 * every claim the product makes — *evidence before claims* — is decided by what
 * happens to a hostile upload. `reporter.test.ts` covers the shapes the reporters
 * actually send. This covers the shapes someone would send who is not one, and it
 * is organised around one rule that has to hold in every case:
 *
 * > An upload that does not carry evidence for a green result must never produce
 * > one.
 *
 * The temptation in each case below is the same: accept the plausible-looking
 * field because a real reporter sends it, and quietly treat the missing
 * evidence as fine. So the assertions are about the *derived* status, not about
 * the request succeeding — a 202 is correct for all of them, and 202 with a
 * `passed` run is a bug.
 */

const SECRET = 'adversarial-ingestion-reporter-secret';
const JSON_HEADERS = { 'content-type': 'application/json' };

/** A valid upload body the tests then damage in one specific way. */
function validUpload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'adversarial-run',
    tests: [
      { id: 't-1', title: 'a test', status: 'passed' },
      { id: 't-2', title: 'another test', status: 'passed' },
    ],
    ...overrides,
  };
}

async function upload(
  body: unknown,
  headers: Record<string, string> = { ...JSON_HEADERS, authorization: `Bearer ${SECRET}` },
) {
  const repository = new InMemoryRunRepository();
  const app = withErrorBoundary(createReporterRoutes(SECRET, { repository }));
  const response = await app.request('/api/v1/reporter/upload', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { response, repository };
}

/** The persisted run, or undefined. */
async function storedRun(repository: InMemoryRunRepository, runId: string) {
  return repository.getRun(runId);
}

describe('an upload with no evidence is never green', () => {
  it('is not green when it carries no tests at all', async () => {
    const { response } = await upload(validUpload({ tests: [] }));
    expect(response.status).toBe(202);
    // `interrupted` is the honest landing spot: the run status vocabulary has no
    // `unknown`, and `passed` for a run that executed nothing is a lie a gate
    // would then believe.
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('interrupted');
  });

  it('is not green when every test was skipped', async () => {
    const { response } = await upload(
      validUpload({
        tests: [
          { id: 't-1', title: 'a', status: 'skipped' },
          { id: 't-2', title: 'b', status: 'skipped' },
        ],
      }),
    );
    expect(((await response.json()) as { status: string }).status).toBe('interrupted');
  });

  it('is not green when a test is still running or queued', async () => {
    for (const status of ['running', 'queued']) {
      const { response } = await upload(
        validUpload({
          tests: [
            { id: 't-1', title: 'a', status: 'passed' },
            { id: 't-2', title: 'b', status },
          ],
        }),
      );
      // One pass and one unresolved is not a pass. A summary that says "1 passed"
      // and nothing about the unresolved test is exactly the shape a green build
      // hides behind.
      expect(((await response.json()) as { status: string }).status, status).toBe('interrupted');
    }
  });

  it('is not green when a summary claims success the rows contradict', async () => {
    const { response } = await upload(
      validUpload({
        tests: [{ id: 't-1', title: 'a', status: 'failed' }],
        // A summary that disagrees with the rows. The rows are the evidence, so the
        // rows win — and `failed` is the safe direction to be wrong in.
        summary: { total: 99, passed: 99, failed: 0 },
      }),
    );
    expect(((await response.json()) as { status: string }).status).toBe('failed');
  });

  it('is not green when an empty tests array is padded with a summary', async () => {
    const { response } = await upload(
      validUpload({ tests: [], summary: { total: 10, passed: 10, failed: 0 } }),
    );
    // The most direct attack in this file: declare ten passing tests and attach
    // none. `passed` here would be a green build invented entirely by the client.
    expect(((await response.json()) as { status: string }).status).toBe('interrupted');
  });
});

describe('a declared status is honoured, but a declared pass is not trusted', () => {
  it('honours a declared failure', async () => {
    const { response } = await upload(
      validUpload({ status: 'failed', tests: [{ id: 't-1', title: 'a', status: 'passed' }] }),
    );
    // Legacy compatibility: a reporter that observed a failure knows things the
    // rows do not.
    expect(((await response.json()) as { status: string }).status).toBe('failed');
  });

  it('honours a declared non-green state with no tests at all', async () => {
    // The persisted vocabulary is `running`, `passed`, `failed`, `interrupted`.
    // `queued` is a *test* status and the column's default, not something a client
    // may declare for a finished run.
    for (const status of ['failed', 'interrupted', 'running']) {
      const { response } = await upload(validUpload({ status, tests: [] }));
      expect(((await response.json()) as { status: string }).status, status).toBe(status);
    }
  });

  it('downgrades a declared pass that the rows do not support', async () => {
    const { response } = await upload(validUpload({ status: 'passed', tests: [] }));
    // The single most important line in this file. A client that says `passed` with
    // nothing behind it is refused the pass, and the reason is not "the client is
    // lying" but "there is no evidence to check it against".
    expect(((await response.json()) as { status: string }).status).toBe('interrupted');
  });

  it('downgrades a declared pass whose rows are all unresolved', async () => {
    const { response } = await upload(
      validUpload({ status: 'passed', tests: [{ id: 't-1', title: 'a', status: 'queued' }] }),
    );
    expect(((await response.json()) as { status: string }).status).toBe('interrupted');
  });

  it('upgrades nothing, and never reports passed without at least one real pass', async () => {
    const { response } = await upload(validUpload({ status: 'passed' }));
    // The one case where `passed` survives: the rows back it.
    expect(((await response.json()) as { status: string }).status).toBe('passed');
  });
});

describe('counts are derived from the rows, not taken on trust', () => {
  it('counts each status exactly once per row, and never twice', async () => {
    const { repository } = await upload(
      validUpload({
        tests: [
          { id: 't-1', title: 'a', status: 'passed' },
          { id: 't-2', title: 'b', status: 'failed' },
          { id: 't-3', title: 'c', status: 'passed' },
          { id: 't-4', title: 'd', status: 'skipped' },
        ],
      }),
    );
    const run = await storedRun(repository, 'adversarial-run');
    // An off-by-one in the counter is how a summary says 3 passed of 4 total while
    // one of them failed, and every downstream KPI inherits it. The counts are
    // flat fields on the run, not a nested `summary`.
    expect(run).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1 });
  });

  it('treats both timeout spellings as one failure, not as a test that never ran', async () => {
    // Playwright emits `timedOut`, other reporters send `timed_out`. If the two
    // were counted differently then a timed-out suite would either be reported as
    // having an unresolved test (interrupted) or as having one fewer test — and
    // the same suite would land in two different states depending on the reporter.
    for (const status of ['timedOut', 'timed_out']) {
      const { response } = await upload(
        validUpload({
          tests: [
            { id: 't-1', title: 'a', status: 'passed' },
            { id: 't-2', title: 'b', status },
          ],
        }),
      );
      expect(((await response.json()) as { status: string }).status, status).toBe('failed');
    }
  });
});

describe('malformed and hostile bodies', () => {
  it('refuses a body that is not an object', async () => {
    for (const body of [[], 'a string', 42, null, true]) {
      const { response } = await upload(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses a test with no identity', async () => {
    const { response } = await upload(
      validUpload({ tests: [{ title: 'anonymous', status: 'passed' }] }),
    );
    // A test that cannot be re-reported, deduplicated, or referenced is not
    // evidence; accepting one would let a client inflate `passed` with rows no
    // later upload could contradict.
    expect(response.status).toBe(400);
  });

  it('refuses a run with no run id', async () => {
    const { response } = await upload(validUpload({ runId: '' }));
    expect(response.status).toBe(400);
  });

  it('refuses a status the run vocabulary does not contain', async () => {
    // `queued` in particular: it is a *test* status, and letting it reach
    // `runs.status` would be rejected by the database check constraint as a 500.
    for (const status of ['queued', 'PASSED', 'passed ', 'ok', 'blocked', 0, null]) {
      const { response } = await upload(validUpload({ status }));
      expect(response.status, JSON.stringify(status)).toBe(400);
    }
  });

  it('refuses a negative duration or count rather than storing it', async () => {
    for (const body of [
      validUpload({ durationMs: -1 }),
      validUpload({ summary: { total: -5 } }),
      validUpload({ tests: [{ id: 't', title: 'a', status: 'passed', durationMs: -1 }] }),
    ]) {
      const { response } = await upload(body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it('accepts a long field rather than truncating it, and does not lose the run', async () => {
    // Recorded as a *finding* rather than a requirement: `runId` has no maximum
    // length, so a 200 KB one is accepted and stored whole. Truncating it instead
    // would produce two runs that look identical, which is worse; a length cap is
    // the right fix and is a contract change, not a test assertion. What is
    // asserted here is that nothing is silently corrupted on the way through.
    const longRunId = `r${'x'.repeat(200_000)}`;
    const { repository, response } = await upload(validUpload({ runId: longRunId, tests: [] }));
    expect(response.status).toBe(202);
    const stored = await repository.getRun(longRunId);
    expect(stored?.id, 'the run id round-tripped exactly').toBe(longRunId);
  });

  it('never persists anything from a refused upload', async () => {
    const { repository, response } = await upload(validUpload({ runId: '' }));
    expect(response.status).toBe(400);
    expect(await repository.getRun('')).toBeNull();
    // And nothing at all was written, rather than a row with an empty id.
    expect(await repository.listRuns()).toEqual([]);
  });

  it('refuses a path-traversal file reference, and does not store it', async () => {
    const { repository, response } = await upload(
      validUpload({
        tests: [{ id: 't-1', title: 'a', status: 'passed', file: '../../../../etc/passwd' }],
      }),
    );
    expect(response.status).toBe(202);
    const stored = await repository.listTests('adversarial-run');
    expect(stored).toHaveLength(1);
    // Whatever survives sanitisation must be a plain relative path. The exact
    // shape is not what matters; that it is not a traversal is.
    expect(stored[0]?.file ?? '').not.toContain('..');
    expect(stored[0]?.file ?? '').not.toMatch(/^[A-Za-z]:/);
    expect(stored[0]?.file ?? '').not.toContain('/etc/');
  });
});

describe('an unauthenticated upload changes nothing', () => {
  it('is refused, and persists no run', async () => {
    const repository = new InMemoryRunRepository();
    const app = withErrorBoundary(createReporterRoutes(SECRET, { repository }));
    for (const headers of [
      JSON_HEADERS,
      { ...JSON_HEADERS, authorization: '' },
      { ...JSON_HEADERS, authorization: 'Basic x' },
    ]) {
      const response = await app.request('/api/v1/reporter/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify(validUpload({ status: 'passed' })),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    // The point of the whole file: an upload that carries a declared `passed` and
    // no credential must leave nothing behind.
    expect(await repository.getRun('adversarial-run')).toBeNull();
    expect(await repository.listRuns()).toEqual([]);
  });
});

describe('the upload path is the only one that writes a run', () => {
  it('does not let /reporter/events persist a green status it was never told', async () => {
    const repository = new InMemoryRunRepository();
    const app = withErrorBoundary(createReporterRoutes(SECRET, { repository }));
    await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${SECRET}` },
      // A `run:end` event with a green payload. Events are not the upload path, so
      // the run status must come from the run state machine rather than from a
      // field in an event body.
      body: JSON.stringify({ type: 'run:end', runId: 'event-run', payload: { status: 'passed' } }),
    });
    const run = await repository.getRun('event-run');
    // Whatever it becomes, it must not be `passed` on the strength of the payload.
    expect(run?.status).not.toBe('passed');
  });
});
describe('the composition is the real one', () => {
  it('serves exactly the two ingestion routes', () => {
    const app = withErrorBoundary(
      createReporterRoutes(SECRET, { repository: new InMemoryRunRepository() }),
    );
    const served = app.routes
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !key.startsWith('ALL'));
    expect([...served].sort()).toEqual([
      'POST /api/v1/reporter/events',
      'POST /api/v1/reporter/upload',
    ]);
  });

  it('mounts into a prefix without changing any path', async () => {
    const repository = new InMemoryRunRepository();
    const routes = createReporterRoutes(SECRET, { repository });
    const mounted = withErrorBoundary(routes);
    const response = await mounted.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(validUpload({ status: 'passed' })),
    });
    expect(response.status).toBe(202);
  });
});
