/**
 * drizzle-run-repository.ts — Drizzle/Postgres-backed RunRepository implementation
 *
 * Implements all 8 methods of the RunRepository interface using Drizzle ORM
 * against the runs and tests tables from @automate/db.
 */
import { eq, and, sql, asc } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { runs, tests } from '@automate/db';
import type {
  RunPatch,
  RunRecord,
  RunRepository,
  RunStatus,
  TestRecord,
  TestStatus,
} from './run-repository.js';

/**
 * Any drizzle-orm Postgres client (node-postgres, pglite, neon, etc.)
 * All expose the same `PgDatabase` interface.
 */
type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

export class DrizzleRunRepository implements RunRepository {
  constructor(private readonly db: AnyPgDb) {}

  // ── RunRepository implementation ─────────────────────────────────────────

  async upsertRun(run: RunRecord): Promise<void> {
    await this.db
      .insert(runs)
      .values({
        id: run.id,
        startedAt: new Date(run.startedAt),
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        status: run.status,
        total: run.total,
        passed: run.passed,
        failed: run.failed,
        flaky: run.flaky,
        skipped: run.skipped,
        durationMs: run.durationMs ?? null,
        branch: run.branch ?? null,
        commitSha: run.commitSha ?? null,
        triggeredBy: run.triggeredBy,
      })
      .onConflictDoUpdate({
        target: runs.id,
        set: {
          startedAt: new Date(run.startedAt),
          finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
          status: run.status,
          total: run.total,
          passed: run.passed,
          failed: run.failed,
          flaky: run.flaky,
          skipped: run.skipped,
          durationMs: run.durationMs ?? null,
          branch: run.branch ?? null,
          commitSha: run.commitSha ?? null,
          triggeredBy: run.triggeredBy,
        },
      });
  }

  async patchRun(id: string, patch: RunPatch): Promise<void> {
    const existing = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);
    if (existing.length === 0) return; // no-op per interface contract

    await this.db
      .update(runs)
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.finishedAt !== undefined && {
          finishedAt: patch.finishedAt ? new Date(patch.finishedAt) : null,
        }),
        ...(patch.durationMs !== undefined && { durationMs: patch.durationMs }),
        ...(patch.passedDelta !== undefined && {
          passed: sql`${runs.passed} + ${patch.passedDelta}`,
        }),
        ...(patch.failedDelta !== undefined && {
          failed: sql`${runs.failed} + ${patch.failedDelta}`,
        }),
        ...(patch.flakyDelta !== undefined && {
          flaky: sql`${runs.flaky} + ${patch.flakyDelta}`,
        }),
        ...(patch.skippedDelta !== undefined && {
          skipped: sql`${runs.skipped} + ${patch.skippedDelta}`,
        }),
      })
      .where(eq(runs.id, id));
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return this._mapRun(rows[0]);
  }

  async listRuns(): Promise<RunRecord[]> {
    const rows = await this.db.select().from(runs).orderBy(asc(runs.startedAt));
    return rows.map((r) => this._mapRun(r));
  }

  async upsertTest(test: TestRecord): Promise<void> {
    await this.db
      .insert(tests)
      .values({
        id: test.id,
        runId: test.runId,
        title: test.title,
        file: test.file,
        status: test.status,
        durationMs: test.durationMs ?? null,
      })
      .onConflictDoUpdate({
        target: [tests.id, tests.runId],
        set: {
          title: test.title,
          file: test.file,
          status: test.status,
          durationMs: test.durationMs ?? null,
        },
      });
  }

  async patchTest(
    testId: string,
    runId: string,
    patch: Partial<Pick<TestRecord, 'status' | 'durationMs'>>,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: tests.id })
      .from(tests)
      .where(and(eq(tests.id, testId), eq(tests.runId, runId)))
      .limit(1);
    if (existing.length === 0) return; // no-op per interface contract

    await this.db
      .update(tests)
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.durationMs !== undefined && { durationMs: patch.durationMs }),
      })
      .where(and(eq(tests.id, testId), eq(tests.runId, runId)));
  }

  async getTest(testId: string, runId: string): Promise<TestRecord | null> {
    const rows = await this.db
      .select()
      .from(tests)
      .where(and(eq(tests.id, testId), eq(tests.runId, runId)))
      .limit(1);
    if (rows.length === 0) return null;
    return this._mapTest(rows[0]);
  }

  async listTests(runId: string): Promise<TestRecord[]> {
    const rows = await this.db
      .select()
      .from(tests)
      .where(eq(tests.runId, runId));
    return rows.map((t) => this._mapTest(t));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _mapRun(row: typeof runs.$inferSelect): RunRecord {
    return {
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      status: row.status as RunStatus,
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      flaky: row.flaky,
      skipped: row.skipped,
      durationMs: row.durationMs ?? null,
      branch: row.branch ?? null,
      commitSha: row.commitSha ?? null,
      triggeredBy: row.triggeredBy ?? 'manual',
    };
  }

  private _mapTest(row: typeof tests.$inferSelect): TestRecord {
    return {
      id: row.id,
      runId: row.runId,
      title: row.title,
      file: row.file,
      status: row.status as TestStatus,
      durationMs: row.durationMs ?? null,
    };
  }
}
