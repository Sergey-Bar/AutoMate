import { createHash } from 'node:crypto';
import type { CanonicalFinding, DimensionMetric } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { type Json, record, list, text } from './json-fields.js';

/**
 * A Stryker mutation-testing report (the `mutation-testing-report-schema` JSON that
 * StrykerJS, Stryker.NET and Stryker4s all write) as a Test-effectiveness score and the files
 * whose tests let mutants through.
 *
 * ## The score is the schema's own, not a variant of it
 *
 * The report schema's documentation ("Mutant states and metrics") defines, and this module
 * computes exactly:
 *
 * - detected = Killed + Timeout — a mutant that hangs the suite would fail CI, so it counts;
 * - undetected = Survived + NoCoverage — a mutant no test even ran is a survivor too;
 * - valid = detected + undetected — CompileError and RuntimeError mutants are invalid,
 *   Ignored ones were never tested, and Pending ones not yet, so none of them counts;
 * - **mutation score = detected / valid × 100**;
 * - covered score = detected / (detected + Survived) × 100, reported in the summary only.
 *
 * NoCoverage is in the denominator, deliberately: excluding it would let an untested file
 * raise the score by being untested. A report with no valid mutant produces **no metric** —
 * the dimension stays unmeasured, never 0 and never 100.
 *
 * ## Findings
 *
 * One low-severity `issue` per file with undetected mutants, at its first survivor, for the
 * {@link MAX_MUTATION_FINDINGS} files with the most. Low, because a surviving mutant is a
 * missing test rather than a defect; one per file rather than per mutant, because a file
 * with forty survivors is one piece of work and forty findings would bury every other
 * dimension. The fingerprint is the file alone, so the finding persists while the file has
 * survivors and is fixed when it has none, however the count moves.
 */
export const MUTATION_ADAPTER_VERSION = '1';

/** Files reported as findings; the rest are still counted in the score. */
export const MAX_MUTATION_FINDINGS = 50;

const RULE_ID = 'stryker/surviving-mutant';
const HELP_URI =
  'https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/';

export interface MutationSummary {
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  ignored: number;
  runtimeErrors: number;
  compileErrors: number;
  pending: number;
  total: number;
  mutationScore: number | null;
  coveredScore: number | null;
}

export interface MutationReport {
  metrics: DimensionMetric[];
  findings: CanonicalFinding[];
  summary: MutationSummary;
}

type Counter = Exclude<keyof MutationSummary, 'total' | 'mutationScore' | 'coveredScore'>;

const STATUS_COUNTER: Readonly<Record<string, Counter>> = {
  Killed: 'killed',
  Survived: 'survived',
  Timeout: 'timeout',
  NoCoverage: 'noCoverage',
  Ignored: 'ignored',
  RuntimeError: 'runtimeErrors',
  CompileError: 'compileErrors',
  Pending: 'pending',
};

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

interface Survivor {
  line: number | null;
  column: number;
  mutator: string;
  covered: boolean;
}

interface FileSurvivors {
  path: string;
  survivors: Survivor[];
}

/** Earliest line first; a survivor with no line goes last, in report order. */
function bySource(a: Survivor, b: Survivor): number {
  return (
    (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER) || a.column - b.column
  );
}

function relativePath(path: string, root: string | null): string {
  let normalised = path.replace(/\\/gu, '/');
  if (root !== null) {
    const prefix = root.replace(/\\/gu, '/').replace(/\/?$/u, '/');
    if (normalised.startsWith(prefix)) normalised = normalised.slice(prefix.length);
  }
  return normalised.replace(/^\.\//u, '').slice(0, 1000);
}

function plural(count: number): string {
  return count === 1 ? '1 surviving mutant' : `${String(count)} surviving mutants`;
}

function findingFor(file: FileSurvivors, tool: string): CanonicalFinding {
  // Never empty: a file is only listed once it has a survivor.
  const first = [...file.survivors].sort(bySource)[0];
  const uncovered = file.survivors.filter((survivor) => !survivor.covered).length;
  const where = first.line === null ? '' : ` at line ${String(first.line)}`;
  const coverage = uncovered === 0 ? '' : ` (${String(uncovered)} with no coverage)`;
  return {
    fingerprint: createHash('sha256')
      .update(`stryker\u0000${RULE_ID}\u0000${file.path}`)
      .digest('hex'),
    tool,
    ruleId: RULE_ID,
    kind: 'issue',
    severity: 'low',
    dimension: 'test-effectiveness',
    path: file.path,
    line: first.line,
    message: `${plural(file.survivors.length)}${coverage}; first: ${first.mutator}${where}`,
    helpUri: HELP_URI,
    fixAvailable: null,
  };
}

function scoreOf(
  summary: Omit<MutationSummary, 'mutationScore' | 'coveredScore'>,
): Pick<MutationSummary, 'mutationScore' | 'coveredScore'> {
  const detected = summary.killed + summary.timeout;
  const valid = detected + summary.survived + summary.noCoverage;
  const covered = detected + summary.survived;
  return {
    mutationScore: valid === 0 ? null : (detected / valid) * 100,
    coveredScore: covered === 0 ? null : (detected / covered) * 100,
  };
}

/**
 * @throws HealthReportError `too_large` over the byte cap; `malformed` when it is not JSON
 *   with a `files` object.
 */
export function parseStrykerReport(input: Uint8Array): MutationReport {
  const document = readDocument(input);
  const files = record(document?.['files']);
  if (files === null)
    throw new HealthReportError('malformed', 'mutation report has no files object');
  const framework = record(document?.['framework']);
  const tool = text(framework?.['name'])?.slice(0, 100) ?? 'stryker';
  const root = text(document?.['projectRoot']);

  const counts: Record<Counter, number> = {
    killed: 0,
    survived: 0,
    timeout: 0,
    noCoverage: 0,
    ignored: 0,
    runtimeErrors: 0,
    compileErrors: 0,
    pending: 0,
  };
  const withSurvivors: FileSurvivors[] = [];
  for (const [path, rawFile] of Object.entries(files)) {
    const survivors = tallyFile(rawFile, counts);
    if (survivors.length > 0) withSurvivors.push({ path: relativePath(path, root), survivors });
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const summary: MutationSummary = { ...counts, total, ...scoreOf({ ...counts, total }) };
  const metrics = scoreMetrics(summary, tool, text(framework?.['version']));

  const findings = withSurvivors
    // Code-unit order, so the cut at the cap is the same on every host.
    .sort(
      (a, b) =>
        b.survivors.length - a.survivors.length ||
        Number(a.path > b.path) - Number(a.path < b.path),
    )
    .slice(0, MAX_MUTATION_FINDINGS)
    .map((file) => findingFor(file, tool));
  return { metrics, findings, summary };
}

/** The decoded document, before its shape is checked. */
function readDocument(input: Uint8Array): Json | null {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `mutation report is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', 'mutation report is not valid JSON');
  }
  return record(parsed);
}

/**
 * Count one file's mutants into `counts` and return its survivors — survived and
 * no-coverage mutants. A mutant with an unknown status is not counted at all.
 */
function tallyFile(rawFile: unknown, counts: Record<Counter, number>): Survivor[] {
  const survivors: Survivor[] = [];
  for (const raw of list(record(rawFile)?.['mutants'])) {
    const mutant = record(raw);
    const counter = STATUS_COUNTER[text(mutant?.['status']) ?? ''];
    if (counter === undefined) continue;
    counts[counter] += 1;
    if (counter !== 'survived' && counter !== 'noCoverage') continue;
    const start = record(record(mutant?.['location'])?.['start']);
    survivors.push({
      line: positiveInteger(start?.['line']),
      column: positiveInteger(start?.['column']) ?? 0,
      mutator: text(mutant?.['mutatorName']) ?? 'a mutant',
      covered: counter === 'survived',
    });
  }
  return survivors;
}

/** The mutation-score metric, or none when no mutant was valid. */
function scoreMetrics(
  summary: MutationSummary,
  tool: string,
  version: string | null,
): DimensionMetric[] {
  if (summary.mutationScore === null) return [];
  const detected = summary.killed + summary.timeout;
  const valid = detected + summary.survived + summary.noCoverage;
  const ofCovered =
    summary.coveredScore === null ? '' : ` (${summary.coveredScore.toFixed(1)}% of covered)`;
  return [
    {
      dimension: 'test-effectiveness',
      metric: 'mutation-score',
      tool: { name: tool, version: version?.slice(0, 100) ?? null },
      score: summary.mutationScore,
      summary: `Mutation score ${summary.mutationScore.toFixed(1)}%: ${String(detected)} of ${String(
        valid,
      )} valid mutants detected${ofCovered}`,
    },
  ];
}
