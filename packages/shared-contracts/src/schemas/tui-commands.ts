import { z } from 'zod/v4';

import { QaScoreCategorySchema, QaScoreRowSchema } from './qa-score.js';

/**
 * Everything a terminal may ask the API to do.
 *
 * ## The command registry is the whole design
 *
 * A terminal that can run arbitrary text inside a multi-repo install is an RCE
 * surface for whoever holds it. So this file enumerates **every action the TUI can
 * take**, and each one carries its own request schema. There is no `command: string`
 * and no `argv` field anywhere in it, and there is no "custom command" entry — a
 * command the operator wants to run is declared in their `automate.config.json`,
 * where it is reviewable, version-controlled, and says which manifest line produced
 * it.
 *
 * That is not a limitation dressed as a principle. It is the reason the TUI can be
 * shipped to a customer who trusts it with a repository path.
 */

/** Every key the TUI sends, as one union. */
export const TUI_COMMANDS = [
  'projects.list',
  'project.add',
  'project.get',
  'commands.list',
  'run.start',
  'run.stop',
  'score.get',
  'gaps.get',
  'flaky.get',
  'hollow.get',
  'structure.get',
  'copilot.ask',
] as const;
export const TuiCommandNameSchema = z.enum(TUI_COMMANDS);
export type TuiCommandName = z.infer<typeof TuiCommandNameSchema>;

/**
 * A key press, as it arrives.
 *
 * `key` is a **named action**, not a keystroke: `score` is not `s`, and `score` is
 * not `3` either. A terminal whose commands are keystrokes has to re-bind on every
 * layout change and cannot show the reader what does what; a named action renders as
 * a label, and the binding that produced it is a display detail.
 */
export const TuiCommandSchema = z.object({
  command: TuiCommandNameSchema,
  /** Only the fields the named command declares are read; the rest are ignored. */
  projectId: z.string().min(1).optional(),
  commandId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  reason: z.string().min(1).max(500).optional(),
  category: QaScoreCategorySchema.optional(),
  question: z.string().min(1).max(500).optional(),
  /**
   * A repository path, for `project.add`.
   *
   * A **path**, not a URL and not a git remote. The runner spawns with this as its
   * working directory on the host it runs on, so a remote would need a fetch step
   * this product does not have — and inventing one here would be a second product.
   */
  repoPath: z.string().min(1).optional(),
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u)
    .optional(),
  /** Sent by `run.start` so a double tap of the key launches one run, not two. */
  idempotencyKey: z.string().min(1).optional(),
});
export type TuiCommand = z.infer<typeof TuiCommandSchema>;

/**
 * What each command needs, in one table.
 *
 * Declared as a map rather than encoded in the handler signatures so a reader can
 * see the whole surface at once — which is the only way to notice that a new command
 * was added without being asked "what does this need?". The `key` is the label a
 * terminal renders; there is deliberately **no** `description` beyond it, because a
 * longer label is documentation and documentation belongs beside the handler.
 */
export const TUI_COMMAND_REQUIREMENTS = {
  'projects.list': { label: 'Projects', fields: [] },
  'project.add': { label: 'Add a project', fields: ['name', 'slug', 'repoPath'] },
  'project.get': { label: 'Show a project', fields: ['projectId'] },
  'commands.list': { label: 'Runnable commands', fields: ['projectId'] },
  'run.start': { label: 'Run a command', fields: ['projectId', 'commandId', 'idempotencyKey'] },
  'run.stop': { label: 'Stop a run', fields: ['runId', 'reason'] },
  'score.get': { label: 'Health score', fields: ['projectId'] },
  'gaps.get': { label: 'Automation gaps', fields: ['projectId'] },
  'flaky.get': { label: 'Flaky tests', fields: ['projectId'] },
  'hollow.get': { label: 'Hollow tests', fields: ['projectId'] },
  'structure.get': { label: 'Structural findings', fields: ['projectId'] },
  'copilot.ask': { label: 'Ask the copilot', fields: ['projectId', 'question'] },
} as const satisfies Record<TuiCommandName, { label: string; fields: readonly string[] }>;

/**
 * A row the TUI is rendering, with the key it renders under.
 *
 * Keyed rather than positional so a row can be re-ordered — by score, by recency, by
 * category — without the selection following something else, and so "select row 3"
 * cannot silently become "select whatever is now third".
 */
export const TuiRowSchema = z.object({
  key: z.string().min(1),
  /** The primary line. */
  title: z.string().min(1),
  /** The secondary line. Never empty: a row with nothing to say is not a row. */
  detail: z.string().min(1),
  /** Where a client would send the reader. Absent rather than empty. */
  href: z.string().min(1).optional(),
  /** A cell's row id, when the row *is* a score cell. */
  row: QaScoreRowSchema.optional(),
  cell: z.string().optional(),
});
export type TuiRow = z.infer<typeof TuiRowSchema>;

/** One rendered view. */
export const TuiViewSchema = z
  .object({
    /** The command that produced this view, so a stale view can be identified. */
    command: TuiCommandNameSchema,
    projectId: z.string().min(1).optional(),
    /** A score total, when the view carries one. Never sent without its limiter. */
    total: z.number().min(0).max(100).optional(),
    /**
     * The row that limited the total. **Required whenever `total` is present.**
     *
     * The same clause as the HTTP contract, for the same reason: a weighted geometric
     * total cannot be diluted by a zero and cannot be diagnosed either, so a terminal
     * that renders the number alone is showing an arithmetic score's worth of
     * information from a geometric formula.
     */
    cappedBy: QaScoreRowSchema.optional(),
    rows: z.array(TuiRowSchema),
    /** The keys that were selected. Explicit, so a selection cannot drift. */
    selected: z.array(z.string()).default([]),
  })
  /**
   * The `total` ⇔ `cappedBy` coupling, **enforced** rather than promised.
   *
   * It was documented on the field and not checked, which is the same shape as every
   * other "the comment says" invariant this repository has had to go back and turn
   * into a rule: a comment is a claim, and a claim nothing reads is a convention.
   */
  .superRefine((view, ctx) => {
    if (view.total !== undefined && view.cappedBy === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['cappedBy'],
        message:
          'a total may not be rendered without the row that capped it: a weighted geometric mean ' +
          'cannot be diluted by a zero, and for the same reason it cannot be diagnosed either',
      });
    }
  });
export type TuiView = z.infer<typeof TuiViewSchema>;

/**
 * What the TUI can and cannot do, declared rather than implied.
 *
 * Rendered as a footer. A terminal that hides its own limits is asking the reader to
 * trust it, and `no-second-authority` is as true of a UI as of a database.
 */
export const TUI_CAPABILITIES = {
  /** Arbitrary shell: **never**. This is the property the whole design buys. */
  rawShell: false,
  /** The TUI starts a run by sending a **command id**, never an executable. */
  arbitraryCommands: false,
  /** Commands come from the project's stored profile. */
  resolvesCommandsServerSide: true,
  /** Every row names a cell, a run, or a gap. */
  everyRowTraceable: true,
} as const;
