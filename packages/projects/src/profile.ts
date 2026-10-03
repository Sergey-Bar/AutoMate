import { z } from 'zod';

import { SCORE_CATEGORIES, SCORE_SURFACES } from './vocabulary.js';

/**
 * The reusable list schemas, hoisted so `AutomateConfigSchema` can declare its
 * override fields as `optional()` **without** inheriting `.default([])`.
 *
 * Reusing `ProjectProfileSchema.shape.artifactGlobs` is the obvious one-liner and
 * it is wrong: the shape carries a default, so a config that says nothing about
 * artifact globs parses to `[]`, and the merge's `config.artifactGlobs ??
 * base.artifactGlobs` takes the empty array. Every override would therefore
 * silently wipe the detector's proposal — the override path in
 * `no-second-authority` would have worked by destroying the authority rather than
 * by correcting it.
 */
const ArtifactGlobList = z.array(
  z.object({
    glob: z.string().min(1),
    format: z.string().min(1),
    category: z.enum(SCORE_CATEGORIES),
  }),
);

const CoverageGlobList = z.array(z.object({ glob: z.string().min(1), format: z.string().min(1) }));

const ExcludedCellList = z.array(
  z.object({ category: z.enum(SCORE_CATEGORIES), surface: z.enum(SCORE_SURFACES) }),
);

const PyramidTarget = z.object({
  unit: z.number().min(0).max(1),
  integration: z.number().min(0).max(1),
  e2e: z.number().min(0).max(1),
});

const TargetSet = z.object({
  testsPerCell: z.record(z.string(), z.number().int().min(0)).default({}),
  /**
   * Bounded to 1 because it is a **fraction of surface covered**, and the depth
   * component divides by it. A target of 4 would produce a `min(1, covered / 4)`
   * that reads as a plausible score and means nothing.
   */
  coverageTarget: z.record(z.string(), z.number().min(0).max(1)).default({}),
  pyramid: PyramidTarget.optional(),
});

/**
 * The detected (or declared) shape of a project, as stored on `projects.profile`.
 *
 * This is the *proposal*. `AutomateConfig` below is the override, and where the
 * two disagree the override wins — see `mergeConfig`, which is the only place
 * that decision is made.
 */
export const ProjectProfileSchema = z.object({
  /** Which detector wrote this, so a profile is never read under the wrong rules. */
  detectorVersion: z.number().int().min(1),
  ecosystem: z.string().nullable(),
  language: z.string().nullable(),
  packageManager: z.string().nullable(),
  /** Commands the operator may run. Never a shell string — see `CommandCandidate`. */
  commands: z
    .array(
      z.object({
        id: z.string().min(1),
        argv: z.array(z.string().min(1)).min(1),
        category: z.enum(SCORE_CATEGORIES),
        confidence: z.number().min(0).max(1),
        evidence: z.string().min(1),
      }),
    )
    .default([]),
  /** Globs whose matches are ingested as test results, and what each match is evidence of. */
  artifactGlobs: ArtifactGlobList.default([]),
  /**
   * Globs whose matches are ingested as **coverage**, kept apart from
   * `artifactGlobs` because a coverage report is not a test result. Offering a
   * cobertura file to a result adapter parses a percentage as if it were a
   * suite, and the run then reports a passing test that does not exist.
   */
  coverageGlobs: CoverageGlobList.default([]),
  coverageFormats: z.array(z.string()).default([]),
  /** Per-cell `n/a` marks. Absent cells are scored; a marked cell is excluded. */
  excludedCells: ExcludedCellList.default([]),
  /** Targets the depth component divides by. The project config is the authority. */
  targets: TargetSet.default({ testsPerCell: {}, coverageTarget: {} }),
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

/**
 * `automate.config.json`, checked into the customer's repository.
 *
 * Every field is optional and every field **overrides** the detected proposal.
 * That direction is the whole point: an operator who corrects a guess is not
 * fighting the detector, and the run records which of the two actually ran so a
 * result can always be explained.
 *
 * ```json
 * {
 *   "$schema": "https://automate.dev/schema/automate.config.json",
 *   "version": 1,
 *   "commands": { "unit": ["pytest", "-q", "tests/unit"] },
 *   "artifactGlobs": [{ "glob": "reports/*.xml", "format": "junit-xml", "category": "unit" }],
 *   "excludedCells": [{ "category": "security", "surface": "frontend" }],
 *   "targets": { "coverageTarget": { "backend": 0.8 } },
 *   "env": ["CI_TOKEN"]
 * }
 * ```
 */
export const AutomateConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  /**
   * Declared commands, keyed by the category they serve.
   *
   * **Arrays of strings, never a command string.** An operator who needs shell
   * features composes them in the runner, not here; a config file that could
   * hold `npm run test && rm -rf /` would be the raw-shell passthrough D7 rules
   * out, with a file extension.
   *
   * `partialRecord`, not `record`: with an enum key, Zod's `record` demands
   * **every** category be declared, which would make a config that sets only the
   * unit command a parse error — and an operator's first override would be the
   * one that fails.
   */
  commands: z.partialRecord(z.enum(SCORE_CATEGORIES), z.array(z.string().min(1)).min(1)).optional(),
  // The hoisted schemas, not `ProjectProfileSchema.shape.*`: an absent key must
  // stay `undefined` so the merge falls through to the detected proposal.
  artifactGlobs: ArtifactGlobList.optional(),
  coverageGlobs: CoverageGlobList.optional(),
  coverageFormats: z.array(z.string().min(1)).min(1).optional(),
  excludedCells: ExcludedCellList.optional(),
  targets: TargetSet.optional(),
  /**
   * Environment variable names passed through to the child process.
   *
   * The runner's default allowlist is `PATH`, `HOME`, `CI` and nothing else, so
   * anything a customer's tests need beyond that is named here. The *values* live
   * in the install, never in the repository.
   */
  env: z.array(z.string().min(1)).default([]),
  /** Milliseconds before a run is declared `timed_out`. */
  timeoutMs: z.number().int().min(1).optional(),
});
export type AutomateConfig = z.infer<typeof AutomateConfigSchema>;

/** The filename the override is looked for under, at the repository root. */
export const AUTOMATE_CONFIG_FILENAME = 'automate.config.json';

/** A detected proposal plus whatever the operator declared, and which won. */
export interface ResolvedProfile {
  profile: ProjectProfile;
  /** `detected` when nothing was overridden, `override` when something was. */
  source: 'detected' | 'override';
  /** Config keys that overrode the proposal, for the provenance panel. */
  overriddenKeys: string[];
}
