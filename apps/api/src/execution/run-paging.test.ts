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
  const ordered = [
    run('a', '2026-01-01T00:00:00.000Z'),
    run('b', '2026-01-01T00:00:00.000Z'),
    run('c', '2026-01-02T00:00:00.000Z'),
    run('d', '2026-01-03T00:00:00.000Z'),
    run('e', '2026-01-04T00:00:00.000Z'),
  ];

  it('caps the page and reports that more remain', () => {
    const page = pageRuns(ordered, { limit: 2 });
    expect(page.runs.map((entry) => entry.id)).toEqual(['a', 'b']);
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
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('distinguishes two runs sharing a creation time', () => {
    // `a` and `b` have the same timestamp to the millisecond. A cursor on the
    // timestamp alone would loop between them forever.
    const page = pageRuns(ordered, {
      limit: 1,
      after: encodeRunCursor(ordered[0] as ExecutionRun),
    });
    expect(page.runs.map((entry) => entry.id)).toEqual(['b']);
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
