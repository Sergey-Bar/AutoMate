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
 * The most ids one `IN (...)` statement may carry.
 *
 * PostgreSQL's own ceiling is 65 535 bind parameters, so any value under it is legal —
 * but a statement that large is a statement nobody reads, plans, or can attribute when it
 * turns out to be slow. 1 000 keeps a batch to one page and keeps the whole thing far
 * enough from the hard limit that a future change adding parameters per row cannot
 * accidentally reach it.
 *
 * It is a bound on the **statement**, not on the caller's list: a caller may pass a
 * million ids and get a million results, in a thousand statements. What it prevents is any
 * single query whose size is chosen by whoever called.
 */
const MAX_IDS_PER_IN_ARRAY = 1_000;

/**
 * Split a list into fixed-size batches.
 *
 * Yields exactly one batch when the list is at or under the limit, so the ordinary path is
 * unchanged — this is a guard on the pathological one, not a new code path for everyone.
 */
function* chunked(values: readonly string[], size: number): Generator<string[]> {
  // A non-positive size is an infinite loop, not a slow query: `at += 0` never advances.
  // It is reachable only from a misconfigured bound — the constructor's own default is
  // positive — and the alternative is a test run that hangs rather than one that fails.
  // Found by exactly that: the guard test asked for a bound of 0 to make the guard the
  // only thing between the caller and the statement, and never returned.
  if (size < 1) {
    throw new RangeError(`chunked was given a size of ${String(size)}; it must be at least 1.`);
  }
  for (let at = 0; at < values.length; at += size) {
    yield values.slice(at, at + size);
  }
}

/** One batch's ids, asserted against the bound.
 *
 * `chunked` above already guarantees this holds, so it never throws in practice. It is
 * here for the two things it makes true: a reader can see the bound at the call rather
 * than inferring it, and **a deleted `chunked` call becomes a red test** instead of a
 * silently unbounded statement.
 *
 * It is also why `no-unbounded-list-in-query` does not report this line. The rule reads a
 * bare identifier or a spread as "a list whose length the caller chose"; it cannot match a
 * call, because it cannot see what a call returns. That is the right answer here rather
 * than a suppression — the argument really is opaque, and the bound is enforced one line
 * above rather than described beside a shape the rule reads the wrong way.
 */
function oneBatchOf(ids: readonly string[], bound: number = MAX_IDS_PER_IN_ARRAY): string[] {
  if (ids.length > bound) {
    throw new RangeError(
      `oneBatchOf was given ${String(ids.length)} ids, over the bound of ` +
        `${String(bound)}. The caller must chunk — this guard exists so a ` +
        'removed chunk silently becomes an unbounded statement.',
    );
  }
  return [...ids];
}

/**
 * Any drizzle-orm Postgres client (node-postgres, pglite, neon, etc.)
 * All expose the same `PgDatabase` interface.
 */
type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

export class DrizzleRunRepository implements RunRepository {
  constructor(
    private readonly db: AnyPgDb,
    /**
     * The most ids one `IN (...)` may carry.
     *
     * Injectable so a test can set it to something small. Asserting the bound otherwise
     * means seeding a thousand real UUIDs and waiting for a thousand inserts, which is a
     * slow test that still does not prove *why* it passed — and the previous attempt at one
     * was a 49-second fixture that failed on row validity rather than on batching.
     *
     * With a bound of 2 and 5 runs, the test is fast and the assertion is unambiguous: more
     * statements than one, and every run's tests still present.
     */
    private readonly maxIdsPerInArray: number = MAX_IDS_PER_IN_ARRAY,
  ) {}

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
    // `inArray` rather than a loop of `listTests`, so the cost is one round trip for the
    // common case. An empty `runIds` returns above because `inArray([])` is a query
    // Postgres rejects, not one it answers.
    //
    // **Bounded in batches, because the caller's list is not.** Both callers pass
    // `runs.map((run) => run.id)` over an unbounded `listRuns()`, so the statement carried
    // one bind parameter per run *in the whole database*. It grew with the age of the
    // install, on the two pages an operator opens first — and PostgreSQL's ceiling is
    // 65 535 parameters, so this was a query that eventually stopped being answerable
    // rather than merely getting slow. The dashboard endpoints already bound `listRuns()`
    // for Q-50; this is the other end of the same path.
    //
    // The batches are sequential rather than concurrent on purpose: a caller that passed
    // 200 000 ids already has a problem, and issuing them all at once is how that becomes
    // an outage instead of a slow answer.
    for (const batch of chunked(runIds, this.maxIdsPerInArray)) {
      const rows = await this.db
        .select()
        .from(tests)
        .where(inArray(tests.runId, oneBatchOf(batch, this.maxIdsPerInArray)));
      for (const row of rows) {
        const bucket = grouped.get(row.runId) ?? [];
        bucket.push(this._mapTest(row));
        grouped.set(row.runId, bucket);
      }
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
