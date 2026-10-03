import { z } from 'zod/v4';
import {
  CopilotAnswerSchema,
  QaScoreSchema,
  ScoreCellSchema,
  StructuralFindingSchema,
  type QaScore,
} from '@automate/shared-contracts';

/**
 * Every QA shape the command center uses, re-exported through one module.
 *
 * Copilot included, so a screen imports every shape from here rather than reaching
 * into `@automate/shared-contracts` directly and learning a second convention. The
 * schemas are the **server's** contracts, imported rather than re-declared: a copy is
 * a second authority that disagrees the first time a field is added, which is the
 * defect `RUN_PHASES` was.
 */
export { CopilotAnswerSchema, QaScoreSchema, ScoreCellSchema, StructuralFindingSchema };
export type { QaScore };
export { CopilotQuestionSchema } from '@automate/shared-contracts';
export type { CopilotAnswer } from '@automate/shared-contracts';

/**
 * The gap queue, as the web client sees it.
 *
 * Declared here rather than imported from the copilot contract because they answer
 * different questions: `CopilotAnswer` is what the copilot *thinks*, and the queue is
 * what the score *found*. A client rendering the copilot's ranking as though it were
 * the score's ranking would present a model's judgement as arithmetic, which is the
 * one distinction this product cannot blur.
 */
export const QaGapSchema = z.object({
  cell: z.string().min(1),
  category: z.string().min(1),
  surface: z.string().min(1),
  current: z.number().min(0).max(1),
  potential: z.number().min(0).max(1),
  cheapestClosure: z.string().min(1),
});

export const QaGapsResponseSchema = z.object({
  gaps: z.array(QaGapSchema),
  /** Required whenever a queue is served, for the same reason a score names its limiter. */
  cappedBy: z.string().min(1),
});
export type QaGapsResponse = z.infer<typeof QaGapsResponseSchema>;

/**
 * Hollow and flaky cells.
 *
 * Two endpoints rather than one `/qa/deep-dive`, because they are read for
 * different decisions and a client that fetches one while rendering the other will
 * eventually cache it and serve a stale answer.
 */
export const QaHollowResponseSchema = z.object({
  cells: z.array(
    z.object({
      cell: z.string().min(1),
      hollowFingerprints: z.array(z.string().min(1)),
      signal: z.number().min(0).max(1),
    }),
  ),
});
export type QaHollowResponse = z.infer<typeof QaHollowResponseSchema>;

export const QaFlakyResponseSchema = z.object({
  cells: z.array(
    z.object({
      cell: z.string().min(1),
      flakyFingerprints: z.array(z.string().min(1)),
      flakeRate: z.number().min(0).max(1),
      stability: z.number().min(0).max(1),
    }),
  ),
});
export type QaFlakyResponse = z.infer<typeof QaFlakyResponseSchema>;

export const QaStructureResponseSchema = z.object({
  findings: z.array(StructuralFindingSchema),
});
export type QaStructureResponse = z.infer<typeof QaStructureResponseSchema>;

/** A registered project, as the command center lists it. */
export const RegisteredProjectSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  repoPath: z.string().nullable(),
  detectorVersion: z.number().int().min(1),
  createdAt: z.string().min(1),
});
export type RegisteredProject = z.infer<typeof RegisteredProjectSchema>;

export const ProjectListResponseSchema = z.object({
  projects: z.array(RegisteredProjectSchema),
});

/**
 * A runnable command, as the registry serves it.
 *
 * `argv` is present **and displayed as separate tokens**, never concatenated into a
 * shell line. The client has no way to run it — this is a browser — but a future
 * copy-paste button that rendered `' '.join(argv)` would hand an operator a string
 * they could run somewhere else with different quoting rules than we used.
 */
export const ProjectCommandSchema = z.object({
  id: z.string().min(1),
  argv: z.array(z.string().min(1)).min(1),
  category: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
  artifactGlobs: z.array(z.string().min(1)),
  env: z.array(z.string().min(1)),
});
export type ProjectCommand = z.infer<typeof ProjectCommandSchema>;

export const ProjectDetailResponseSchema = z.object({
  project: RegisteredProjectSchema,
  commands: z.array(ProjectCommandSchema),
});
export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;
