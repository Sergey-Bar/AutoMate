import {
  AutomateConfigSchema,
  ProjectProfileSchema,
  type AutomateConfig,
  type ProjectProfile,
  type ResolvedProfile,
} from './profile.js';
import { SCORE_CATEGORIES, type ScoreCategory } from './vocabulary.js';
import type { DetectResult } from './detect/index.js';

/** One declared command, as the profile stores it. */
function declaredCommand(
  argv: readonly string[],
  category: ScoreCategory,
  confidence: number,
): ProjectProfile['commands'][number] {
  return {
    id: `declared.${category}`,
    argv: [...argv],
    category,
    // A declared command is an operator statement, so it outranks every detected
    // candidate; the ceiling is 1 because there is nothing more certain than
    // "the operator said this".
    confidence: Math.min(1, confidence + 0.15),
    evidence: `automate.config.json#commands.${category}`,
  };
}

/**
 * Turns a detection into a storable profile.
 *
 * Flattened across every candidate command: the profile is a *set* of runnable
 * commands keyed by category, not a ranked proposal, because what a run needs is
 * "the unit command", and the ranking belongs in the detection result the operator
 * approves. The `confidence` on each entry is what that approval was based on.
 */
export function profileFromDetection(detection: DetectResult): ProjectProfile {
  return ProjectProfileSchema.parse({
    detectorVersion: detection.detectorVersion,
    ecosystem: detection.recognised ? detection.ecosystem : null,
    language: detection.recognised ? detection.language : null,
    packageManager: detection.recognised ? detection.packageManager : null,
    commands: detection.recognised
      ? detection.candidateCommands.map((candidate) => ({
          id: candidate.id,
          argv: candidate.argv,
          category: candidate.category,
          confidence: candidate.confidence,
          evidence: candidate.evidence,
        }))
      : [],
    artifactGlobs: detection.recognised ? detection.artifactGlobs : [],
    coverageGlobs: detection.recognised ? detection.coverageGlobs : [],
    coverageFormats: detection.recognised ? detection.coverageFormats : [],
  });
}

/**
 * Folds a checked-in `automate.config.json` over a detected profile.
 *
 * **The override always wins.** Not "wins when it is more confident", and not
 * "wins when the detector is unsure" — always. The alternative is a detector that
 * can overrule the operator whenever it likes, which is the same second authority
 * `no-second-authority` exists to prevent, wearing a confidence score as
 * camouflage. `overriddenKeys` is returned so the UI can say *which* keys the
 * operator changed, which is the only thing that makes the number explainable.
 */
export function mergeConfig(base: ProjectProfile, raw: unknown): ResolvedProfile {
  const config: AutomateConfig = AutomateConfigSchema.parse(raw);
  const overriddenKeys = Object.keys(raw as Record<string, unknown>).filter(
    (key) => key !== '$schema' && key !== 'version',
  );
  return {
    profile: ProjectProfileSchema.parse({
      ...base,
      commands: mergeCommands(base.commands, config.commands),
      artifactGlobs: config.artifactGlobs ?? base.artifactGlobs,
      coverageGlobs: config.coverageGlobs ?? base.coverageGlobs,
      coverageFormats: config.coverageFormats ?? base.coverageFormats,
      excludedCells: config.excludedCells ?? base.excludedCells,
      targets: mergeTargets(base.targets, config.targets),
    }),
    source: overriddenKeys.length > 0 ? 'override' : 'detected',
    overriddenKeys,
  };
}

/**
 * A declared command replaces every detected candidate for its category.
 *
 * Replacing rather than appending is deliberate: if the operator wrote
 * `commands.unit`, then running the detected unit command as well would execute a
 * suite they said not to run. An append would make the config a *supplement*, and
 * a file that supplements a guess is a guess.
 */
function mergeCommands(
  detected: ProjectProfile['commands'],
  declared: AutomateConfig['commands'],
): ProjectProfile['commands'] {
  if (declared === undefined) return detected;
  const replaced = new Set<ScoreCategory>(Object.keys(declared) as ScoreCategory[]);
  const kept = detected.filter((command) => !replaced.has(command.category));
  const added = SCORE_CATEGORIES.filter((category) => declared[category] !== undefined).map(
    (category) => declaredCommand(declared[category] as string[], category, 0.85),
  );
  return [...kept, ...added];
}

/** Merged field by field, so a config setting one target loses none of the others. */
function mergeTargets(
  base: ProjectProfile['targets'],
  declared: AutomateConfig['targets'],
): ProjectProfile['targets'] {
  if (declared === undefined) return base;
  const pyramid = declared.pyramid ?? base.pyramid;
  return {
    testsPerCell: { ...base.testsPerCell, ...(declared.testsPerCell ?? {}) },
    coverageTarget: { ...base.coverageTarget, ...(declared.coverageTarget ?? {}) },
    // Written only when there is a pyramid target to write. A literal
    // `pyramid: undefined` adds a key the detected profile never had, so a
    // no-op merge would not be `deepEqual` to the profile it came from — and
    // "the override changed nothing" is exactly the state that must compare equal.
    ...(pyramid === undefined ? {} : { pyramid }),
  };
}
