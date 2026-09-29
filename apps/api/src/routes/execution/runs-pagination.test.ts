import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from '../execution.js';
import { createErrorBoundary } from '../../errors/boundary.js';
import { MAX_RUNS_PER_PAGE, legacyRun } from './shared.js';
import type { ExecutionStore } from '../../execution/types.js';
import type { RunRepository } from '../../repositories/run-repository.js';

/**
 * The cap on `GET /api/v1/runs` was not a cap.
 *
 * The listing was bounded — `parsePageQuery` clamps to {@link MAX_RUNS_PER_PAGE} —
 * and then, when a legacy repository was mounted, an *unbounded* `listRuns()` was
 * concatenated into the same response array. The `!ids.has(run.id)` filter
 * de-duplicated runs already on the page and nothing else, so every legacy run
 * outside that page was appended with no limit at all (ledger Q-50).
 *
 * The result is a cap that holds only in the deployment where it is not tested: a
 * fresh install mounts no legacy repository and behaves correctly, and the one
 * whose listing grows without bound is the one nobody ran this against.
 */

/** A legacy repository holding `count` runs, none of them on the page. */
function legacyWith(count: number): RunRepository {
  return {
    listRuns: vi.fn().mockResolvedValue(
      Array.from({ length: count }, (_unused, index) => ({
        id: `legacy-${String(index)}`,
        projectId: 'web',
        status: 'passed',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:01:00.000Z',
        total: 1,
        passed: 1,
        failed: 0,
        flaky: 0,
        skipped: 0,
        durationMs: 1,
        branch: null,
        commitSha: null,
        triggeredBy: 'manual',
      })),
    ),
  } as unknown as RunRepository;
}

/** A store that reports an empty page, so every legacy run is "outside" it. */
function emptyStore(): ExecutionStore {
  return {
    listRuns: vi.fn().mockResolvedValue({ runs: [], hasMore: false }),
  } as unknown as ExecutionStore;
}

/** A store that returns a different page each time it is called. */
function storePaging(...pages: string[][]): ExecutionStore {
  let call = 0;
  return {
    listRuns: vi.fn(() => {
      const ids = pages[call] ?? [];
      call += 1;
      return Promise.resolve({
        runs: ids.map((id) => legacyRun(legacyRecord(id) as never)),
        hasMore: false,
      });
    }),
  } as unknown as ExecutionStore;
}

/** The record shape `legacyRun` projects from; only the id varies per page. */
function legacyRecord(id: string): Record<string, unknown> {
  return {
    id,
    projectId: 'web',
    status: 'passed',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    total: 1,
    passed: 1,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: 1,
    branch: null,
    commitSha: null,
    triggeredBy: 'manual',
  };
}

const app = (legacyRepository: RunRepository) =>
  new Hono()
    .use('*', async (c, next) => {
      await next();
    })
    .route(
      '/',
      createExecutionRoutes({
        store: emptyStore(),
        workspaceId: 'ws-1',
        bus: { publish: vi.fn() } as never,
        legacyRepository,
      }),
    );

describe('GET /api/v1/runs with a legacy repository mounted', () => {
  it('returns no more than the cap, however many legacy runs exist', async () => {
    const response = await app(legacyWith(500)).request('/api/v1/runs');
    const body = (await response.json()) as Array<{ id: string }>;

    // 500 legacy runs, a cap of 100. The old code returned all 500, because the
    // de-duplication filter only removed runs already on the — empty — page.
    expect(body.length).toBeLessThanOrEqual(MAX_RUNS_PER_PAGE);
  });

  it('honours a smaller limit the caller asked for', async () => {
    const response = await app(legacyWith(500)).request('/api/v1/runs?limit=5');
    const body = (await response.json()) as Array<{ id: string }>;
    expect(body.length).toBeLessThanOrEqual(5);
  });

  it('does not fetch the whole legacy table just to truncate it', async () => {
    // The other half of the defect. Even with a cap on the *response*, an
    // unbounded read still materialises every row in Node, which is the cost the
    // cap was added to avoid. So the repository call is asserted to be bounded
    // too — a fix that caps after an unbounded read passes the test above and
    // still holds the table in memory.
    const legacy = legacyWith(500);
    await app(legacy).request('/api/v1/runs?limit=5');

    const listRuns = legacy.listRuns as unknown as {
      mock: { calls: unknown[][] };
    };
    for (const call of listRuns.mock.calls) {
      // Either it was passed a limit, or it was never called at all. An
      // argument-less call is the defect.
      expect(call.length).toBeGreaterThan(0);
    }
  });

  it('serves the legacy rows once, and never repeats them on a later page', async () => {
    // The remaining half of Q-50, and the half the cap fix made worse rather than
    // better: `listRuns` takes a `limit` but no `after`, so paging through the
    // listing re-read the *head* of the legacy table every time. Page 1 was
    // `[legacy-0…legacy-9, db-1]` and page 2 was `[legacy-0…legacy-9, db-2]` — the
    // same ten rows, on every page, forever.
    //
    // The legacy repository is a migration bridge holding a static historical set,
    // so the honest answer is that it is not part of the cursor at all: it is served
    // on the first page only. That is one change rather than a second cursor on the
    // response, which has one `X-Next-Cursor` header for two sources.
    const legacy = legacyWith(10);
    const seen: string[][] = [];

    const cursorFor = (id: string): string =>
      Buffer.from(`2026-01-01T00:00:00.000Z|${id}`, 'utf8').toString('base64url');
    for (const cursor of ['', cursorFor('db-1'), cursorFor('db-2')]) {
      const response = await new Hono()
        .onError(
          createErrorBoundary({
            log: () => undefined,
            reportError: () => undefined,
            requestId: () => 'NO_REQUEST',
          }).onError,
        )
        .route(
          '/',
          createExecutionRoutes({
            store: storePaging(['db-1'], ['db-2'], ['db-3']),
            workspaceId: 'ws-1',
            bus: { publish: vi.fn() } as never,
            legacyRepository: legacy,
          }),
        )
        .request(`/api/v1/runs?limit=25${cursor === '' ? '' : `&cursor=${cursor}`}`);
      seen.push(((await response.json()) as Array<{ id: string }>).map((run) => run.id));
    }

    const legacyIds = seen[0]?.filter((id) => id.startsWith('legacy-')) ?? [];
    expect(legacyIds).toHaveLength(10);
    // Page one carries them…
    expect(seen[1]?.filter((id) => id.startsWith('legacy-'))).toEqual([]);
    // …and later pages carry only the store's own rows, so a client following the
    // cursor never sees the same run twice.
    expect(seen[1]?.every((id) => id.startsWith('db-'))).toBe(true);
  });

  it('still de-duplicates a legacy run that is also on the page', async () => {
    // The reason the legacy merge exists at all: a run can be in both stores, and
    // it must appear once. Capping must not be implemented by dropping runs.
    //
    // The page's run goes through `legacyRun` too, so it is the same record in
    // both stores — which is the situation the de-duplication exists for.
    const shared = {
      id: 'shared-1',
      projectId: 'web',
      status: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      total: 1,
      passed: 1,
      failed: 0,
      flaky: 0,
      skipped: 0,
      durationMs: 1,
      branch: null,
      commitSha: null,
      triggeredBy: 'manual',
    };
    const store = {
      listRuns: vi.fn().mockResolvedValue({
        runs: [legacyRun(shared as never)],
        hasMore: false,
      }),
    } as unknown as ExecutionStore;
    const legacy = {
      listRuns: vi.fn().mockResolvedValue([shared]),
    } as unknown as RunRepository;

    const response = await new Hono()
      .route(
        '/',
        createExecutionRoutes({
          store,
          workspaceId: 'ws-1',
          bus: { publish: vi.fn() } as never,
          legacyRepository: legacy,
        }),
      )
      .request('/api/v1/runs');
    const body = (await response.json()) as Array<{ id: string }>;

    expect(body.filter((run) => run.id === 'shared-1')).toHaveLength(1);
  });
});
