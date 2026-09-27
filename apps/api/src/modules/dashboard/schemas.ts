/**
 * schemas.ts — request bodies for the dashboard's write paths.
 *
 * The dashboard read every body with `(await c.req.json()) as Record<string, unknown>`
 * and then hand-checked three fields. Two problems, both found in production code
 * rather than in review:
 *
 * 1. An empty or malformed body made `c.req.json()` **throw**, and the throw was
 *    not caught — so `POST` with no body at all was an unhandled rejection rendered
 *    as a 500 by the error boundary, indistinguishable from a real fault. The
 *    validation it was supposed to do never ran.
 * 2. `as Record<string, unknown>` is an assertion, not a check. A body of
 *    `{ name: 5, passRateThreshold: 'ninety' }` satisfied the type and was then
 *    rejected by the hand-rolled checks, which is a re-implementation of what Zod
 *    already does — and one more place for the vocabulary to drift.
 *
 * So: one schema per body, `.strict()` so an unexpected field is an error rather
 * than silently dropped, and the routes `safeParse` a value that can be `null`.
 */

import { z } from 'zod';
import { PERSISTED_RUN_STATUS_VALUES } from '@automate/shared-contracts';

export const CreateQualityGateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    passRateThreshold: z
      .number()
      .finite()
      .min(0, 'passRateThreshold must be between 0 and 100')
      .max(100, 'passRateThreshold must be between 0 and 100'),
  })
  .strict();

export type CreateQualityGateBody = z.infer<typeof CreateQualityGateBodySchema>;

export const AddQuarantineEntryBodySchema = z
  .object({
    testTitle: z.string().trim().min(1).max(500),
    testFile: z.string().trim().min(1).max(500),
    // Optional, and explicitly nullable: the store's column is nullable and a
    // caller sending `null` means "no reason given" rather than "omit the field".
    reason: z.string().max(2_000).nullish(),
  })
  .strict();

export type AddQuarantineEntryBody = z.infer<typeof AddQuarantineEntryBodySchema>;

/**
 * The body of `PATCH /api/v1/dashboard/runs/:id/status`.
 *
 * `PERSISTED_RUN_STATUS_VALUES`, not the wider `RUN_STATUS_VALUES`. `queued` is a
 * legitimate thing for a caller to say about a run and an illegitimate thing for
 * `runs.status` to store, so the two lists are not interchangeable and this route
 * is the last place that can tell them apart. The previous hand-rolled check
 * accepted the wider list and handed the mismatch to the column, where
 * `runs_status_check` refused it.
 */
export const PatchRunStatusBodySchema = z
  .object({
    status: z.enum(PERSISTED_RUN_STATUS_VALUES),
  })
  .strict();

export type PatchRunStatusBody = z.infer<typeof PatchRunStatusBodySchema>;

/**
 * The status a quarantine entry may hold, and the moves between them.
 *
 * `pending` is the state a quarantined test starts in (migration 0006, and the
 * reason a fresh quarantine no longer hides a test from the pass rate before a
 * human decides). Nothing could ever move it: there was no transition at all, so
 * the only reachable state was the one that does not exclude anything.
 *
 * The vocabulary is `['pending', 'approved', 'rejected']` — the same three values
 * the column's `CHECK` enforces, and the Drizzle `enum`. Both are
 * compile-time-only declarations, so this is a third restatement; it is here
 * because the *transition* rule is the part no other declaration carries, and
 * because `quarantine-status.test.ts` proves the three agree.
 */
export const QUARANTINE_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type QuarantineStatus = (typeof QUARANTINE_STATUSES)[number];

/**
 * Legal transitions, as one table.
 *
 * `pending → approved | rejected` and nothing else. A resolved entry stays
 * resolved: re-opening a rejection would silently un-decide a decision somebody
 * made, and there is no record of which state it was in before, so the reversal
 * could not even be reported. A no-op transition to the same status is permitted
 * so a retry of an idempotent PATCH is not an error.
 */
export const QUARANTINE_TRANSITIONS: Readonly<
  Record<QuarantineStatus, readonly QuarantineStatus[]>
> = {
  pending: ['pending', 'approved', 'rejected'],
  approved: ['approved'],
  rejected: ['rejected'],
};

export function canTransitionQuarantine(from: QuarantineStatus, to: QuarantineStatus): boolean {
  return QUARANTINE_TRANSITIONS[from].includes(to);
}

export const ResolveQuarantineBodySchema = z
  .object({
    status: z.enum(QUARANTINE_STATUSES).refine((status) => status !== 'pending', {
      message: 'status must be approved or rejected; use POST to quarantine, not to re-open one',
    }),
    // A resolution that removes a test from the pass rate is a claim somebody made,
    // so the reason is required rather than optional.
    resolution: z.string().trim().min(1).max(2_000),
    resolutionType: z.enum(['fixed', 'fixed_with_skip', 'not_reproducible', 'waived']).optional(),
  })
  .strict();

export type ResolveQuarantineBody = z.infer<typeof ResolveQuarantineBodySchema>;
