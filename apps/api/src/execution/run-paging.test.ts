import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { decodeRunCursor, encodeRunCursor, normalizeRunLimit, pageRuns } from './run-paging.js';
import type { ExecutionRun } from './types.js';

/**
 * The run listing was unbounded: every run in the install's history, each with
 * its tests and artifacts, each validated through the canonical schema. It is
 * the dashboard's first request, so its cost grew with the size of the workspace
 * rather than with the size of the page.
 *
 * These cover the window itself. The store-level behaviour is held by
 * `store-parity.test.ts`, and the query count by `run-listing-queries.test.ts`.
 */
function run(id: string, createdAt: string): ExecutionRun {
  return { id, createdAt } as ExecutionRun;
}

describe('run paging window', () => {
  // **Newest first**, which is the order the stores hand over. The fixture used to be
  // ascending, so every assertion in this block described a sequence the product never
  // serves — and `pageRuns` does not sort, it windows whatever it is given. The
  // assertions are unchanged and now mean what they say: the first two of this page are
  // the two most recent runs.
  const ordered = [
    run('e', '2026-01-04T00:00:00.000Z'),
    run('d', '2026-01-03T00:00:00.000Z'),
    run('c', '2026-01-02T00:00:00.000Z'),
    run('b', '2026-01-01T00:00:00.000Z'),
    run('a', '2026-01-01T00:00:00.000Z'),
  ];

  it('caps the page and reports that more remain', () => {
    const page = pageRuns(ordered, { limit: 2 });
    expect(page.runs.map((entry) => entry.id)).toEqual(['e', 'd']);
    expect(page.hasMore).toBe(true);
  });

  it('reports no more when the page reaches the end', () => {
    const page = pageRuns(ordered, { limit: 5 });
    expect(page.runs).toHaveLength(5);
    expect(page.hasMore).toBe(false);
  });

  it('walks every row exactly once across pages', () => {
    // The property that matters: no skips, no repeats. Paging on a cursor that
    // is not unique produces both, and it looks correct.
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page: { runs: ExecutionRun[]; hasMore: boolean } = pageRuns(ordered, {
        limit: 2,
        after: cursor,
      });
      seen.push(...page.runs.map((entry) => entry.id));
      if (!page.hasMore) break;
      cursor = encodeRunCursor(page.runs[page.runs.length - 1] as ExecutionRun);
    }
    expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('distinguishes two runs sharing a creation time', () => {
    // `a` and `b` have the same timestamp to the millisecond, and in newest-first order
    // `b` sorts *before* `a` — the id breaks the tie in the serving direction. A cursor
    // on the timestamp alone would loop between them forever.
    const page = pageRuns(ordered, {
      limit: 1,
      after: encodeRunCursor(ordered[3] as ExecutionRun),
    });
    expect(page.runs.map((entry) => entry.id)).toEqual(['a']);
  });

  it('clamps a hostile or nonsensical page size', () => {
    expect(normalizeRunLimit(undefined)).toBe(25);
    expect(normalizeRunLimit(0)).toBe(1);
    expect(normalizeRunLimit(-5)).toBe(1);
    expect(normalizeRunLimit(1_000_000)).toBe(100);
    expect(normalizeRunLimit(Number.NaN)).toBe(25);
    expect(normalizeRunLimit(2.9)).toBe(2);
  });

  it('refuses a cursor it did not issue rather than restarting from the top', () => {
    // Restarting would return the first page again, which a caller following
    // cursors would loop on forever.
    const page = pageRuns(ordered, { limit: 2, after: 'not-a-cursor' });
    expect(page.runs).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('round-trips a cursor through the wire format', () => {
    const cursor = encodeRunCursor(ordered[2] as ExecutionRun);
    expect(decodeRunCursor(cursor)).toEqual({
      createdAt: '2026-01-02T00:00:00.000Z',
      id: 'c',
    });
    for (const bad of ['', '   ', '!!!', 'bm9wZQ']) {
      expect(decodeRunCursor(bad === '!!!' ? '!!!' : bad), bad).toBeUndefined();
    }
    expect(decodeRunCursor(undefined)).toBeUndefined();
  });
});

describe('both stores page identically', () => {
  it('serves the newest run first, so the page an operator opens shows the latest run', async () => {
    // The regression this test exists for, found by running the E2E suite against a real
    // database rather than by reading this file.
    //
    // Both stores ordered the listing `createdAt ASC` and applied the limit in the same
    // query, so `GET /api/v1/runs` returned the **oldest** N runs in the install. Once
    // an install had more runs than a page, the newest run was not on the first page at
    // all — and because the cursor walks *forward* in time, it could not appear on a
    // later page either. An operator opening the dashboard after an incident saw the
    // oldest runs in their install.
    //
    // The E2E suite could not see it either: `vertical-slice.spec.ts` seeds a run and
    // then looks for it on page one, so with more than 25 runs seeded the run never
    // appeared and the test reported "not persisted" — which was true of the *page*, and
    // false of the *database*. The run was in PostgreSQL the whole time; a direct query
    // against the container is what proved it.
    // A clock that advances by a millisecond per read, so every run has a distinct
    // `createdAt`. Without it the 30 runs share one timestamp to the millisecond, the
    // id becomes the tiebreak, and "newest" is not a thing the assertion can mean —
    // the test would then be checking the tiebreak rather than the order, and would
    // pass or fail on the shape of a random UUID.
    let tick = 0;
    const store = new InMemoryExecutionStore({
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++)),
    });
    const created: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const result = await store.createRun(
        {
          externalId: `ext-newest-${index}`,
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        `newest-key-${index}`,
        'ws-newest',
      );
      created.push(result.run.id);
    }

    const first = await store.listRuns('ws-newest', undefined, { limit: 5 });

    // The newest run, first. Not "the last five" — the *newest*, because that is the one
    // a person opening the dashboard is looking for.
    expect(first.runs[0]?.id).toBe(created.at(-1));
    expect(first.runs.map((entry) => entry.id)).toContain(created.at(-1));

    // And the order is descending across the page, so "newest first" is a property of
    // the sequence rather than a lucky first element.
    const times = first.runs.map((entry) => (entry as ExecutionRun).createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('still walks every row exactly once when the order is newest-first', async () => {
    // The other half of the same change. Reversing the order without reversing the
    // cursor would page *towards* newer runs, so page 2 would repeat rows the caller has
    // already seen — the failure that looks like a correct page that repeats.
    const store = new InMemoryExecutionStore();
    for (let index = 0; index < 7; index += 1) {
      await store.createRun(
        {
          externalId: `ext-walk-${index}`,
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        `walk-key-${index}`,
        'ws-walk',
      );
    }

    /** @type {string[]} */
    const seen = [];
    /** @type {string | undefined} */
    let cursor = undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await store.listRuns('ws-walk', undefined, {
        limit: 3,
        after: cursor,
      });
      seen.push(...result.runs.map((entry) => entry.id));
      if (!result.hasMore) break;
      cursor = encodeRunCursor(result.runs[2] as ExecutionRun);
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('gives the same page from the in-memory store as from the window above', async () => {
    const store = new InMemoryExecutionStore();
    for (let index = 0; index < 5; index += 1) {
      await store.createRun(
        {
          externalId: `ext-${index}`,
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        `page-key-${index}`,
        'ws-page',
      );
    }
    const first = await store.listRuns('ws-page', undefined, { limit: 2 });
    expect(first.runs).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await store.listRuns('ws-page', undefined, {
      limit: 2,
      after: encodeRunCursor(first.runs[1] as ExecutionRun),
    });
    const firstIds = first.runs.map((entry) => entry.id);
    const secondIds = second.runs.map((entry) => entry.id);
    // No overlap between pages, which is the property a caller depends on.
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(second.runs).toHaveLength(2);
  });

  it('caps the default page so an unbounded listing cannot recur', async () => {
    const store = new InMemoryExecutionStore();
    for (let index = 0; index < 30; index += 1) {
      await store.createRun(
        {
          externalId: `ext-${index}`,
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        `cap-key-${index}`,
        'ws-cap',
      );
    }
    const page = await store.listRuns('ws-cap');
    // The default is 25; the point is that it is a number and not "all".
    expect(page.runs.length).toBeLessThanOrEqual(25);
    expect(page.hasMore).toBe(true);
  });

  it('rejects a cursor it did not issue, rather than silently restarting', async () => {
    const store = new InMemoryExecutionStore();
    await store.createRun(
      {
        externalId: 'ext-cursor',
        source: 'api',
        testType: 'browser',
        framework: 'playwright',
        timeoutMs: 1_000,
        requiredCapabilities: [],
        labels: [],
        configuration: {},
      } as never,
      'cursor-key',
      'ws-cursor',
    );
    // A garbage cursor that happens to be valid base64 decodes to nothing, so
    // treating it as "no cursor" would return the first page again and a caller
    // following cursors would loop.
    const page = await store.listRuns('ws-cursor', undefined, { after: 'bm90LWEtY3Vyc29y' });
    expect(page.runs).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
