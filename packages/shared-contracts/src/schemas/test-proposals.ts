import { z } from 'zod/v4';

/**
 * AI test proposals: a unified diff for a new test file, proposed by the configured model from
 * a surviving mutant or a diff's uncovered lines.
 *
 * **A proposal, never a change.** Nothing on the server applies, commits, pushes or opens a
 * pull request with it; the response carries the patch and a person decides.
 *
 * The server may not have the code — a project registered by URL, scanned by CI — so the
 * source snippet is the caller's to send, and bounded.
 */

/** The longest source snippet a caller may send, in characters. */
export const MAX_SOURCE_SNIPPET = 20_000;

const Common = {
  sourceSnippet: z.string().max(MAX_SOURCE_SNIPPET).optional(),
  testFramework: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 ._+-]{1,50}$/u)
    .optional(),
};

/** `POST /api/v1/projects/:id/health/test-proposals` (operator). */
export const TestProposalBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('surviving-mutant'),
    /** A `stryker/surviving-mutant` finding of this project. */
    findingId: z.string().uuid(),
    ...Common,
  }),
  z.object({
    kind: z.literal('uncovered-lines'),
    commit: z.string().regex(/^[0-9a-f]{7,64}$/iu),
    /** A file of that commit's diff coverage that has uncovered changed lines. */
    path: z.string().trim().min(1).max(1000),
    ...Common,
  }),
]);
export type TestProposalBody = z.infer<typeof TestProposalBodySchema>;

export const TestProposalSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(['surviving-mutant', 'uncovered-lines']),
  findingId: z.string().nullable(),
  commit: z.string().nullable(),
  /** The source file the proposal is about. */
  path: z.string().min(1),
  testFramework: z.string().min(1),
  /** Where the new test file would go. */
  suggestedPath: z.string().min(1),
  /** A unified diff that creates `suggestedPath`. Never applied by the server. */
  patch: z.string().min(1),
  rationale: z.string(),
  model: z.string().min(1),
  provider: z.string().min(1),
  tokens: z.object({ input: z.number().int().nullable(), output: z.number().int().nullable() }),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
});
export type TestProposal = z.infer<typeof TestProposalSchema>;

export const TestProposalListSchema = z.object({ proposals: z.array(TestProposalSchema) });
export type TestProposalList = z.infer<typeof TestProposalListSchema>;
