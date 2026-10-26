/**
 * drizzle-run-repository.ts — Drizzle/Postgres-backed RunRepository implementation
 *
 * Implements all 8 methods of the RunRepository interface using Drizzle ORM
 * against the runs and tests tables from @automate/db.
 */
import { eq, and, sql, asc, desc, gte, lt, inArray, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { runs, tests } from '@automate/db';
import { storedTestIdentity } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
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
     * The one workspace this repository reads and writes (ledger MNT-17).
     *
     * Required, and bound at construction the way `DrizzleReporterIngestionService` is,
     * because `RunRepository`'s methods take no workspace and every one of them answered
     * for the whole installation: `getRun` returned another workspace's run by id, the
     * dashboard listed every run, and `upsertRun`'s conflict branch moved an existing run
     * into whichever workspace wrote last. Every statement below now carries it.
     */
    private readonly workspaceId: string,
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
    // The record and the repository both name a workspace, and two authorities for one
    // value is the shape P-5 records. They must agree; a disagreement is a wiring defect,
    // and writing either one would put the run somewhere its writer cannot read it.
    if (run.workspaceId !== this.workspaceId) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        `Run ${run.id} names workspace "${run.workspaceId}", but this repository writes "${this.workspaceId}"`,
      );
    }
    const written = await this.db
      .insert(runs)
      .values({
        id: run.id,
        workspaceId: this.workspaceId,
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
        ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
        triggeredBy: run.triggeredBy,
      })
      .onConflictDoUpdate({
        target: runs.id,
        set: {
          // The workspace is **not** in the update set. It used to be, to repair a run
          // first written with NULL; the column is NOT NULL now (0028), so that repair has
          // nothing left to do, and keeping it would let a second workspace reusing a run
          // id move the run into itself. `setWhere` makes the conflict branch a no-op for
          // a row another workspace owns, and the empty `returning` below says so.
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
          ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
          triggeredBy: run.triggeredBy,
        },
        setWhere: eq(runs.workspaceId, this.workspaceId),
      })
      .returning({ id: runs.id });
    if (written.length === 0) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        `Run ${run.id} already exists in another workspace`,
      );
    }
  }

  async patchRun(id: string, patch: RunPatch): Promise<void> {
    const existing = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(this.ownRun(id))
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
      .where(this.ownRun(id));
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const rows = await this.db.select().from(runs).where(this.ownRun(id)).limit(1);
    if (rows.length === 0) return null;
    return this._mapRun(rows[0]);
  }

  async listRuns(options?: { limit?: number }): Promise<RunRecord[]> {
    // `limit` applied in the query rather than after it, so a capped read does not
    // still pull the whole table across the wire first (ledger Q-50).
    const query = this.db
      .select()
      .from(runs)
      .where(eq(runs.workspaceId, this.workspaceId))
      .orderBy(asc(runs.startedAt));
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
      .from(runs)
      .where(eq(runs.workspaceId, this.workspaceId));
    const totalRuns = Number(row?.totalRuns ?? 0);
    const completed = Number(row?.completed ?? 0);
    const passed = Number(row?.passed ?? 0);
    const durationCount = Number(row?.durationCount ?? 0);
    const durationTotal = Number(row?.durationTotal ?? 0);
    return {
      totalRuns,
      passRate: completed === 0 ? null : Math.round((passed / completed) * 100),
      avgDurationMs: durationCount === 0 ? null : Math.round(durationTotal / durationCount),
    };
  }

  async upsertTest(test: TestRecord): Promise<void> {
    // A test is evidence about its run, so it is written only under a run this workspace
    // owns. Without the check a second workspace could attach rows to another's run: the
    // foreign key on `run_id` proves the run exists, not whose it is.
    const owner = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(this.ownRun(test.runId))
      .limit(1);
    if (owner.length === 0) {
      throw new DomainError(ErrorCode.RUN_NOT_FOUND, `Run ${test.runId} not found`);
    }
    await this.db
      .insert(tests)
      .values({
        id: test.id,
        runId: test.runId,
        workspaceId: this.workspaceId,
        title: test.title,
        file: test.file,
        stableId: test.stableId,
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
          stableId: test.stableId,
          status: test.status,
          durationMs: test.durationMs ?? null,
          // Cleared on conflict as well as set: a retry reported over the same
          // (testId, runId) must not keep the previous attempt's reason.
          errorCode: test.errorCode,
          errorMessage: test.errorMessage,
        },
        setWhere: eq(tests.workspaceId, this.workspaceId),
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
      .where(this.ownTest(testId, runId))
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
      .where(this.ownTest(testId, runId));
  }

  async getTest(testId: string, runId: string): Promise<TestRecord | null> {
    const rows = await this.db.select().from(tests).where(this.ownTest(testId, runId)).limit(1);
    if (rows.length === 0) return null;
    return this._mapTest(rows[0]);
  }

  async listTests(runId: string): Promise<TestRecord[]> {
    const rows = await this.db
      .select()
      .from(tests)
      .where(and(eq(tests.workspaceId, this.workspaceId), eq(tests.runId, runId)));
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
        .where(
          and(
            eq(tests.workspaceId, this.workspaceId),
            inArray(tests.runId, oneBatchOf(batch, this.maxIdsPerInArray)),
          ),
        );
      for (const row of rows) {
        const bucket = grouped.get(row.runId) ?? [];
        bucket.push(this._mapTest(row));
        grouped.set(row.runId, bucket);
      }
    }
    return grouped;
  }

  async latestRunForCommit(projectId: string, commitSha: string): Promise<RunRecord | null> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, this.workspaceId),
          eq(runs.projectId, projectId),
          eq(runs.commitSha, commitSha),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : this._mapRun(row);
  }

  async testHistory(
    stableId: string,
    page: { since: Date; before?: Date; limit: number },
  ): Promise<Array<{ run: RunRecord; test: TestRecord }>> {
    // The index is `(workspace_id, stable_id)` on `tests`; the run join is on its primary
    // key, and both sides carry the workspace, so nothing here can read across it.
    const rows = await this.db
      .select({ run: runs, test: tests })
      .from(tests)
      .innerJoin(runs, and(eq(runs.id, tests.runId), eq(runs.workspaceId, this.workspaceId)))
      .where(
        and(
          eq(tests.workspaceId, this.workspaceId),
          eq(tests.stableId, stableId),
          gte(runs.startedAt, page.since),
          ...(page.before === undefined ? [] : [lt(runs.startedAt, page.before)]),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(page.limit);
    return rows.map((row) => ({ run: this._mapRun(row.run), test: this._mapTest(row.test) }));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** One run, and only if this workspace owns it. */
  private ownRun(id: string): SQL | undefined {
    return and(eq(runs.workspaceId, this.workspaceId), eq(runs.id, id));
  }

  /** One test, and only if this workspace owns it. */
  private ownTest(testId: string, runId: string): SQL | undefined {
    return and(
      eq(tests.workspaceId, this.workspaceId),
      eq(tests.id, testId),
      eq(tests.runId, runId),
    );
  }

  private _mapRun(row: typeof runs.$inferSelect): RunRecord {
    return {
      id: row.id,
      // NOT NULL since 0028, so there is no empty-workspace row left to surface.
      workspaceId: row.workspaceId,
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
      projectId: row.projectId ?? null,
      triggeredBy: row.triggeredBy ?? 'manual',
    };
  }

  private _mapTest(row: typeof tests.$inferSelect): TestRecord {
    return {
      id: row.id,
      runId: row.runId,
      title: row.title,
      file: row.file,
      stableId: storedTestIdentity(row),
      status: row.status as TestStatus,
      durationMs: row.durationMs ?? null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
    };
  }
}
