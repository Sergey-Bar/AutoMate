import { z } from 'zod';

import { SCORE_CATEGORIES, SCORE_SURFACES } from '../vocabulary.js';

/** The eight ecosystems the v1 detector reads. Narrowing this is a plan change, not a flag. */
export const ECOSYSTEMS = [
  'node',
  'python',
  'java',
  'dotnet',
  'go',
  'ruby',
  'rust',
  'php',
] as const;
export const EcosystemSchema = z.enum(ECOSYSTEMS);
export type Ecosystem = z.infer<typeof EcosystemSchema>;

/**
 * A coverage report shape we have an adapter for.
 *
 * The list is the adapter registry in one place. A format here with no adapter
 * in `packages/reporter` is a detector promising something ingest cannot keep,
 * which is why the ingest wave adds the adapter before the format is proposed.
 */
export const COVERAGE_FORMATS = [
  'lcov',
  'cobertura',
  'istanbul-json',
  'clover',
  'jacoco-xml',
  'llvm-cov',
  'go-coverprofile',
  'simplecov',
] as const;
export const CoverageFormatSchema = z.enum(COVERAGE_FORMATS);
export type CoverageFormat = z.infer<typeof CoverageFormatSchema>;

/**
 * A test-result report shape we have an adapter for.
 *
 * `junit-xml` is deliberately one entry rather than six. Six ecosystems write
 * divergent XML that all parse under one adapter and one `unsupported` path —
 * dialect fixtures against the existing parser, not six new adapters (R4).
 */
export const RESULT_FORMATS = ['junit-xml', 'k6-json', 'zap-xml'] as const;
export const ResultFormatSchema = z.enum(RESULT_FORMATS);
export type ResultFormat = z.infer<typeof ResultFormatSchema>;

/** A file the run may produce, as a glob the workspace walk evaluates. */
export const ArtifactGlobSchema = z.object({
  /** Glob, repo-relative. POSIX separators, `**` for any depth. */
  glob: z.string().min(1),
  format: ResultFormatSchema,
  /** What the artifact is evidence *of* — which score row it feeds. */
  category: z.enum(SCORE_CATEGORIES),
});
export type ArtifactGlob = z.infer<typeof ArtifactGlobSchema>;

/**
 * A coverage file, as a glob.
 *
 * **Separate from `artifactGlobs` because a coverage file is not a result.**
 * `canonical_run_results` holds per-test outcomes and nothing else, so a
 * cobertura report offered to a `ProducerAdapter` as a result artifact is either
 * dropped or — worse — parsed as a suite with no tests in it. The two lists were
 * one list at first, and the Zod parse in `detectProject` is what caught it.
 */
export const CoverageGlobSchema = z.object({
  glob: z.string().min(1),
  format: CoverageFormatSchema,
});
export type CoverageGlob = z.infer<typeof CoverageGlobSchema>;

/**
 * One runnable command, already split into argv.
 *
 * **There is deliberately no `command: string`.** Plan decision D7: a terminal
 * that runs arbitrary strings inside a multi-repo install is an RCE surface for
 * whoever holds it. An argv array cannot be handed to a shell, so the shape of
 * the data makes the dangerous operation unavailable rather than merely
 * discouraged. It also means no caller has to re-implement shell quoting, which
 * is the second parser this would otherwise need.
 */
export const CommandCandidateSchema = z.object({
  /** Stable within a `detectorVersion`, so a UI can key on it. */
  id: z.string().min(1),
  argv: z.array(z.string().min(1)).min(1),
  /** Human-facing, and the only field a screen is allowed to render. */
  label: z.string().min(1),
  category: z.enum(SCORE_CATEGORIES),
  /**
   * The manifest line that produced this candidate, as `path:lineText`.
   *
   * Required, because R3 is that 8-ecosystem detection is read-and-guess. A
   * candidate with no evidence is a guess, and a guess the operator cannot
   * check is the thing that wastes their time.
   */
  evidence: z.string().min(1),
  /** 0–1. Rendered beside the candidate; never a gate. */
  confidence: z.number().min(0).max(1),
});
export type CommandCandidate = z.infer<typeof CommandCandidateSchema>;

/** One recognised test framework, and where the manifest said so. */
export const FrameworkSignalSchema = z.object({
  name: z.string().min(1),
  category: z.enum(SCORE_CATEGORIES),
  evidence: z.string().min(1),
});
export type FrameworkSignal = z.infer<typeof FrameworkSignalSchema>;

/** What one ecosystem detector concluded about a repository. */
export const EcosystemDetectionSchema = z.object({
  ecosystem: EcosystemSchema,
  /** A human language name for display; the matrix never groups by it. */
  language: z.string().min(1),
  packageManager: z.string().min(1).nullable(),
  frameworks: z.array(FrameworkSignalSchema),
  candidateCommands: z.array(CommandCandidateSchema),
  artifactGlobs: z.array(ArtifactGlobSchema),
  /**
   * Coverage files, **required** rather than defaulted to `[]`.
   *
   * `artifactGlobs` is required for the same reason. A detector that omits the
   * list is making a claim — "this ecosystem writes no coverage file I can name" —
   * and that claim is worth having to write out. A default of `[]` would make
   * omission indistinguishable from a detector nobody finished.
   */
  coverageGlobs: z.array(CoverageGlobSchema),
  coverageFormats: z.array(CoverageFormatSchema),
  /** 0–1. How sure the detector is that this is even the right ecosystem. */
  confidence: z.number().min(0).max(1),
});
export type EcosystemDetection = z.infer<typeof EcosystemDetectionSchema>;

/**
 * What `detect()` returns when it read a repository and nothing recognised it.
 *
 * `ecosystem: null` rather than a guess. A wrong ecosystem is worse than an
 * absent one, because an absent one prompts the operator to pick and a wrong one
 * prompts them to accept.
 */
export const UNRECOGNISED: Omit<EcosystemDetection, 'ecosystem' | 'language' | 'confidence'> = {
  packageManager: null,
  frameworks: [],
  candidateCommands: [],
  artifactGlobs: [],
  coverageGlobs: [],
  coverageFormats: [],
};

export const SurfaceSchema = z.enum(SCORE_SURFACES);
export type Surface = z.infer<typeof SurfaceSchema>;
