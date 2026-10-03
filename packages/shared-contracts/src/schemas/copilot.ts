import { z } from 'zod/v4';

import {
  QaScoreCategorySchema,
  QaCellKeySchema,
  QaScoreRowSchema,
  SCORE_CATEGORIES,
} from './qa-score.js';

/**
 * What the copilot may say, and what it must be able to show.
 *
 * ## The hard rule, and why it is a schema rather than a prompt
 *
 * **"A suggestion that cannot cite a row does not render."** Plan decision, and the
 * one rule that separates a copilot from a text generator with a database attached.
 *
 * It is enforced here, in `evidence: z.array(z.string().min(1)).min(1)`, rather than in
 * a rendering check, for three reasons. A UI check is one implementation and the
 * TUI is a second; a prompt says "please cite evidence" and is advisory by
 * construction; and a schema is the one place every caller is already obliged to pass
 * through. The `.min(1)` is the whole point — a `.default([])` would accept exactly
 * the suggestion this rule exists to refuse.
 *
 * The cost is honest and worth stating: the copilot cannot say "everything else
 * looks fine", and it is not supposed to. A statement with nothing behind it is
 * indistinguishable from a guess, and a QA dashboard that guesses is worse than one
 * that is silent.
 */

/** One row the suggestion is anchored to. */
export const CopilotEvidenceSchema = z.object({
  /**
   * What kind of thing this is, so a client can render a link rather than a string.
   *
   * A bare `uri` would be a URL into nowhere: the client would have to parse it to
   * decide what to show, and a string whose meaning is in its prefix is a format
   * with no schema. Every variant here names something that exists in this system.
   */
  kind: z.enum([
    'run',
    'canonical-result',
    'artifact',
    'project',
    'command',
    'cell',
    'gap',
    'structural-finding',
    'module',
    'commit',
  ]),
  /** Stable within this installation. Rendered as a link by clients that can. */
  id: z.string().min(1),
  /** One sentence naming what this row shows. Never empty. */
  summary: z.string().min(1),
});
export type CopilotEvidence = z.infer<typeof CopilotEvidenceSchema>;

export const COPILOT_SUGGESTION_KINDS = [
  'add-missing-suite',
  'fix-hollow-tests',
  'quarantine-flaky-test',
  'raise-test-count',
  'split-dominant-cell',
  'cover-uncovered-surface',
  'decode-locked-pyramid',
  'tighten-coverage-target',
  'draft-regression-suite',
  'explain-for-stakeholder',
] as const;
export const CopilotSuggestionKindSchema = z.enum(COPILOT_SUGGESTION_KINDS);

/**
 * What "Draft a regression suite" is allowed to produce.
 *
 * ## A **proposal**, never a file
 *
 * Plan §4 capability 5: "Draft a regression suite from a failure cluster, as a
 * proposal into the customer's repo". The copilot does not write to a customer's
 * repository. It emits a document the operator reviews and commits, and this field
 * is that document — the same shape a pull request would carry, so applying it is a
 * merge rather than a command.
 *
 * The alternative — returning a shell line to run — is the raw-shell passthrough
 * D7 rules out, and here it would be worse: the command would be
 * `cat > tests/regression_test.py`, which is both a shell and a way to put
 * whatever the copilot chose on disk.
 */
/**
 * A repo-relative POSIX path, as it would appear in a pull request.
 *
 * **Constrained, not merely `min(1)`.** The first version of this field was
 * `z.string().min(1)` and accepted `/etc/passwd` — which defeats the entire claim
 * that a draft is "a document the operator reviews": a reviewer clicking an
 * absolute path is looking at a file outside the tree they approved. The
 * constraints are the three ways a path leaves the repository — absolute, `..`, and
 * a Windows drive or backslash.
 */
const RepoRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\'), {
    message: 'path must be repo-relative, not absolute',
  })
  .refine((value) => !/^[A-Za-z]:/u.test(value) && !value.includes('\\'), {
    message: 'path must use POSIX separators and carry no drive letter',
  })
  .refine(
    (value) => !value.split('/').includes('..'),
    'path must not traverse out of the repository',
  );

export const DraftedFileSchema = z.object({
  /** Repo-relative POSIX path, as it would appear in the pull request. */
  path: RepoRelativePathSchema,
  /** The whole file. The operator reviews it; the copilot never executes it. */
  content: z.string().min(1),
  /** Tests the cluster implies, named. A draft with no names is not reviewable. */
  covers: z.array(z.string().min(1)).min(1),
});
export type DraftedFile = z.infer<typeof DraftedFileSchema>;

/**
 * What "Translate" is allowed to produce.
 *
 * A non-technical stakeholder asks why the score is 62. The answer is **the same
 * arithmetic in fewer words**, never a different number: `readAloud` must cite the
 * cells it used, and `plainTotal` must equal the score's own `total`, because a
 * rounded figure that disagrees with the dashboard is the one thing a stakeholder
 * will notice and the one thing they will stop trusting.
 */
export const PlainExplanationSchema = z.object({
  /** One or two sentences, no jargon, no category names. */
  readAloud: z.string().min(1),
  /** The **same** total, not a friendlier one. Asserted equal to the score. */
  plainTotal: z.number().min(0).max(100),
  /** The cells the sentence is built from. */
  citedCells: z.array(z.string().min(1)).min(1),
});
export type PlainExplanation = z.infer<typeof PlainExplanationSchema>;

/**
 * One suggestion.
 *
 * ## `what` and `why` are separate, on purpose
 *
 * `what` is the change. `why` is the evidence *in words*. A screen that renders
 * both can show the reader what would change and what would justify it, and a
 * reader who disagrees can go to `evidence` and check. A single `message` field
 * collapses those and forces the client to parse prose to decide which part to put
 * where.
 */
export const CopilotSuggestionSchema = z
  .object({
    kind: CopilotSuggestionKindSchema,
    /** What would change. Present tense, no hedging. */
    what: z.string().min(1),
    /** Why this is the next thing to do, in one sentence naming the number. */
    why: z.string().min(1),
    /** The cell or row this moves. Required, so a suggestion always has a place. */
    target: z.union([QaCellKeySchema, QaScoreRowSchema]),
    /**
     * How much this is worth to the total, in `[-1, 1]`.
     *
     * **Negative is permitted and means "this lowers the score"** — a hollow-test
     * finding and a dominant-cell finding both do, which is why the range is not
     * `[0,1]`. Clamping them to zero would make the copilot's own arithmetic
     * contradict the score it is reading.
     */
    impact: z.number().min(-1).max(1),
    /** Rows the reader can open. `.min(1)`, and that is the rule. */
    evidence: z.array(CopilotEvidenceSchema).min(1),
    /**
     * The exact change, as a document the operator can commit.
     *
     * **A document, not a shell line.** A copilot that offers
     * `echo "commands": {...} >> automate.config.json` has handed back the raw-shell
     * passthrough D7 rules out, wearing a helpful tone. `overrides` is the
     * `automate.config.json` shape, so applying a suggestion is a merge into a file
     * under review rather than a command typed at a prompt.
     */
    overrides: z.record(z.string(), z.unknown()),
    /** Present on `draft-regression-suite` and **only** on that kind. */
    draft: z.array(DraftedFileSchema).optional(),
    /** Present on `explain-for-stakeholder` and **only** on that kind. */
    plain: PlainExplanationSchema.optional(),
    /** How sure the copilot is. Rendered beside the suggestion; never a gate. */
    confidence: z.number().min(0).max(1),
  })
  /**
   * The payload kinds, enforced against `kind`.
   *
   * A suggestion whose `draft` is attached to an unrelated kind is a payload a
   * client would render as a diff button on an advice it is not attached to — and
   * "the client must check which kind this is" is a convention every client has to
   * remember, which is the failure mode the evidence rule already refused.
   */
  .superRefine((suggestion, ctx) => {
    if (suggestion.draft !== undefined && suggestion.kind !== 'draft-regression-suite') {
      ctx.addIssue({
        code: 'custom',
        path: ['draft'],
        message: 'a draft is only meaningful on a draft-regression-suite suggestion',
      });
    }
    if (suggestion.plain !== undefined && suggestion.kind !== 'explain-for-stakeholder') {
      ctx.addIssue({
        code: 'custom',
        path: ['plain'],
        message: 'a plain explanation is only meaningful on an explain-for-stakeholder suggestion',
      });
    }
  });
export type CopilotSuggestion = z.infer<typeof CopilotSuggestionSchema>;

/** A question the reader asked. */
export const CopilotQuestionSchema = z.object({
  projectId: z.string().min(1),
  /** Free text. The copilot does not call a model to answer it — see the service. */
  question: z.string().min(1).max(500),
  /** One score category to focus on, or all of them. */
  category: QaScoreCategorySchema.optional(),
});
export type CopilotQuestion = z.infer<typeof CopilotQuestionSchema>;

/**
 * What the copilot answers.
 *
 * It is **not** a chat transcript and it is not prose. Every answer is a set of
 * ranked suggestions plus the score they came from, so a reader can disagree with
 * a suggestion and still trust the number underneath it.
 */
export const CopilotAnswerSchema = z.object({
  projectId: z.string().min(1),
  /** The score this answer was derived from, included so it cannot be quoted out of context. */
  derivedFrom: z.object({
    at: z.iso.datetime(),
    total: z.number().min(0).max(100),
    cappedBy: QaScoreRowSchema,
  }),
  /** Ranked best-value-first. Empty is a valid answer: a healthy project has nothing to fix. */
  suggestions: z.array(CopilotSuggestionSchema),
  /**
   * What the copilot deliberately did not say.
   *
   * Present because the alternative is silence, and silence reads as "nothing is
   * wrong". Naming the categories that are `n/a` — or that are simply not worth
   * raising — is what makes an empty answer trustworthy.
   */
  notSuggested: z.array(z.object({ target: z.string().min(1), because: z.string().min(1) })),
  /**
   * The categories this copilot covers.
   *
   * Declared rather than implied so a caller can tell "nothing to fix in the four
   * categories I cover" from "I only looked at two".
   */
  coveredCategories: z.array(QaScoreCategorySchema),
});
export type CopilotAnswer = z.infer<typeof CopilotAnswerSchema>;

/** Every suggestion kind has a shape the client can act on. */
export const COPILOT_SUGGESTION_KINDS_LIST = COPILOT_SUGGESTION_KINDS;
export { SCORE_CATEGORIES };
