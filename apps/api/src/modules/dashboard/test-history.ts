/**
 * `GET /api/v1/dashboard/tests/history?key=<identity>` — one test's results, newest first.
 *
 * Read from the `(workspace_id, stable_id)` index (0045), one page at a time, so the cost is
 * the page and not the window: the insights reader scans every run since a date and says
 * `truncated` when it stops, which is right for a leaderboard and wrong for "what did this one
 * test do". A page that is full says where the next one starts.
 */

import { Hono } from 'hono';
import { failureSignature } from '@automate/reporting';
import { TestHistoryQuerySchema, type TestHistory } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../../errors/domain-error.js';
import type { RunRepository } from '../../repositories/run-repository.js';

const DAY_MS = 86_400_000;
const FAILED = new Set(['failed', 'timed_out']);

export function createTestHistoryRoutes(options: {
  repository: Pick<RunRepository, 'testHistory'>;
  now?: () => Date;
}): Hono {
  const app = new Hono();
  app.get('/api/v1/dashboard/tests/history', async (context) => {
    const query = TestHistoryQuerySchema.safeParse(context.req.query());
    if (!query.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'Invalid test history query', {
        details: { issues: query.error.issues },
      });
    }
    const { key, days, limit, before } = query.data;
    const now = options.now?.() ?? new Date();
    // One more than asked, to know whether an older page exists without counting.
    const rows = await options.repository.testHistory(key, {
      since: new Date(now.getTime() - days * DAY_MS),
      ...(before === undefined ? {} : { before: new Date(before) }),
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const entries = page.map(({ run, test }) => {
      const error = FAILED.has(test.status) ? (test.errorMessage ?? null) : null;
      return {
        runId: run.id,
        startedAt: run.startedAt,
        status: test.status,
        durationMs: test.durationMs,
        branch: run.branch,
        commitSha: run.commitSha,
        error,
        signature: error === null ? null : failureSignature(error).signature,
      };
    });
    const counts = new Map<string, { count: number; example: string }>();
    for (const entry of entries) {
      if (typeof entry.signature !== 'string' || typeof entry.error !== 'string') continue;
      const seen = counts.get(entry.signature);
      counts.set(entry.signature, {
        count: (seen?.count ?? 0) + 1,
        example: seen?.example ?? entry.error,
      });
    }
    const latest = page[0]?.test;
    const history: TestHistory = {
      key,
      title: latest?.title ?? null,
      file: latest?.file ?? null,
      days,
      entries,
      nextBefore: rows.length > limit ? (page.at(-1)?.run.startedAt ?? null) : null,
      signatures: [...counts.entries()]
        .map(([signature, value]) => ({ signature, ...value }))
        .sort(
          (left, right) => right.count - left.count || (left.signature < right.signature ? -1 : 1),
        ),
    };
    return context.json(history);
  });
  return app;
}
