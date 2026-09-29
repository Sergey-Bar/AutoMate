/**
 * in-memory-run-repository.ts — Test-only in-memory implementation of RunRepository
 *
 * Kept inside apps/api for the T14 vertical slice.  NOT for production use.
 * A real Drizzle+Postgres implementation would satisfy the same interface.
 */
import {
  aggregateRuns,
  type RunAnalyticsSummary,
  type RunPatch,
  type RunRecord,
  type RunRepository,
  type TestRecord,
} from './run-repository.js';

export class InMemoryRunRepository implements RunRepository {
  // Keyed by runId
  private readonly _runs = new Map<string, RunRecord>();
  // Keyed by `${testId}::${runId}`
  private readonly _tests = new Map<string, TestRecord>();

  // ── Public test-helper accessors ──────────────────────────────────────────

  /** Return all stored runs.  Useful for count assertions in tests. */
  getAllRuns(): RunRecord[] {
    return Array.from(this._runs.values());
  }

  /** Return all stored tests. */
  getAllTests(): TestRecord[] {
    return Array.from(this._tests.values());
  }

  // ── RunRepository implementation ─────────────────────────────────────────

  async upsertRun(run: RunRecord): Promise<void> {
    this._runs.set(run.id, { ...run });
  }

  async patchRun(id: string, patch: RunPatch): Promise<void> {
    const existing = this._runs.get(id);
    if (!existing) return; // no-op per interface contract

    const updated: RunRecord = { ...existing };

    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.finishedAt !== undefined) updated.finishedAt = patch.finishedAt;
    if (patch.durationMs !== undefined) updated.durationMs = patch.durationMs;

    // Accumulate counter deltas
    if (patch.passedDelta !== undefined) updated.passed += patch.passedDelta;
    if (patch.failedDelta !== undefined) updated.failed += patch.failedDelta;
    if (patch.flakyDelta !== undefined) updated.flaky += patch.flakyDelta;
    if (patch.skippedDelta !== undefined) updated.skipped += patch.skippedDelta;

    this._runs.set(id, updated);
  }

  async getRun(id: string): Promise<RunRecord | null> {
    return this._runs.get(id) ?? null;
  }

  async listRuns(): Promise<RunRecord[]> {
    return Array.from(this._runs.values());
  }

  /**
   * The aggregation, over the rows already in memory.
   *
   * Shared with the SQL implementation's semantics — completed runs only for the
   * pass rate, recorded durations only for the average — and `store-parity`
   * style tests hold the two to the same numbers, so the dashboard does not
   * change value depending on which repository is mounted.
   */
  getAnalyticsSummary(): Promise<RunAnalyticsSummary> {
    return Promise.resolve(aggregateRuns(this._runs.values()));
  }

  async upsertTest(test: TestRecord): Promise<void> {
    this._tests.set(this._testKey(test.id, test.runId), { ...test });
  }

  async patchTest(
    testId: string,
    runId: string,
    patch: Partial<Pick<TestRecord, 'status' | 'durationMs'>>,
  ): Promise<void> {
    const key = this._testKey(testId, runId);
    const existing = this._tests.get(key);
    if (!existing) return; // no-op

    const updated: TestRecord = { ...existing };
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.durationMs !== undefined) updated.durationMs = patch.durationMs;

    this._tests.set(key, updated);
  }

  async getTest(testId: string, runId: string): Promise<TestRecord | null> {
    return this._tests.get(this._testKey(testId, runId)) ?? null;
  }

  async listTests(runId: string): Promise<TestRecord[]> {
    return Array.from(this._tests.values()).filter((t) => t.runId === runId);
  }

  /**
   * One pass, grouped.
   *
   * The obvious implementation — `await Promise.all(runIds.map((id) => this.listTests(id)))`
   * — is the same N+1 it replaces: one scan of the whole map per run, which is
   * what the ledger row counted. One scan with a `Set` lookup per row is linear in
   * the number of tests, not in runs times tests.
   */
  async listTestsForRuns(runIds: readonly string[]): Promise<Map<string, TestRecord[]>> {
    const grouped = new Map<string, TestRecord[]>();
    if (runIds.length === 0) return grouped;
    const wanted = new Set(runIds);
    for (const record of this._tests.values()) {
      if (!wanted.has(record.runId)) continue;
      const bucket = grouped.get(record.runId) ?? [];
      bucket.push(record);
      grouped.set(record.runId, bucket);
    }
    return grouped;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _testKey(testId: string, runId: string): string {
    return `${testId}::${runId}`;
  }
}
