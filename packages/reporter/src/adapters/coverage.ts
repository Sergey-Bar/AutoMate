import type { ScoreSurface } from '@automate/shared-contracts';

/**
 * Coverage formats, ingested as **coverage** — deliberately not as run results.
 *
 * ## Why these are not `ProducerAdapter`s
 *
 * A coverage document has no tests in it. Offering one to a result adapter parses
 * a percentage as if it were a suite, and the run then reports a passing test that
 * does not exist — the confusion `packages/projects` records when it splits
 * `artifactGlobs` from `coverageGlobs`. So this module has its own, smaller
 * interface, and the score reads it through its own port.
 *
 * ## The fraction is covered-over-total, never an average of ratios
 *
 * Averaging per-file fractions lets a two-line file outvote a four-hundred-line
 * one, which is how a coverage number goes **up** while nothing is covered. Every
 * adapter here returns the raw counts and this module does the one division.
 */

export const COVERAGE_FORMATS = [
  'lcov',
  'cobertura',
  'jacoco-xml',
  'go-coverprofile',
  'llvm-cov',
  'simplecov',
] as const;
export type CoverageFormat = (typeof COVERAGE_FORMATS)[number];

export interface CoverageFile {
  /** Repo-relative POSIX path. */
  path: string;
  coveredLines: number;
  totalLines: number;
}

export interface CoverageReport {
  format: CoverageFormat;
  files: readonly CoverageFile[];
  /**
   * Covered over total across **every** file, in `[0,1]`.
   *
   * `null` when there was nothing to measure — an empty report is an absent
   * measurement, and `0` would be a claim that nothing is covered.
   */
  coveredFraction: number | null;
}

export interface CoverageAdapter {
  readonly format: CoverageFormat;
  readonly mediaTypes: readonly string[];
  parse(input: Uint8Array): CoverageReport;
}

/** Covered over total, or `null` when nothing was measured. */
function fraction(covered: number, total: number): number | null {
  return total === 0 ? null : covered / total;
}

/** Keeps only files that have executable lines, so an empty file cannot dilute. */
function measurable(files: readonly CoverageFile[]): CoverageFile[] {
  return files.filter((file) => file.totalLines > 0);
}

function report(format: CoverageFormat, files: readonly CoverageFile[]): CoverageReport {
  const usable = measurable(files);
  const covered = usable.reduce((sum, file) => sum + file.coveredLines, 0);
  const total = usable.reduce((sum, file) => sum + file.totalLines, 0);
  return { format, files, coveredFraction: fraction(covered, total) };
}

// ─── lcov ────────────────────────────────────────────────────────────────────

/** Count one DA: record into its file. */
function tallyLcovLine(file: CoverageFile, record: string): void {
  const hit = lcovLineHit(record);
  if (hit === null) return;
  file.totalLines += 1;
  if (hit) file.coveredLines += 1;
}

/** For a `DA:<line>,<hits>` record, whether the line was hit; null when the record is malformed. */
function lcovLineHit(record: string): boolean | null {
  const [number, hits] = record.split(',');
  if (number === undefined || hits === undefined) return null;
  return Number(hits) > 0;
}
/**
 * `SF:`/`DA:`/`LF:`/`LH:` records, as Node, Python and coverlet all write them.
 *
 * The `DA:` lines are preferred over the declared `LF:`/`LH:` pair. Both describe
 * the same measurement and a generator writing a stale pair would otherwise decide
 * the number the dashboard shows; the `DA:` lines are the measurement itself.
 */
const LCOV_ADAPTER: CoverageAdapter = {
  format: 'lcov',
  mediaTypes: ['text/plain'],
  parse(input) {
    const text = new TextDecoder().decode(input);
    const files: CoverageFile[] = [];
    let current: CoverageFile | null = null;
    for (const raw of text.split(/\r?\n/u)) {
      const line = raw.trim();
      if (line.startsWith('SF:')) {
        if (current !== null) files.push(current);
        current = { path: line.slice(3).trim(), coveredLines: 0, totalLines: 0 };
        continue;
      }
      if (current !== null && line.startsWith('DA:')) tallyLcovLine(current, line.slice(3));
    }
    if (current !== null) files.push(current);
    return report('lcov', files);
  },
};

// ─── cobertura ───────────────────────────────────────────────────────────────

const COBERTURA_ADAPTER: CoverageAdapter = {
  format: 'cobertura',
  mediaTypes: ['application/xml'],
  parse(input) {
    const text = new TextDecoder().decode(input);
    if (!/<coverage\b/iu.test(text) || !/<packages\b/iu.test(text)) {
      throw new Error('document is not a cobertura report');
    }
    const files: CoverageFile[] = [];
    const classPattern = /<class\b([^>]*)>([\s\S]*?)<\/class>/giu;
    for (const match of text.matchAll(classPattern)) {
      const attributes = match[1] ?? '';
      const body = match[2] ?? '';
      const path = /filename="([^"]*)"/u.exec(attributes)?.[1];
      if (path === undefined) continue;
      let covered = 0;
      let total = 0;
      for (const line of body.matchAll(/<line\b[^>]*\bhits="(\d+)"[^>]*\/?>/giu)) {
        total += 1;
        if (Number(line[1]) > 0) covered += 1;
      }
      files.push({ path, coveredLines: covered, totalLines: total });
    }
    return report('cobertura', files);
  },
};

// ─── jacoco ──────────────────────────────────────────────────────────────────

/**
 * JaCoCo's XML, reading the `LINE` counter.
 *
 * JaCoCo emits one counter per kind — `INSTRUCTION`, `BRANCH`, `LINE`,
 * `COMPLEXITY`, `METHOD`, `CLASS`. Taking the first is the obvious mistake and
 * reports 10/10 covered for a class with four missed lines, because instruction
 * coverage and line coverage differ on any method with a branch.
 */
/**
 * A JaCoCo class's `LINE` counter element, or `''`. Each `<counter …>` is read once and its
 * type checked, rather than `/<counter\b[^>]*type="LINE"[^>]*\/?>/`, whose two unbounded
 * `[^>]*` around the type retry each other: one long element with many `type=` attributes
 * cost the square of its length.
 */
function lineCounterOf(body: string): string {
  let from = body.indexOf('<counter');
  while (from !== -1) {
    const end = body.indexOf('>', from);
    if (end === -1) return '';
    const element = body.slice(from, end + 1);
    if (/^<counter\b/u.test(element) && element.includes('type="LINE"')) return element;
    from = body.indexOf('<counter', end);
  }
  return '';
}

const JACOCO_ADAPTER: CoverageAdapter = {
  format: 'jacoco-xml',
  mediaTypes: ['application/xml'],
  parse(input) {
    const text = new TextDecoder().decode(input);
    if (!/<report\b/iu.test(text)) throw new Error('document is not a JaCoCo report');
    const files: CoverageFile[] = [];
    const classPattern = /<class\b([^>]*)>([\s\S]*?)<\/class>/giu;
    for (const match of text.matchAll(classPattern)) {
      const attributes = match[1] ?? '';
      const body = match[2] ?? '';
      const name = /name="([^"]*)"/u.exec(attributes)?.[1];
      if (name === undefined) continue;
      // JaCoCo records both the VM class name (`com/example/Service`) and the
      // compiler's `sourcefilename` (`Service.java`), and **neither alone is a
      // repository path**. Taking `sourcefilename` alone collapses every class in
      // a package to the same bare filename, so the paths cannot be joined back
      // to the tree and the coverage is unattributable. The class name carries the
      // directory; the extension does not, so it comes from the source file.
      const sourceFile = /sourcefilename="([^"]*)"/u.exec(attributes)?.[1];
      const path = sourceFile?.includes('/') ? sourceFile : `${name}.java`;
      const lineCounter = lineCounterOf(body);
      const missed = Number(/missed="(\d+)"/u.exec(lineCounter)?.[1] ?? Number.NaN);
      const covered = Number(/covered="(\d+)"/u.exec(lineCounter)?.[1] ?? Number.NaN);
      if (!Number.isFinite(missed) || !Number.isFinite(covered)) continue;
      files.push({ path, coveredLines: covered, totalLines: covered + missed });
    }
    return report('jacoco-xml', files);
  },
};

// ─── go coverprofile ─────────────────────────────────────────────────────────

/** `file:start,end numStatements count` blocks, as `go test -coverprofile` writes. */
const GO_ADAPTER: CoverageAdapter = {
  format: 'go-coverprofile',
  mediaTypes: ['text/plain'],
  parse(input) {
    const text = new TextDecoder().decode(input);
    const covered = new Map<string, { coveredLines: number; totalLines: number }>();
    for (const raw of text.split(/\r?\n/u)) {
      const line = raw.trim();
      if (line === '' || line.startsWith('mode:')) continue;
      const parts = line.split(/\s+/u);
      if (parts.length < 3) continue;
      const file = parts[0]?.split(':')[0];
      if (file === undefined) continue;
      const entry = covered.get(file) ?? { coveredLines: 0, totalLines: 0 };
      entry.totalLines += 1;
      if (Number(parts[2]) > 0) entry.coveredLines += 1;
      covered.set(file, entry);
    }
    return report(
      'go-coverprofile',
      [...covered].map(([path, value]) => ({ path, ...value })),
    );
  },
};

// ─── llvm-cov ────────────────────────────────────────────────────────────────

/**
 * `llvm-cov export`, whose `data[].files[]` carries one summary line per file.
 *
 * `count` is the number of regions and `covered` how many were hit, so the ratio
 * is *region* coverage rather than line coverage. It is reported as such rather
 * than relabelled: a Rust project comparing against a line-coverage target needs
 * to know which of the two it is looking at.
 */
const LLVM_ADAPTER: CoverageAdapter = {
  format: 'llvm-cov',
  mediaTypes: ['application/json'],
  parse(input) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(input));
    } catch {
      throw new Error('llvm-cov export is not valid JSON');
    }
    // An array is an `object` in JavaScript, and letting one through turns
    // "this is not a coverage document" into "nothing was measured" — a report
    // that reads as a clean absence rather than a wrong file.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('llvm-cov export is not an object');
    }
    const data = (parsed as { data?: unknown[] }).data ?? [];
    const files: CoverageFile[] = [];
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const summary =
        (
          entry as {
            files?: Array<{
              filename?: string;
              summary?: { lines?: { count?: number; covered?: number } };
            }>;
          }
        ).files ?? [];
      for (const file of summary) {
        const lines = file.summary?.lines;
        if (typeof file.filename !== 'string' || lines === undefined) continue;
        files.push({
          path: file.filename,
          coveredLines: lines.covered ?? 0,
          totalLines: lines.count ?? 0,
        });
      }
    }
    return report('llvm-cov', files);
  },
};

// ─── simplecov ───────────────────────────────────────────────────────────────

function parseSimplecovJson(input: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new Error('simplecov report is not valid JSON');
  }
}

/**
 * The `coverage` map of a SimpleCov document.
 *
 * An array is an `object` in JavaScript, and `{"coverage":[]}` would otherwise pass this check
 * and produce an empty report - "nothing was measured" for a document that is simply not a
 * SimpleCov file. The document itself is checked first: `null` is valid JSON and has no
 * `coverage` to read.
 */
function simplecovCoverageMap(parsed: unknown): Record<string, Array<number | null>> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('simplecov report declares no coverage map');
  }
  const coverage = (parsed as { coverage?: unknown }).coverage;
  if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) {
    throw new Error('simplecov report declares no coverage map');
  }
  return coverage as Record<string, Array<number | null>>;
}

/** A `null` line has no relevant coverage; every other line counts, and a hit is above zero. */
function countSimplecovLines(lines: ReadonlyArray<number | null>): {
  covered: number;
  total: number;
} {
  let covered = 0;
  let total = 0;
  for (const line of lines) {
    if (line === null || line === undefined) continue;
    total += 1;
    if (line > 0) covered += 1;
  }
  return { covered, total };
}
/**
 * SimpleCov's JSON, where every line is an element of a per-file array.
 *
 * A `null` is a line with no relevant coverage — an `end` keyword, a comment — and
 * **not** an uncovered line. Counting those as uncovered understates every Ruby
 * file, and Ruby files are mostly composed of them. A hit count above zero is
 * covered, whatever its size.
 */
const SIMPLECOV_ADAPTER: CoverageAdapter = {
  format: 'simplecov',
  mediaTypes: ['application/json'],
  parse(input) {
    const coverage = simplecovCoverageMap(parseSimplecovJson(input));
    const files: CoverageFile[] = [];
    for (const [absolute, lines] of Object.entries(coverage)) {
      if (!Array.isArray(lines)) continue;
      const { covered, total } = countSimplecovLines(lines);
      files.push({
        path: stripRepoPrefixIfPresent(absolute),
        coveredLines: covered,
        totalLines: total,
      });
    }
    return report('simplecov', files);
  },
};

/**
 * Turns an absolute path into a repo-relative one.
 *
 * SimpleCov reports whatever path the process was launched with, which on CI is
 * absolute and on a laptop is absolute too. The prefix is cut at the last
 * directory that looks like a repository root rather than by a configured root,
 * because the adapter has no configuration — and a path that could not be made
 * relative is kept as-is rather than discarded, because discarding it would
 * silently shrink the denominator.
 */
/** Exported for the edge suite: the prefix rule is a decision, so it is testable. */
export function stripRepoPrefixIfPresent(absolute: string): string {
  const segments = absolute.split(/[\\/]/u);
  const marker = Math.max(
    segments.lastIndexOf('src'),
    segments.lastIndexOf('lib'),
    segments.lastIndexOf('app'),
  );
  return marker > 0 ? segments.slice(marker).join('/') : absolute;
}

/**
 * The one registry. `parseCoverage` refuses a format it does not have, which is
 * what makes `packages/projects`' `COVERAGE_FORMATS` list a promise rather than
 * an aspiration.
 */
export const COVERAGE_ADAPTERS: Readonly<Record<CoverageFormat, CoverageAdapter>> = {
  lcov: LCOV_ADAPTER,
  cobertura: COBERTURA_ADAPTER,
  'jacoco-xml': JACOCO_ADAPTER,
  'go-coverprofile': GO_ADAPTER,
  'llvm-cov': LLVM_ADAPTER,
  simplecov: SIMPLECOV_ADAPTER,
};

export function parseCoverage(format: CoverageFormat, input: Uint8Array): CoverageReport {
  const adapter = COVERAGE_ADAPTERS[format];
  if (adapter === undefined) {
    throw new Error(`No coverage adapter for ${format}`);
  }
  return adapter.parse(input);
}

/**
 * Splits a report across the score's three surfaces.
 *
 * `classify` is **injected**, and that is the whole point of the signature: no
 * coverage format states whether a file is backend, frontend or platform, so an
 * adapter that assigned surfaces itself would be inventing a fact about the
 * customer's architecture. The repository — which has read the manifests and knows
 * where the API lives — makes that call.
 *
 * A surface with nothing classified into it is `null`, meaning *not measured*.
 * `0` would be a claim that the surface is measured and uncovered, and the score
 * treats those two differently.
 */
export function surfaceCoverage(
  report: CoverageReport,
  classify: (path: string) => ScoreSurface,
): Record<ScoreSurface, number | null> {
  const totals: Record<ScoreSurface, { covered: number; total: number }> = {
    backend: { covered: 0, total: 0 },
    frontend: { covered: 0, total: 0 },
    platform: { covered: 0, total: 0 },
  };
  for (const file of measurable(report.files)) {
    const surface = totals[classify(file.path)];
    if (surface === undefined) continue;
    surface.covered += file.coveredLines;
    surface.total += file.totalLines;
  }
  return {
    backend: fraction(totals.backend.covered, totals.backend.total),
    frontend: fraction(totals.frontend.covered, totals.frontend.total),
    platform: fraction(totals.platform.covered, totals.platform.total),
  };
}
