import { z } from 'zod/v4';

import { SCORE_CATEGORIES } from './qa-score.js';

/**
 * What `run.start` may ask a runner to execute.
 *
 * ## `argv` is an array, and there is deliberately no string form
 *
 * Plan decision D7. A terminal in a multi-repo install is an RCE surface for
 * whoever holds it, and a `command: string` field hands that surface back the
 * moment anything concatenates into it. An argv array cannot be handed to a
 * shell, so the dangerous operation is *unavailable* rather than discouraged —
 * which also means nothing in this repository has to implement shell quoting, a
 * second parser that would drift from the first.
 *
 * The cost is stated rather than hidden: an operator who needs `a && b` cannot
 * express it here. They express it in their own `Makefile`, `npm` script or
 * `justfile`, which is a file under their control and reviewable in a pull
 * request — which is the point.
 */
export const RunCommandSchema = z.object({
  /** Stable within a project, so a UI can key a "re-run this" action on it. */
  id: z.string().min(1),
  /**
   * The executable and its arguments, already split.
   *
   * At least one element; an empty argv has no command in it and every platform
   * would do something different with it.
   */
  argv: z.array(z.string().min(1)).min(1),
  /** Which score row this command is evidence for. */
  category: z.enum(SCORE_CATEGORIES),
  /** The manifest line the detector read to propose this, or the config key that declared it. */
  evidence: z.string().min(1),
  /** 0–1. Shown beside the command; never a gate. */
  confidence: z.number().min(0).max(1),
  /**
   * Repo-relative globs whose matches are ingested after the run.
   *
   * Declared here rather than discovered afterwards: an adapter that looked at the
   * workspace to decide what to ingest would ingest whatever the dependency tree
   * happened to drop there, and a coverage report offered to a *result* adapter
   * is a percentage parsed as if it were a suite.
   */
  artifactGlobs: z.array(z.string().min(1)).default([]),
  /**
   * Environment variable **names** to pass through to the child.
   *
   * The runner's default allowlist is `PATH`, `HOME` and `CI`; anything beyond
   * that is named here. The values live in the install, never in the repository —
   * a value in a committed file is a secret in a committed file.
   */
  env: z.array(z.string().min(1)).default([]),
  /** Milliseconds before the run is declared `timed_out`. */
  timeoutMs: z.number().int().min(1).optional(),
});
export type RunCommand = z.infer<typeof RunCommandSchema>;

/** The body of `POST /api/v1/projects/{projectId}/run.start`. */
export const RunStartBodySchema = z.object({
  /**
   * The command to run, **by id** — resolved server-side against the stored
   * profile.
   *
   * The body carries an id and never an argv. Accepting argv here would make the
   * typed command registry in `no-second-authority` advisory: a caller could send
   * any executable and the registry would still be consulted afterwards, only to
   * be overridden. An override is a *profile edit* (`automate.config.json` or
   * `PATCH /projects/{id}`), which is reviewable, versioned and explains itself.
   */
  commandId: z.string().min(1),
  /** Overrides the profile's timeout for this run only. */
  timeoutMs: z.number().int().min(1).optional(),
  /**
   * Idempotency key.
   *
   * A TUI double-tap of a key launches a command twice otherwise, and two runs of
   * the same suite against the same commit are two rows in the score and two
   * entries in the cost report.
   */
  idempotencyKey: z.string().min(1),
});
export type RunStartBody = z.infer<typeof RunStartBodySchema>;

/** The body of `POST /api/v1/runs/{runId}/stop`. */
export const RunStopBodySchema = z.object({
  /**
   * Why the run is being stopped, kept on the row.
   *
   * An interruption with no recorded reason is an interruption nobody can
   * distinguish from a crash, and the difference matters when someone asks why a
   * run stopped halfway.
   */
  reason: z.string().min(1).max(500),
});
export type RunStopBody = z.infer<typeof RunStopBodySchema>;
