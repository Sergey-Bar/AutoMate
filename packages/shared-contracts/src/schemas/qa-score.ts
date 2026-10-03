import { z } from 'zod/v4';

/**
 * The QA Health Score, as the wire contract.
 *
 * ## Every cell carries its own inputs
 *
 * That clause is the contract, not a detail of it. A client that receives a
 * number and a component breakdown can explain the number **without re-running
 * the score function and without trusting this server** — it renders what it was
 * given. A score without provenance is a mood ring, and a client that has to
 * re-derive a number to display it is a second implementation of the number.
 *
 * ## The capping term is not optional
 *
 * `cappedBy` and `cappingValue` are required fields. The total is a weighted
 * *geometric* mean, which cannot dilute a zero — and for exactly that reason the
 * total alone cannot be diagnosed. A client that renders the total without the
 * term that limited it is displaying an arithmetic score's worth of information
 * from a geometric formula, which is worse than displaying an arithmetic mean,
 * because the reader has no reason to distrust it.
 */
/** Rows of the score matrix. Fixed at five; a project marks one `n/a`. */
export const SCORE_CATEGORIES = ['unit', 'integration', 'e2e', 'performance', 'security'] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

/** Columns of the score matrix. "backend score" and "frontend score" are 3/3 of these. */
export const SCORE_SURFACES = ['backend', 'frontend', 'platform'] as const;
export type ScoreSurface = (typeof SCORE_SURFACES)[number];

/**
 * One list, in this file, and every other module imports it.
 *
 * `RUN_PHASES` was once declared twice — `packages/orchestration/src/phase-outcome.ts`
 * and `packages/db/src/schema/dashboard.ts` — and a schema test failed whenever one
 * was edited without the other. That is the entire argument for this living in the
 * contract package: `packages/projects` computes with these names, `run-command`
 * declares commands against them, and the web client renders them, so a sixth copy
 * in a leaf package would be a fifth thing to keep in step.
 */
export const QaScoreCategorySchema = z.enum(SCORE_CATEGORIES);

export const QaScoreSurfaceSchema = z.enum(SCORE_SURFACES);

/**
 * The sixth row, which is the suite's shape rather than its health.
 *
 * Kept out of `SCORE_CATEGORIES` because a project marking it `n/a` is a
 * different statement from a project having no performance tests.
 */
export const PYRAMID_ROW = 'pyramid-shape' as const;

/** The three layers the pyramid is made of, in the order the chart stacks them. */
export const PYRAMID_LAYERS = [
  'unit',
  'integration',
  'e2e',
] as const satisfies readonly ScoreCategory[];
export type PyramidLayer = (typeof PYRAMID_LAYERS)[number];

export type ScoreRowId = ScoreCategory | typeof PYRAMID_ROW;

export const QaScoreRowSchema = z.enum([...SCORE_CATEGORIES, PYRAMID_ROW]);

/** `unit:backend` — the key a target, a cell and a report row all share. */
export const QaCellKeySchema = z
  .string()
  .regex(/^(unit|integration|e2e|performance|security):(backend|frontend|platform)$/u);

/**
 * The four components of one cell, plus the counts they were computed from.
 *
 * `presence` is `0` or `1` and is **multiplicative**: a category with no suite is
 * `0`, not a small number. `excluded` marks a cell the project declared `n/a`,
 * which is renormalised away rather than scored as zero — without it a
 * frontend-only repository scores zero for ever.
 */
export const ScoreCellSchema = z.object({
  key: QaCellKeySchema,
  category: QaScoreCategorySchema,
  surface: QaScoreSurfaceSchema,
  /** `0`–`1`. */
  score: z.number().min(0).max(1),
  presence: z.number().min(0).max(1),
  depth: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  signal: z.number().min(0).max(1),
  /** Declared `n/a`; excluded from the total and its weight redistributed. */
  excluded: z.boolean(),
  inputs: z.object({
    executedTests: z.number().int().min(0),
    targetTests: z.number().min(0),
    /** `null` when no coverage artifact was ingested — absence, not zero. */
    surfaceCoverage: z.number().min(0).max(1).nullable(),
    coverageTarget: z.number().min(0).max(1).nullable(),
    flakeRate: z.number().min(0).max(1),
    /** Failed, every time. Distinct from flaky, which means the outcome flipped. */
    failedFingerprints: z.array(z.string().min(1)),
    flakyFingerprints: z.array(z.string().min(1)),
    hollowFingerprints: z.array(z.string().min(1)),
    qualifyingRuns: z.number().int().min(0),
  }),
});
export type ScoreCell = z.infer<typeof ScoreCellSchema>;

/** One row's contribution, and how many of its cells were actually scored. */
export const ScoreRowValueSchema = z.object({
  id: QaScoreRowSchema,
  value: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  includedCells: z.number().int().min(0),
});
export type ScoreRowValue = z.infer<typeof ScoreRowValueSchema>;

/** One missing thing, and what would close it. Ranked by what closing it is worth. */
export const GapSchema = z.object({
  cell: QaCellKeySchema,
  category: QaScoreCategorySchema,
  surface: QaScoreSurfaceSchema,
  current: z.number().min(0).max(1),
  /** Upper bound on what closing this cell is worth to the total. */
  potential: z.number().min(0).max(1),
  cheapestClosure: z.string().min(1),
});
export type Gap = z.infer<typeof GapSchema>;

/**
 * Structural findings. Reported, never scored — none of them changes the total,
 * because a cell that is present, deep, stable and non-hollow has earned its
 * number by the formula and silently discounting it would be a fifth rule nobody
 * could see.
 */
export const StructuralFindingSchema = z.object({
  kind: z.enum([
    'green_but_empty',
    'uncovered_surface',
    'dominant_cell',
    'single_layer_dependency',
  ]),
  statement: z.string().min(1),
  cells: z.array(z.string().min(1)),
  impact: z.number().min(0).max(1),
});
export type StructuralFindingPayload = z.infer<typeof StructuralFindingSchema>;

/** The pyramid's observed and target shapes, and the drift between them. */
export const PyramidShapeSchema = z.object({
  observed: z.object({ unit: z.number(), integration: z.number(), e2e: z.number() }),
  target: z.object({ unit: z.number(), integration: z.number(), e2e: z.number() }),
  /**
   * The target the project itself declared, or `null` when it declared none.
   *
   * `null` and a filled default are different claims, and a client that cannot tell
   * them apart will render "your pyramid is off target" about a target the team
   * never chose.
   */
  declaredTarget: z
    .object({ unit: z.number(), integration: z.number(), e2e: z.number() })
    .nullable(),
  shape: z.number().min(0).max(1),
  drift: z.number().min(0),
});

/**
 * Everything the number was read from.
 *
 * `infraFailedRate` is a **separate field** and never folded into a fail rate.
 * A run that died because the machine fell over says nothing about the code under
 * test, and mixing the two is how a QA dashboard starts lying about a team.
 */
export const ScoreProvenanceSchema = z.object({
  projectId: z.string().min(1),
  /** Which detector shaped the profile the targets came from. */
  detectorVersion: z.number().int().min(1).nullable(),
  runsRead: z.number().int().min(0),
  resultsRead: z.number().int().min(0),
  infraFailedRuns: z.array(z.string().min(1)),
  infraFailedRate: z.number().min(0).max(1),
  quarantinedFingerprints: z.array(z.string().min(1)),
  outcomeCounts: z.record(z.string(), z.number().int().min(0)),
});
export type ScoreProvenance = z.infer<typeof ScoreProvenanceSchema>;

/**
 * Every list on this schema is `readonly`, and that is a correction rather than a
 * style choice: `score()` builds these with `readonly` arrays, so a mutable
 * declaration here made the contract's own type disagree with the function that
 * produces it, and every consumer that passed a score straight through had to cast.
 * A wire payload is not a working buffer.
 */
export const QaScoreSchema = z
  .object({
    projectId: z.string().min(1),
    /** The window this score describes. */
    at: z.iso.datetime(),
    /** `0`–`100`. */
    total: z.number().min(0).max(100),
    /** Required. The total alone cannot be diagnosed; this says why. */
    cappedBy: QaScoreRowSchema,
    cappingValue: z.number().min(0).max(1),
    cells: z.array(ScoreCellSchema).length(15).readonly(),
    surfaces: z.record(QaScoreSurfaceSchema, z.number().min(0).max(1)),
    rows: z.array(ScoreRowValueSchema).length(6).readonly(),
    pyramid: PyramidShapeSchema,
    gaps: z.array(GapSchema).readonly(),
    findings: z.array(StructuralFindingSchema).readonly(),
    provenance: ScoreProvenanceSchema,
    /** The weights that produced it. A number whose weights are not shown is not reviewable. */
    weights: z.object({
      cell: z.object({ depth: z.number(), stability: z.number(), signal: z.number() }),
      rows: z.record(QaScoreCategorySchema, z.number()),
      pyramid: z.number(),
    }),
  })
  /**
   * The `cappedBy` ⇔ `cappingValue` coupling, enforced rather than promised.
   *
   * It was documented on the field and not checked, which is the shape of every
   * other "the comment says" invariant this repository has had to turn back into a
   * rule: a comment is a claim, and a claim nothing reads is a convention.
   */
  .superRefine((score, ctx) => {
    if (score.total === 0 && score.cappingValue > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['cappingValue'],
        message:
          'a total of zero comes from a row contributing zero, so the capping value cannot be ' +
          'positive: the geometric mean cannot be diluted by a zero, and a non-zero limiter here ' +
          'means the two fields disagree about why',
      });
    }
  });
export type QaScore = z.infer<typeof QaScoreSchema>;

/**
 * The score diff, which is **not** "the score fell 4 points".
 *
 * The contract's own docstring says what it is for: "Security `D` fell because 3
 * target files gained no coverage after commit `abc`". Every entry names the
 * input that moved, so a client can render a cause rather than a delta.
 */
export const ScoreDeltaSchema = z.object({
  projectId: z.string().min(1),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  previousTotal: z.number().min(0).max(100),
  currentTotal: z.number().min(0).max(100),
  /** The capping term at each end, so a diff cannot hide a changed limiter. */
  previousCappedBy: QaScoreRowSchema,
  currentCappedBy: QaScoreRowSchema,
  contributions: z.array(
    z.object({
      /** Which component moved: `cell`, `row`, or `pyramid`. */
      scope: z.enum(['cell', 'row', 'pyramid', 'presence', 'cap']),
      key: z.string().min(1),
      before: z.number(),
      after: z.number(),
      /** One sentence naming the input, not the number. */
      cause: z.string().min(1),
      /**
       * What the reader can go and look at: a run id, a fingerprint, a file path,
       * a commit, a config key.
       *
       * **`.min(1)`, not `.default([])`.** A contribution that cannot cite a row
       * is a number with no story, and the copilot's hard rule is "a suggestion
       * that cannot cite a row does not render". Enforcing it here rather than in
       * a UI turns that rule from a convention every client has to remember into
       * a contract they cannot accept an invalid payload through — which is plan
       * task 19's requirement, applied to the diff.
       */
      evidence: z.array(z.string().min(1)).min(1),
    }),
  ),
});
export type ScoreDelta = z.infer<typeof ScoreDeltaSchema>;
