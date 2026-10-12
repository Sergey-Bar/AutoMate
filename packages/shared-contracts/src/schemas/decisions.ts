import { z } from 'zod/v4';

/**
 * The decision wire contract — the loop read back.
 *
 * ## Why these shapes live here and the verdict vocabulary does not
 *
 * `DECISION_VERDICTS` is declared in `@automate/db`, and `shared-contracts`
 * depends on nothing but `zod` — so a `z.enum(DECISION_VERDICTS)` here would
 * either add a dependency edge or copy the list, and a copy is the second
 * authority this repository has spent four waves removing. The counts below are
 * therefore `z.string()`-keyed, and the closed vocabulary is enforced one layer
 * in: `bucketTimeline` in the store writes **every** verdict, zero included, so
 * a screen reads the five keys it knows without a fallback and a sixth verdict
 * fails the store's own validation before it can reach the wire.
 *
 * ## What the record is on the wire
 *
 * The row minus its tenancy column. A screen renders a verdict about a finding;
 * the workspace is what scoped the query, not part of the answer — the same
 * strip both stores perform, asserted by the parity suite rather than promised.
 */

/** One decision as a screen reads it. */
export const DecisionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  findingId: z.string().min(1),
  /** Which cell the finding is about, when it is about one. */
  cell: z.string().nullable(),
  verdict: z.string().min(1),
  ownerId: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  note: z.string().nullable(),
  deferUntil: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** The decisions for one project, open first. */
export const DecisionListResponseSchema = z.object({
  decisions: z.array(DecisionSchema).readonly(),
});
export type DecisionListResponse = z.infer<typeof DecisionListResponseSchema>;

/**
 * One week of verdicts.
 *
 * **Every week in the window is present, including the empty ones.** A timeline
 * that omits a week with no verdicts cannot say the loop stopped — the week is
 * simply absent, and an absent week reads as a week nobody looked at rather than
 * a week nobody decided in. The screen's sentence ("a week with no verdicts is a
 * week the loop stopped") needs the empty bucket to be there.
 */
export const DecisionTimelineWeekSchema = z.object({
  /** The Monday of the week, as `YYYY-MM-DD`. */
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  /** One entry per verdict the vocabulary has, zero included. */
  counts: z.record(z.string().min(1), z.number().int().min(0)),
  total: z.number().int().min(0),
});
export type DecisionTimelineWeek = z.infer<typeof DecisionTimelineWeekSchema>;

/** How much one owner decided inside the window. */
export const DecisionTimelineOwnerSchema = z.object({
  /** `null` is a verdict recorded by nobody named — counted, not hidden. */
  ownerId: z.string().min(1).nullable(),
  decided: z.number().int().min(0),
});
export type DecisionTimelineOwner = z.infer<typeof DecisionTimelineOwnerSchema>;

/**
 * The decision timeline for one project: verdicts by week, by owner, and what
 * has no verdict at all.
 *
 * ## `undecided` is computed against ids the caller supplies
 *
 * The derived findings are the output of a pure engine (`lib/findings.ts`, the
 * score's gap queue), not a table — so the store cannot know them and the route
 * passes them in. The store's half of the answer is exact: which of those ids
 * have no row. The two halves meet in the route, which is the only place that
 * knows both the engine and the store.
 */
export const DecisionTimelineSchema = z.object({
  window: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    weeks: z.number().int().min(1).max(52),
  }),
  /** Oldest first, and `weeks` entries long — one per week in the window. */
  weeks: z.array(DecisionTimelineWeekSchema).readonly(),
  owners: z.array(DecisionTimelineOwnerSchema).readonly(),
  undecided: z.object({
    count: z.number().int().min(0),
    findingIds: z.array(z.string().min(1)).readonly(),
  }),
});
export type DecisionTimeline = z.infer<typeof DecisionTimelineSchema>;
