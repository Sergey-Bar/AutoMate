/**
 * drizzle-run-repository.ts — Drizzle/Postgres-backed RunRepository implementation
 *
 * Implements all 8 methods of the RunRepository interface using Drizzle ORM
 * against the runs and tests tables from @automate/db.
 */
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { runs, tests } from '@automate/db';
import {
  toPersistedStatus,
  type RunAnalyticsSummary,
  type RunPatch,
  type RunRecord,
  type RunRepository,
  type TestRecord,
  type TestStatus,
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
        workspaceId: run.workspaceId,
        phase: run.phase,
        outcome: run.outcome,
        startedAt: new Date(run.startedAt),
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        status: toPersistedStatus(run.status),
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
          // On conflict as well as on insert. A run first written by a path that omitted
          // the workspace, and then updated through the reporter, must be *moved* into
          // the workspace rather than keeping the NULL it was born with — otherwise the
          // repair only happens on first write and the row stays invisible.
          workspaceId: run.workspaceId,
          // Coherent on update as well as insert: a run first written by a path that
          // left the phase at its default must be repaired here, not on the next create.
          phase: run.phase,
          outcome: run.outcome,
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
        // The phase and its outcome move together or not at all: the CHECK requires the
        // pair to agree, so a caller that patched one without the other would get a 500
        // for a request that was merely malformed.
        ...(patch.phase !== undefined && { phase: patch.phase }),
        ...(patch.outcome !== undefined && { outcome: patch.outcome }),
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
    const rows = await this.db.select().from(runs).where(eq(runs.id, id)).limit(1);
    if (rows.length === 0) return null;
    return this._mapRun(rows[0]);
  }

  async listRuns(options?: { limit?: number }): Promise<RunRecord[]> {
    // `limit` applied in the query rather than after it, so a capped read does not
    // still pull the whole table across the wire first (ledger Q-50).
    const query = this.db.select().from(runs).orderBy(asc(runs.startedAt));
    const rows = options?.limit === undefined ? await query : await query.limit(options.limit);
    return rows.map((r) => this._mapRun(r));
  }

  /**
   * The dashboard's three numbers, in one query.
   *
   * The route used to call `listRuns()` for this, which selected **every row**,
   * materialised it in Node and reduced it in JavaScript — on the page an operator
   * opens first after an incident, with a cost that grew with how long the install
   * had been running.
   *
   * Three aggregates over an index-only scan instead. The `avg` is taken with
   * `avg(...) FILTER (WHERE duration_ms IS NOT NULL)`, so a run with no recorded
   * duration is excluded from the average rather than counted as zero — which is
   * the difference between "no runs recorded a duration" and "every run was
   * instant".
   */
  async getAnalyticsSummary(): Promise<RunAnalyticsSummary> {
    const [row] = await this.db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${runs.status} IN ('passed', 'failed'))::int`,
        passed: sql<number>`count(*) FILTER (WHERE ${runs.status} = 'passed')::int`,
        durationCount: sql<number>`count(${runs.durationMs})::int`,
        durationTotal: sql<number>`coalesce(sum(${runs.durationMs}), 0)::bigint`,
      })
      .from(runs);
    const totalRuns = Number(row?.totalRuns ?? 0);
    const completed = Number(row?.completed ?? 0);
    const passed = Number(row?.passed ?? 0);
    const durationCount = Number(row?.durationCount ?? 0);
    const durationTotal = Number(row?.durationTotal ?? 0);
    return {
      totalRuns,
      passRate: completed === 0 ? 0 : Math.round((passed / completed) * 100),
      avgDurationMs: durationCount === 0 ? null : Math.round(durationTotal / durationCount),
    };
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
        errorCode: test.errorCode,
        errorMessage: test.errorMessage,
      })
      .onConflictDoUpdate({
        target: [tests.id, tests.runId],
        set: {
          title: test.title,
          file: test.file,
          status: test.status,
          durationMs: test.durationMs ?? null,
          // Cleared on conflict as well as set: a retry reported over the same
          // (testId, runId) must not keep the previous attempt's reason.
          errorCode: test.errorCode,
          errorMessage: test.errorMessage,
        },
      });
  }

  async patchTest(
    testId: string,
    runId: string,
    patch: Partial<Pick<TestRecord, 'status' | 'durationMs' | 'errorCode' | 'errorMessage'>>,
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
        ...(patch.errorCode !== undefined && { errorCode: patch.errorCode }),
        ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
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
    const rows = await this.db.select().from(tests).where(eq(tests.runId, runId));
    return rows.map((t) => this._mapTest(t));
  }

  async listTestsForRuns(runIds: readonly string[]): Promise<Map<string, TestRecord[]>> {
    const grouped = new Map<string, TestRecord[]>();
    if (runIds.length === 0) return grouped;
    // `inArray` rather than a loop of `listTests`, so the cost is one round trip
    // whatever the number of runs. An empty `runIds` returns above because
    // `inArray([])` is a query Postgres rejects, not one it answers.
    const rows = await this.db
      .select()
      .from(tests)
      .where(inArray(tests.runId, [...runIds]));
    for (const row of rows) {
      const bucket = grouped.get(row.runId) ?? [];
      bucket.push(this._mapTest(row));
      grouped.set(row.runId, bucket);
    }
    return grouped;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _mapRun(row: typeof runs.$inferSelect): RunRecord {
    return {
      id: row.id,
      // A row written before `workspace_id` was required, or by a path that omitted
      // it, reads back as NULL. It is surfaced as the empty string rather than
      // silently dropped, so a caller filtering on a workspace sees an empty-workspace
      // row it can account for instead of a run that vanishes from a query it should
      // have matched.
      workspaceId: row.workspaceId ?? '',
      phase: row.phase,
      outcome: row.outcome,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      // No cast: `row.status` comes straight from the column, whose type is
      // already the persisted subset. Casting it *wider* is what used to be
      // possible, and a wider status would then fail at the next write.
      status: row.status,
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
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
    };
  }
}
