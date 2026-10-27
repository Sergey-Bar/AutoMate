import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { TestHistorySchema } from '@automate/shared-contracts';
import { DrizzleRunRepository } from '../../repositories/drizzle-run-repository.js';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import type { RunRecord, RunRepository, TestRecord } from '../../repositories/run-repository.js';
import { withErrorBoundary } from '../../test-support/error-boundary-app.js';
import { createTestHistoryRoutes } from './test-history.js';

/**
 * One test's history, from the `(workspace_id, stable_id)` index, in both repositories.
 * The Drizzle one runs on the real migration graph, because the boundary is the column.
 */
const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/db/drizzle',
);

function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

const MINE = 'ws-history-a';
const THEIRS = 'ws-history-b';
const KEY = 'tests/pay.spec.ts › pays [webkit]';
const NOW = new Date('2026-10-26T12:00:00.000Z');
let client: PGlite;
let counter = 0;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  for (const id of [MINE, THEIRS]) {
    await db.insert(schema.workspaces).values({ id, name: id, configPath: 'c', createdAt: NOW });
  }
}, 180_000);

afterAll(async () => {
  await client.close();
});

async function seed(
  repository: RunRepository,
  workspaceId: string,
  hoursAgo: number,
  status: TestRecord['status'],
  error: string | null = null,
) {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const startedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  const run: RunRecord = {
    id,
    workspaceId,
    phase: 'complete',
    outcome: status === 'passed' ? 'passed' : 'failed',
    startedAt,
    finishedAt: startedAt,
    status: status === 'passed' ? 'passed' : 'failed',
    total: 1,
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'passed' ? 0 : 1,
    flaky: 0,
    skipped: 0,
    durationMs: 10,
    branch: 'main',
    commitSha: `c${String(counter)}`,
    triggeredBy: 'ci',
  };
  await repository.upsertRun(run);
  await repository.upsertTest({
    id: 'pays',
    runId: id,
    title: 'pays',
    file: 'tests/pay.spec.ts',
    stableId: KEY,
    status,
    durationMs: 10 + hoursAgo,
    errorCode: error === null ? null : 'TEST_FAILED',
    errorMessage: error,
  });
}

const harnesses: Array<{ name: string; make: (workspaceId: string) => RunRepository }> = [
  { name: 'in-memory', make: () => new InMemoryRunRepository() },
  {
    name: 'drizzle',
    make: (workspaceId) => new DrizzleRunRepository(drizzle(client, { schema }), workspaceId),
  },
];

for (const harness of harnesses) {
  describe(`GET /api/v1/dashboard/tests/history (${harness.name})`, () => {
    it('pages one test newest first, groups its failures by cause, and stays in its workspace', async () => {
      const mine = harness.make(MINE);
      // In the Drizzle case both repositories write one database, so this is the boundary.
      const theirs = harness.make(THEIRS);
      await seed(mine, MINE, 1, 'failed', 'Timeout 5000ms exceeded waiting for #pay');
      await seed(mine, MINE, 2, 'passed');
      await seed(mine, MINE, 3, 'failed', 'Timeout 3000ms exceeded waiting for #pay');
      await seed(mine, MINE, 30 * 24, 'failed', 'out of the window');
      await seed(theirs, THEIRS, 1, 'failed', 'another workspace');
      const app = withErrorBoundary(
        new Hono().route('/', createTestHistoryRoutes({ repository: mine, now: () => NOW })),
      );
      const ask = async (query: string) => {
        const response = await app.request(
          `/api/v1/dashboard/tests/history?key=${encodeURIComponent(KEY)}&days=7${query}`,
        );
        expect(response.status).toBe(200);
        return TestHistorySchema.parse(await response.json());
      };
      const first = await ask('&limit=2');
      expect(first.entries.map((entry) => entry.status)).toEqual(['failed', 'passed']);
      expect(first.title).toBe('pays');
      expect(first.nextBefore).toBe(first.entries[1]?.startedAt);
      const second = await ask(`&limit=2&before=${encodeURIComponent(first.nextBefore ?? '')}`);
      expect(second.entries.map((entry) => entry.status)).toEqual(['failed']);
      expect(second.nextBefore).toBeNull();
      const all = await ask('');
      expect(all.entries).toHaveLength(3);
      expect(all.entries.map((entry) => entry.error)).not.toContain('another workspace');
      // Two timeouts with different numbers are one cause.
      expect(all.signatures).toHaveLength(1);
      expect(all.signatures[0]?.count).toBe(2);
    });
  });
}

describe('the history query', () => {
  it('refuses a missing key', async () => {
    const app = withErrorBoundary(
      new Hono().route('/', createTestHistoryRoutes({ repository: new InMemoryRunRepository() })),
    );
    expect((await app.request('/api/v1/dashboard/tests/history')).status).toBe(400);
  });
});
