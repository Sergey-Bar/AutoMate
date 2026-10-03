import { dedupeByKey, type EcosystemDetector } from './detector.js';
import { detectDotnet } from './ecosystems/dotnet.js';
import { detectGo } from './ecosystems/go.js';
import { detectJava } from './ecosystems/java.js';
import { detectNode } from './ecosystems/node.js';
import { detectPhp } from './ecosystems/php.js';
import { detectPython } from './ecosystems/python.js';
import { detectRuby } from './ecosystems/ruby.js';
import { detectRust } from './ecosystems/rust.js';
import type { RepositoryView } from './repository-view.js';
import { EcosystemDetectionSchema } from './types.js';
import type { EcosystemDetection } from './types.js';

/**
 * The v1 matrix, in a fixed order.
 *
 * The order is the tie-break. Two ecosystems can both match a repository — a
 * `package.json` beside a `go.mod` is a monorepo root, not a contradiction — and
 * `detectProject` has to return the same answer every time or a stored profile
 * stops being comparable. `go` before `node` because a Go repository that vendors
 * a `package.json` for its frontend tooling is still primarily Go, and `java`
 * before `dotnet` because a `.csproj` under a `pom.xml`'s reactor is far rarer
 * than the reverse.
 */
const DETECTORS: readonly EcosystemDetector[] = [
  detectGo,
  detectRust,
  detectJava,
  detectDotnet,
  detectNode,
  detectPython,
  detectRuby,
  detectPhp,
];

/**
 * The detector's own version, stamped on every profile it writes.
 *
 * A profile written by version 1 must never be read as version 2's shape. That is
 * why `projects.detector_version` is a `NOT NULL` column rather than a comment,
 * and why this constant exists rather than a literal `1` at each of its uses.
 */
export const DETECTOR_VERSION = 1;

/**
 * What detection concluded, including the case where it concluded nothing.
 *
 * `recognised: false` is a first-class result rather than an error, because a
 * repository no detector recognises is a state the operator has to be able to
 * act on — by registering it with a declared command and saying so. An
 * exception would surface as a 500 from `project.add`, which tells the operator
 * nothing about which of those two things happened.
 */
export type DetectResult =
  | ({ recognised: true } & EcosystemDetection & { detectorVersion: number })
  | {
      recognised: false;
      ecosystem: null;
      language: null;
      packageManager: null;
      frameworks: [];
      candidateCommands: [];
      artifactGlobs: [];
      coverageGlobs: [];
      coverageFormats: [];
      confidence: 0;
      detectorVersion: number;
    };

/**
 * Reads a repository and proposes a profile for it.
 *
 * **A proposal, never the authority.** The result is what a UI shows as
 * "detected: `pnpm test` — use this / override", and a checked-in
 * `automate.config.json` supersedes it. Detection never installs anything and
 * never executes anything (D8): the strongest thing it does is read a manifest.
 */
export async function detectProject(view: RepositoryView): Promise<DetectResult> {
  const paths = await view.paths();
  const input = { paths, read: (relativePath: string) => view.read(relativePath) };

  for (const detector of DETECTORS) {
    const detection = await detector(input);
    if (detection === null) continue;
    return { ...normalise(detection), recognised: true, detectorVersion: DETECTOR_VERSION };
  }
  return unrecognised();
}

/**
 * Folds duplicates out of every list and re-asserts the shape.
 *
 * The Zod parse is not ceremony: it is what makes a detector that returns a
 * malformed confidence a **test failure** rather than a profile that reaches a
 * database and then a dashboard.
 */
function normalise(detection: EcosystemDetection): EcosystemDetection {
  return EcosystemDetectionSchema.parse({
    ...detection,
    frameworks: dedupeByKey(detection.frameworks, (framework) => framework.evidence),
    candidateCommands: dedupeByKey(detection.candidateCommands, (command) => command.id).sort(
      (left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id),
    ),
    artifactGlobs: dedupeByKey(detection.artifactGlobs, (glob) => glob.glob),
  });
}

function unrecognised(): DetectResult {
  return {
    recognised: false,
    ecosystem: null,
    language: null,
    packageManager: null,
    frameworks: [],
    candidateCommands: [],
    artifactGlobs: [],
    coverageGlobs: [],
    coverageFormats: [],
    confidence: 0,
    detectorVersion: DETECTOR_VERSION,
  };
}
