import { basename, extname } from 'node:path';
import type { ReportFormatId } from '@automate/shared-contracts';

/**
 * How the runner names one artifact, in **one** place.
 *
 * This was two functions with the same name in this package — `execution.ts` and
 * `generic-spawn.ts` — and they had drifted: the generic path labelled a JUnit file
 * `junit` while the contract, the upload door and `packages/projects` all call that
 * format `junit-xml`, so an artifact the runner named one way reached a door that
 * answered about a different file. `execution.ts` also read its own label back
 * (`artifacts.find((artifact) => artifact.kind === 'playwright-json')`), so renaming a
 * label meant finding three call sites in one file.
 *
 * **What comes from the contract and what stays here.** The format *ids* are the
 * contract's, typed as `ReportFormatId` so a typo is a compile error rather than a label
 * nothing recognises. The filename *heuristics* are this package's: which bytes a
 * producer writes to which name is a fact about the runner's workspace, not a vocabulary.
 * The non-report labels — `screenshot`, `trace`, `event-log`, `stdout`, `stderr`,
 * `html-report`, `coverage`, `evidence` — are deliberately **not** in the contract: nothing
 * ingests them, and a vocabulary of test reports that also carries a screenshot label is a
 * vocabulary with two meanings.
 */

/**
 * Filename marker, extension, and the report format that writes it.
 *
 * The marker is matched as a substring of the lower-cased basename, because every producer
 * names its output after itself and none of them names it the same way: `junit.xml`,
 * `junit-1.xml`, `playwright-report.json`, `k6-summary.json`, `zap-report.xml`. An
 * equality test would recognise two of those five and mislabel the other three as generic
 * evidence — which is the failure this table exists to remove.
 */
const REPORT_FILES: ReadonlyArray<
  readonly [marker: string, extension: string, id: ReportFormatId]
> = [
  ['junit', '.xml', 'junit-xml'],
  ['playwright-report', '.json', 'playwright-json'],
  ['k6', '.json', 'k6-json'],
  ['zap', '.xml', 'zap-xml'],
];

/** Extension-to-label for the artifacts that are not report documents. */
const OTHER_KINDS: ReadonlyArray<readonly [extension: string, kind: string]> = [
  ['.png', 'screenshot'],
  ['.webm', 'video'],
  ['.zip', 'trace'],
  ['.ndjson', 'event-log'],
  ['.html', 'html-report'],
];

/** Filename markers for a coverage report, which is parsed by a different adapter. */
const COVERAGE_MARKERS = ['coverage', 'lcov', 'cobertura'] as const;

/**
 * The `kind` of one artifact.
 *
 * Order matters twice: a report is recognised before its extension, because
 * `junit.xml` is a report and `.xml` has no label of its own; and `stdout.log` /
 * `stderr.log` are checked after the report markers because they are names, not shapes.
 *
 * @param path absolute or relative; only the basename is read
 */
export function artifactKind(path: string): string {
  const name = basename(path).toLowerCase();
  const extension = extname(name);
  for (const [marker, suffix, id] of REPORT_FILES) {
    if (extension === suffix && name.includes(marker)) return id;
  }
  for (const [suffix, kind] of OTHER_KINDS) {
    if (extension === suffix) return kind;
  }
  if (name === 'stdout.log') return 'stdout';
  if (name === 'stderr.log') return 'stderr';
  if (COVERAGE_MARKERS.some((marker) => name.includes(marker))) return 'coverage';
  return 'evidence';
}
