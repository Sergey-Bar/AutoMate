/**
 * runs.test.ts — `GET /api/v1/dashboard/runs/:id` and
 * `PATCH /api/v1/dashboard/runs/:id/status`.
 *
 * Per-module, mounting `createDashboardRunsRoutes` over a real `RunRepository`
 * rather than building the whole dashboard app, so a failure names the module
 * that failed instead of "the dashboard".
 *
 * The status-patch route is the one with a write on it, so it is held to the
 * fuller list: every status the contract persists, the one it accepts but the
 * column refuses, a body that is absent, and a body that is not JSON.
 */
import { describe, expect, it } from 'vitest';
/**
 * The boundary's body, named.
 *
 * A cast to `Record<string, unknown>` can read any shape and so checks none, which is
 * how `body.error` stayed a bare string in this suite after the migration: the
 * assertion was satisfied by a field that no longer exists.
 */
interface BoundaryBody {
  /** The success shapes these same files read: `id`, `status`, `allowed`, `runs`. */
  [key: string]: unknown;
  error: {
    code: string;
    message: string;
    requestId: string;
    details: {
      issues: Array<{ path: unknown[]; message?: string }>;
      fieldErrors?: Record<string, unknown>;
      /** The statuses a client may ask for, rather than a sentence naming them. */
      allowed?: string[];
      /** How long to wait, rather than a sentence saying to try again. */
      retryAfterSeconds?: number;
      from?: string;
      to?: string;
    };
  };
}

import { withErrorBoundary } from '../../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import { PERSISTED_RUN_STATUS_VALUES, RUN_STATUS_VALUES } from '@automate/shared-contracts';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import { DEFAULT_WORKSPACE_ID, RunRecord, TestRecord } from '../../repositories/run-repository.js';
import { createDashboardRunsRoutes } from './runs.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OTHER_WORKSPACE = 'workspace-other-install';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    // Required on `RunRecord` since the E2E run found the reporter writing neither a
    // workspace nor a phase: the row was persisted and the dashboard listed nothing.
    workspaceId: DEFAULT_WORKSPACE_ID,
    phase: 'running',
    outcome: null,
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: '2026-09-20T10:05:00.000Z',
    status: 'passed',
    total: 12,
    passed: 12,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: 300_000,
    branch: 'main',
    commitSha: 'abc1234',
    triggeredBy: 'ci',
    ...overrides,
  };
}

/**
 * A `RunRepository` that enforces a workspace boundary.
 *
 * `RunRepository` has no workspace on it — neither the interface nor the
 * `DrizzleRunRepository` that production mounts carries one — so the tenancy
 * decision is entirely the store's. This store makes that decision, which is
 * what lets the route be asked the question the route is actually responsible
 * for: *given* that a record is not this installation's, does the HTTP answer say
 * so? `runs.test.ts` records the gap separately, at the end.
 */
class WorkspaceScopedRunRepository extends InMemoryRunRepository {
  private readonly _foreign = new Set<string>();

  /** Marks a run as belonging to another `WORKSPACE_ID`. */
  markForeign(runId: string): void {
    this._foreign.add(runId);
  }

  override async getRun(id: string): Promise<RunRecord | null> {
    return this._foreign.has(id) ? null : super.getRun(id);
  }

  override async listRuns(): Promise<RunRecord[]> {
    return (await super.listRuns()).filter((run) => !this._foreign.has(run.id));
  }

  override async listTests(runId: string): Promise<TestRecord[]> {
    return this._foreign.has(runId) ? [] : super.listTests(runId);
  }
}

function mount(repository: InMemoryRunRepository): Hono {
  return withErrorBoundary(createDashboardRunsRoutes({ repository }));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as BoundaryBody;
}

function patchStatus(app: Hono, id: string, body: unknown): Promise<Response> {
  // `app.request` is typed `Response | Promise<Response>`; the `async` wrapper is
  // what narrows it, and it costs nothing.
  return (async () =>
    app.request(`/api/v1/dashboard/runs/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }))();
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/runs/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/runs/:id', () => {
  it('returns the run with every field the dashboard renders', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun());
    const app = mount(repository);

    const response = await app.request(
      '/api/v1/dashboard/runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );

    expect(response.status).toBe(200);
    // The whole record, not a projection: the detail page reads the branch, the
    // commit and the duration off this one response.
    expect(await readJson(response)).toEqual(
      expect.objectContaining({
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        startedAt: '2026-09-20T10:00:00.000Z',
        finishedAt: '2026-09-20T10:05:00.000Z',
        status: 'passed',
        total: 12,
        passed: 12,
        failed: 0,
        flaky: 0,
        skipped: 0,
        durationMs: 300_000,
        branch: 'main',
        commitSha: 'abc1234',
        triggeredBy: 'ci',
      }),
    );
  });

  it('carries the null-valued columns through as null rather than omitting them', async () => {
    // A run mid-flight has no finish time and no duration. The client types those
    // as `number | null`; a field that vanished would be `undefined`, which is a
    // different value with a different meaning in the UI ("not finished" vs
    // "the API did not say").
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(
      makeRun({
        status: 'running',
        finishedAt: null,
        durationMs: null,
        branch: null,
        commitSha: null,
      }),
    );
    const app = mount(repository);

    const body = await readJson(
      await app.request('/api/v1/dashboard/runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
    );

    expect(body['finishedAt']).toBeNull();
    expect(body['durationMs']).toBeNull();
    expect(body['branch']).toBeNull();
    expect(body['commitSha']).toBeNull();
  });

  it('answers 404 for an id that was never stored', async () => {
    const repository = new InMemoryRunRepository();
    const app = mount(repository);

    const response = await app.request('/api/v1/dashboard/runs/does-not-exist');

    expect(response.status).toBe(404);
    expect(await readJson(response)).toMatchObject({
      error: { code: 'RUN_NOT_FOUND', message: 'Run not found' },
    });
  });

  it('answers 404, and never 200, for an id that could not exist', async () => {
    // `runs.id` is a `uuid` column. A client that sends something else is asking
    // about nothing, and the answer is the same as for a row that was deleted —
    // never a body and never a stack trace.
    const repository = new InMemoryRunRepository();
    const app = mount(repository);

    for (const id of ['%20', 'not-a-uuid', '../../etc/passwd', 'a'.repeat(600)]) {
      const response = await app.request(`/api/v1/dashboard/runs/${id}`);
      expect(response.status, `id ${id.slice(0, 24)}`).toBe(404);
    }
  });

  it('hides a run that belongs to another WORKSPACE_ID behind the same 404', async () => {
    // `WORKSPACE_ID` is the only tenancy boundary in this product, and "not mine"
    // has to be indistinguishable from "not there". A 403 would confirm the id
    // exists, which is the same disclosure the 404 exists to prevent.
    const repository = new WorkspaceScopedRunRepository();
    await repository.upsertRun(makeRun({ id: 'mine', status: 'passed' }));
    await repository.upsertRun(makeRun({ id: 'theirs', status: 'failed' }));
    repository.markForeign('theirs');
    const app = mount(repository);

    const own = await app.request('/api/v1/dashboard/runs/mine');
    const foreign = await app.request('/api/v1/dashboard/runs/theirs');

    expect(own.status).toBe(200);
    expect(foreign.status).toBe(404);
    expect(foreign.status).not.toBe(403);
    // Not the record under any spelling: no id, no status, nothing.
    expect(await readJson(foreign)).toMatchObject({
      error: { code: 'RUN_NOT_FOUND', message: 'Run not found' },
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/dashboard/runs/:id/status
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/dashboard/runs/:id/status', () => {
  it('accepts every status the runs.status column stores', async () => {
    // Driven from the contract rather than a restated list: the whole point of
    // deriving the accepted set is that a restatement could disagree with it.
    for (const status of PERSISTED_RUN_STATUS_VALUES) {
      const repository = new InMemoryRunRepository();
      await repository.upsertRun(makeRun({ id: 'run-to-patch', status: 'running' }));
      const app = mount(repository);

      const response = await patchStatus(app, 'run-to-patch', { status });

      expect(response.status, `status ${status}`).toBe(200);
      expect((await readJson(response))['status']).toBe(status);
      // The write reached the store, not just the response body.
      expect((await repository.getRun('run-to-patch'))?.status).toBe(status);
    }
  });

  it('refuses a status the contract accepts and the column does not store', async () => {
    // `queued` is in `RUN_STATUS_VALUES` and absent from `PERSISTED_RUN_STATUS_VALUES`.
    // The route once accepted the wider list and let `runs_status_check` refuse the
    // write, which arrived at the caller as a 500.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-queued', status: 'running' }));
    const app = mount(repository);

    const response = await patchStatus(app, 'run-queued', { status: 'queued' });

    expect(response.status).toBe(400);
    // Refused, not applied: the stored status is untouched.
    expect((await repository.getRun('run-queued'))?.status).toBe('running');
  });

  it('refuses a status outside the contract vocabulary entirely', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-bogus', status: 'running' }));
    const app = mount(repository);

    for (const status of ['banana', 'PASSED', 'passed ', '', 7, null, ['passed']]) {
      const response = await patchStatus(app, 'run-bogus', { status });
      expect(response.status, `status ${JSON.stringify(status)}`).toBe(400);
    }
    expect((await repository.getRun('run-bogus'))?.status).toBe('running');
  });

  it('answers 400 for a body with no status, rather than writing undefined', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-no-status', status: 'running' }));
    const app = mount(repository);

    for (const body of [{}, { state: 'passed' }, { status: undefined }]) {
      const response = await patchStatus(app, 'run-no-status', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await repository.getRun('run-no-status'))?.status).toBe('running');
  });

  it('answers 400, not 500, for a body that is absent or is not JSON', async () => {
    // `c.req.json()` throws on both. Uncaught, the throw escaped the handler and
    // the error boundary rendered it as a 500 — indistinguishable from a genuine
    // fault, with the validation never having run.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-bad-body', status: 'running' }));
    const app = mount(repository);

    const absent = await app.request('/api/v1/dashboard/runs/run-bad-body/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    const notJson = await patchStatus(app, 'run-bad-body', 'not json at all');
    const notAnObject = await patchStatus(app, 'run-bad-body', 'null');

    expect(absent.status).toBe(400);
    expect(notJson.status).toBe(400);
    expect(notAnObject.status).toBe(400);
    expect((await repository.getRun('run-bad-body'))?.status).toBe('running');
  });

  it('rejects an unexpected field rather than ignoring it', async () => {
    // `.strict()`: a caller cannot smuggle a field this route does not read, which
    // is the same class of defect that put a gate's name into `workspace_id`.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-extra', status: 'running' }));
    const app = mount(repository);

    const response = await patchStatus(app, 'run-extra', {
      status: 'passed',
      workspaceId: OTHER_WORKSPACE,
    });

    expect(response.status).toBe(400);
    expect((await repository.getRun('run-extra'))?.status).toBe('running');
  });

  it('names the field that was wrong, rather than only that something was', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-issues', status: 'running' }));
    const app = mount(repository);

    const body = (await readJson(
      await patchStatus(app, 'run-issues', { status: 'banana' }),
    )) as BoundaryBody;

    expect(body.error.code).toBe('INVALID_RUN_STATUS');
    expect(body.error.details.allowed).toContain('passed');
    expect(body.error.details.issues.map((issue) => String(issue.path[0]))).toContain('status');
  });

  it('answers 404 for a run that does not exist, and does not write', async () => {
    const repository = new InMemoryRunRepository();
    const app = mount(repository);

    const response = await patchStatus(app, 'never-existed', { status: 'passed' });

    expect(response.status).toBe(404);
    expect(await repository.listRuns()).toEqual([]);
  });

  it('will not patch a run belonging to another WORKSPACE_ID, and says nothing about it', async () => {
    const repository = new WorkspaceScopedRunRepository();
    await repository.upsertRun(makeRun({ id: 'theirs', status: 'failed' }));
    repository.markForeign('theirs');
    const app = mount(repository);

    const response = await patchStatus(app, 'theirs', { status: 'passed' });

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(await readJson(response)).toMatchObject({
      error: { code: 'RUN_NOT_FOUND', message: 'Run not found' },
    });
    // Read past the scoping filter to see the row the caller was refused: a 404
    // that had applied the write would be the worst of both answers. `getRun`
    // would hide it, so the fixture's unfiltered accessor is used deliberately.
    expect(repository.getAllRuns().map((run) => [run.id, run.status])).toEqual([
      ['theirs', 'failed'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The transition rule
// ---------------------------------------------------------------------------

describe('a terminal run does not come back to life', () => {
  it('refuses to reopen a terminal run', async () => {
    // This case used to assert `200` here, under the heading "recorded gap: the status
    // patch has no transition rule", with a long comment explaining that a failed run
    // could be marked `passed` by one dashboard call with no audit row. That was
    // honest — a gap written down beats a gap assumed — and it is now false. X-2 added
    // the transition guard and the audit row; the behaviour is covered in detail in
    // `runs-status.test.ts`.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'terminal', status: 'passed' }));
    const app = mount(repository);

    const response = await patchStatus(app, 'terminal', { status: 'running' });

    expect(response.status).toBe(409);
    expect((await repository.getRun('terminal'))?.status).toBe('passed');
  });

  it('refuses every transition out of a terminal status, and no other pair', async () => {
    // Enumerated rather than sampled, because the shape of the old claim was that it was
    // total and a sampled version would not have said so. What it asserts now is the
    // complement: a move is permitted only when the run is not already terminal.
    const refused: string[] = [];
    const accepted: string[] = [];
    for (const from of PERSISTED_RUN_STATUS_VALUES) {
      for (const to of PERSISTED_RUN_STATUS_VALUES) {
        const repository = new InMemoryRunRepository();
        await repository.upsertRun(makeRun({ id: 'from', status: from }));
        const response = await patchStatus(mount(repository), 'from', { status: to });
        (response.status === 409 ? refused : accepted).push(`${from}→${to}`);
      }
    }

    // The rule is one-sided and about where a move *comes from*: a run that has
    // concluded does not move, whatever it is asked to become. `passed → failed` is
    // refused for the same reason `passed → running` is — not because the target is
    // terminal, but because the run is.
    //
    // A no-op — the same status twice — is not a transition and stays permitted, so it
    // is excluded below rather than special-cased in the route.
    // `Set<string>`, because the pair halves arrive from a template literal and are
    // widened to `string` by the time they get here.
    const TERMINAL = new Set<string>(
      PERSISTED_RUN_STATUS_VALUES.filter((status) => status !== 'running'),
    );
    for (const pair of refused) {
      const [from] = pair.split('→') as [string];
      expect(TERMINAL.has(String(from)), `${pair} was refused from a non-terminal status`).toBe(
        true,
      );
    }
    for (const pair of accepted) {
      const [from, to] = pair.split('→') as [string, string];
      if (from === to) continue;
      expect(TERMINAL.has(String(from)), `${pair} was allowed from a terminal status`).toBe(false);
    }
    // And the guard is not vacuous: something must actually be refused, or the rule
    // above would hold for a route that permits everything.
    expect(refused.length).toBeGreaterThan(0);
  });
});

describe('the contract vocabulary', () => {
  it('has exactly one status the column refuses, so this route is the boundary', async () => {
    // If the two lists ever converge, the schema below stops being the thing that
    // holds them apart and the route would have no reason to prefer the narrower
    // one. Stated rather than assumed, because both lists are compile-time only.
    const refused = RUN_STATUS_VALUES.filter(
      (status) => !(PERSISTED_RUN_STATUS_VALUES as readonly string[]).includes(status),
    );
    expect(refused).toEqual(['queued']);
  });
});
