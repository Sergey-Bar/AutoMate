import { z } from 'zod/v4';

/**
 * The reporter upload wire format — `POST /api/v1/reporter/upload` with a JSON body.
 *
 * It lives here rather than in the route because it is a **contract**, not an
 * implementation detail: it is what a reporter client sends, and `packages/reporter`
 * parses it into a `CanonicalRunResult` through `legacyUploadAdapter`. A schema that two
 * packages need is one the leaf owns, and `shared-contracts` is the leaf.
 *
 * It used to be declared in `apps/api/src/routes/reporter.ts`, which is how the upload
 * door ended up able to describe a run in terms nobody else could read: the rows it
 * validated had no canonical counterpart, so nothing downstream could say what a `flaky`
 * upload meant except the file that happened to be parsing it.
 */

/**
 * One uploaded test row.
 *
 * Both spellings of a timeout are admitted because rejecting one would fail a real
 * upload — Playwright emits `timedOut` and other reporters send `timed_out`. They are
 * collapsed to one canonical status by the parser, so the database never holds two names
 * for one state.
 *
 * `id` **or** `testId` is required, and the refinement is on the row rather than on a
 * later write: a test the caller cannot identify cannot be correlated with its own
 * attempts, and a row skipped at persistence is a test that disappeared between the
 * request and the table.
 */
export const ReporterUploadTestSchema = z
  .object({
    id: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    title: z.string().min(1),
    file: z.string().default(''),
    status: z.enum([
      'running',
      'passed',
      'failed',
      'flaky',
      'skipped',
      'timedOut',
      'timed_out',
      'queued',
      'cancelled',
      'interrupted',
    ]),
    durationMs: z.number().nonnegative().nullable().optional(),
    /** Why the test failed, as the producer stated it. */
    error: z
      .object({
        message: z.string().optional(),
        code: z.string().optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.id ?? value.testId), {
    message: 'id or testId is required',
    path: ['id'],
  });

/**
 * The upload body.
 *
 * `status` has **no default** and no `queued`. An absent status is derived from the
 * uploaded evidence by the shared ladder, so an evidence-free upload can never inherit a
 * green `passed`; `queued` is excluded because an upload names a status it observed, and
 * a queued run has observed nothing.
 */
export const ReporterUploadSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(['running', 'passed', 'failed', 'interrupted']).optional(),
  startedAt: z.string().min(1).optional(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  environment: z.string().optional(),
  triggeredBy: z.string().optional(),
  tests: z.array(ReporterUploadTestSchema).optional().default([]),
  summary: z
    .object({
      total: z.number().int().nonnegative().optional(),
      passed: z.number().int().nonnegative().optional(),
      failed: z.number().int().nonnegative().optional(),
      flaky: z.number().int().nonnegative().optional(),
      skipped: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type ReporterUploadPayload = z.infer<typeof ReporterUploadSchema>;
export type ReporterUploadTest = z.infer<typeof ReporterUploadTestSchema>;
