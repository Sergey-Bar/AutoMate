/**
 * reporter-persistence.ts — Maps normalized reporter events to RunRepository operations
 *
 * This module is the T14 persistence logic.  It receives a NormalizedReporterEvent
 * and applies the appropriate create/update to the RunRepository.
 *
 * Path-safety: attachment path fields (if present in payloads) are stripped of
 * path-traversal sequences before persistence, following the precedent in
 * Automate/apps/server/src/utils/safe-path.ts.
 *
 * Duplicate-handling rule (deterministic):
 *   run:start with existing runId → upsert (overwrite) — idempotent, no partial state.
 *   test:begin with existing (testId, runId) → upsert — idempotent.
 */
import { z } from 'zod/v4';
import { safeRelativePath } from '../http/safe-path.js';
import type { NormalizedReporterEvent } from '../routes/reporter.js';
import {
  DEFAULT_WORKSPACE_ID,
  phaseForReportedStatus,
  type RunRepository,
  type TestStatus,
} from '../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Path-safety helper (mirrors safe-path.ts from Dashboard)
// ---------------------------------------------------------------------------

/**
 * Strips path-traversal sequences from a user-supplied path string.
 * Returns the basename only when traversal is detected, preventing
 * directory escape even in persisted metadata.
 */
function sanitizeAttachmentPath(rawPath: string): string {
  // The rule lives in `http/safe-path.ts`: `routes/reporter.ts` sanitises the same
  // field on the way in and used to carry a byte-identical copy, so a fix to one was
  // invisible to the other.
  //
  // The empty string is passed through rather than sanitised. `path.normalize('')` is
  // `'.'` on Node, so sanitising it stored `.` as a spec file — which the dashboard
  // then rendered as a suite called `.` instead of folding the test into its
  // `unknown` suite, because `'.'` is truthy. Nothing is being sanitised here: there
  // is no path. The root cause belongs in `http/safe-path.ts`, which is outside this
  // change's reach.
  return rawPath === '' ? '' : safeRelativePath(rawPath);
}

// ---------------------------------------------------------------------------
// Payload schemas (Zod v4)
// ---------------------------------------------------------------------------

const RunStartPayloadSchema = z
  .object({
    total: z.number().int().nonnegative().optional().default(0),
    branch: z.string().optional(),
    commitSha: z.string().optional(),
    triggeredBy: z.string().optional(),
  })
  .passthrough();

const TestBeginPayloadSchema = z
  .object({
    testId: z.string().min(1),
    title: z.string().default(''),
    file: z.string().default(''),
  })
  .passthrough();

const TestEndPayloadSchema = z
  .object({
    testId: z.string().min(1),
    status: z.enum(['passed', 'failed', 'flaky', 'skipped', 'timedOut']),
    durationMs: z.number().optional(),
  })
  .passthrough();

/** The status a `test:end` payload can carry, before it is stored. */
type IncomingTestStatus = z.infer<typeof TestEndPayloadSchema>['status'];

/**
 * The single stored spelling of a test status.
 *
 * Playwright emits `timedOut`; `tests_status_check` (migration 0007) accepts only
 * `timed_out`, and a row holding the camelCase spelling reads back through
 * `testStatus()` as `unknown` — a timed-out test that nothing counted. The write
 * used to pass `timedOut` straight through a `as TestStatus` cast, so a legitimate
 * reporter upload hit the CHECK and came back as a classified failure.
 *
 * `routes/reporter.ts` collapses the same two spellings in its own
 * `normalizeTestStatus`. That function is module-private, and importing it here
 * would make a cycle between the route and the layer it calls, so this is a second
 * copy for now. The two should live in one place.
 */
function toStoredTestStatus(status: IncomingTestStatus): TestStatus {
  return status === 'timedOut' ? 'timed_out' : status;
}

const RunEndPayloadSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'interrupted']),
    durationMs: z.number().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

/**
 * Persist a normalized reporter event to the provided RunRepository.
 *
 * Unrecognised event types and payloads that fail validation are silently
 * skipped — the event has already been accepted by the route layer.
 *
 * Returns `true` when the **run** record was created or updated (callers
 * may use this signal to trigger a realtime broadcast).  Returns `false`
 * for test-only operations (test:begin) and for unrecognised event types.
 */
export async function persistReporterEvent(
  event: NormalizedReporterEvent,
  repo: RunRepository,
  options: { workspaceId?: string } = {},
): Promise<boolean> {
  const { type, runId, timestamp } = event;
  // Explicit, defaulted, and the same constant the listing filters on. Omitting it used
  // to write NULL, and the row was then invisible to `GET /api/v1/runs` — persisted,
  // queryable with psql, and absent from the product.
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;

  switch (type) {
    case 'run:start': {
      const parsed = RunStartPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return false;
      const p = parsed.data;
      // The phase and outcome, derived from the status rather than written beside it.
      // Leaving `phase` at its column default is what made a reported run look queued
      // for ever; see `phaseForReportedStatus`.
      const state = phaseForReportedStatus('running');
      await repo.upsertRun({
        id: runId,
        workspaceId,
        phase: state.phase,
        outcome: state.outcome,
        startedAt: timestamp,
        finishedAt: null,
        status: 'running',
        total: p.total,
        passed: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        durationMs: null,
        branch: p.branch ?? null,
        commitSha: p.commitSha ?? null,
        triggeredBy: p.triggeredBy ?? 'reporter',
      });
      return true;
    }

    case 'test:begin': {
      const parsed = TestBeginPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return false;
      const p = parsed.data;
      await repo.upsertTest({
        id: p.testId,
        runId,
        title: p.title,
        // Apply path safety to the file field (user-supplied)
        file: sanitizeAttachmentPath(p.file),
        status: 'running',
        durationMs: null,
      });
      // test:begin only creates a test row — run record unchanged.
      return false;
    }

    case 'test:end': {
      const parsed = TestEndPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return false;
      const p = parsed.data;
      // The stored spelling, computed once, so the comparison below and the counter
      // delta both see the same value the column will hold. Comparing the raw
      // payload instead made `timed_out` and `timedOut` look like two different
      // states and produced a delta for a transition that had not happened.
      const next = toStoredTestStatus(p.status);
      const previous = await repo.getTest(p.testId, runId);
      await repo.patchTest(p.testId, runId, {
        status: next,
        durationMs: p.durationMs ?? null,
      });
      if (previous && previous.status !== next) {
        const delta = transitionDelta(previous.status, next);
        if (delta) await repo.patchRun(runId, delta);
      }
      return true;
    }

    case 'run:end': {
      const parsed = RunEndPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return false;
      const p = parsed.data;
      // The phase and outcome travel with the status. Patching only `status` is what
      // left every reported run at `phase: 'queued'` after it had finished.
      const state = phaseForReportedStatus(p.status);
      await repo.patchRun(runId, {
        status: state.status,
        phase: state.phase,
        outcome: state.outcome,
        finishedAt: new Date().toISOString(),
        durationMs: p.durationMs ?? null,
      });
      return true;
    }

    default:
      // step:begin, step:end, stdout, stderr and future event types are
      // accepted by the route layer but not persisted in this slice.
      return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CounterDelta = Parameters<RunRepository['patchRun']>[1];

/**
 * The run counter a single test's status contributes.
 *
 * `running` and `queued` contribute nothing, because a test in flight has not been
 * counted as an outcome yet — and a `running → running` re-report is not a second
 * failure. `timed_out` is a failure, and must be spelled the way the row is.
 */
function statusToDelta(status: TestStatus): CounterDelta | null {
  switch (status) {
    case 'passed':
      return { passedDelta: 1 };
    case 'failed':
    case 'timed_out':
      return { failedDelta: 1 };
    case 'flaky':
      return { flakyDelta: 1 };
    case 'skipped':
      return { skippedDelta: 1 };
    case 'running':
    case 'queued':
      return null;
  }
}

function transitionDelta(previous: TestStatus, next: TestStatus): CounterDelta | null {
  const before = statusToDelta(previous);
  const after = statusToDelta(next);
  if (!before && !after) return null;
  const delta: CounterDelta = {};
  const fields: Array<'passedDelta' | 'failedDelta' | 'flakyDelta' | 'skippedDelta'> = [
    'passedDelta',
    'failedDelta',
    'flakyDelta',
    'skippedDelta',
  ];
  for (const field of fields) {
    const oldValue = before?.[field];
    const newValue = after?.[field];
    if (typeof oldValue === 'number' || typeof newValue === 'number') {
      (delta as Record<string, number>)[field] = (newValue ?? 0) - (oldValue ?? 0);
    }
  }
  return delta;
}
