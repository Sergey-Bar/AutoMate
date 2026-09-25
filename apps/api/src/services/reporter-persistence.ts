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
import path from 'node:path';
import type { NormalizedReporterEvent } from '../routes/reporter.js';
import type { RunRepository, TestStatus } from '../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Path-safety helper (mirrors safe-path.ts from Dashboard)
// ---------------------------------------------------------------------------

/**
 * Strips path-traversal sequences from a user-supplied path string.
 * Returns the basename only when traversal is detected, preventing
 * directory escape even in persisted metadata.
 */
function sanitizeAttachmentPath(rawPath: string): string {
  const normalized = path.normalize(rawPath);
  // Reject absolute paths and any remaining traversal sequences
  if (path.isAbsolute(normalized) || normalized.includes('..') || normalized.includes('\0')) {
    // Return just the basename as a safe fallback
    return path.basename(normalized);
  }
  // Normalise to forward slashes for cross-platform consistency
  // (Playwright reporter always emits forward-slash paths)
  return normalized.split(path.sep).join('/');
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
): Promise<boolean> {
  const { type, runId, timestamp } = event;

  switch (type) {
    case 'run:start': {
      const parsed = RunStartPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return false;
      const p = parsed.data;
      await repo.upsertRun({
        id: runId,
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
      const previous = await repo.getTest(p.testId, runId);
      await repo.patchTest(p.testId, runId, {
        status: p.status as TestStatus,
        durationMs: p.durationMs ?? null,
      });
      if (previous && previous.status !== p.status) {
        const delta = transitionDelta(previous.status, p.status);
        if (delta) await repo.patchRun(runId, delta);
      }
      return true;
    }

    case 'run:end': {
      const parsed = RunEndPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return false;
      const p = parsed.data;
      await repo.patchRun(runId, {
        status: p.status,
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

function statusToDelta(status: string): CounterDelta | null {
  switch (status) {
    case 'passed':
      return { passedDelta: 1 };
    case 'failed':
    case 'timedOut':
      return { failedDelta: 1 };
    case 'flaky':
      return { flakyDelta: 1 };
    case 'skipped':
      return { skippedDelta: 1 };
    default:
      return null;
  }
}

function transitionDelta(previous: string, next: string): CounterDelta | null {
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
