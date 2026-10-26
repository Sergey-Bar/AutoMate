import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';

/**
 * Coverage reports read down to the line, for diff coverage.
 *
 * ## Why this is not `coverage.ts`
 *
 * `coverage.ts` answers "what fraction of this repository is covered", and for that a
 * per-file count is enough and cheaper to keep. "Are the lines this pull request added
 * covered" cannot be answered from counts: it needs to know *which* lines are executable
 * and which ran. So this module keeps the line numbers, for the four formats that record
 * them. `llvm-cov`'s summary and SimpleCov's per-file arrays are not here — the first has
 * no line numbers in the export the product ingests, and the second is a later row.
 *
 * ## Stricter than the summary adapters, on purpose
 *
 * A malformed record in a per-file count moves a percentage by a hair. A malformed record
 * here decides whether a specific changed line is reported as untested, and a reviewer
 * acts on that line, so a record that cannot be read refuses the report rather than being
 * skipped. The size limit and the error class are the health-report ones, so the upload
 * door treats a refused line report exactly like a refused summary.
 */

export const LINE_COVERAGE_FORMATS = [
  'lcov',
  'cobertura',
  'jacoco-xml',
  'go-coverprofile',
] as const;
export type LineCoverageFormat = (typeof LINE_COVERAGE_FORMATS)[number];

export interface LineCoverageFile {
  /** POSIX separators, no leading `./`. Absolute when the tool wrote it absolute. */
  path: string;
  /** Sorted, unique, 1-based. */
  executable: number[];
  /** Sorted, unique, and a subset of `executable`. */
  covered: number[];
}

export interface LineCoverageReport {
  files: LineCoverageFile[];
}

/** Executable and covered lines per path, merged as records arrive. */
class Accumulator {
  private readonly byPath = new Map<string, { executable: Set<number>; covered: Set<number> }>();

  /** Registers a file even when it has no executable lines, so an empty file is visible. */
  file(path: string): void {
    if (!this.byPath.has(path))
      this.byPath.set(path, { executable: new Set(), covered: new Set() });
  }

  line(path: string, line: number, hit: boolean): void {
    this.file(path);
    const entry = this.byPath.get(path) as { executable: Set<number>; covered: Set<number> };
    entry.executable.add(line);
    if (hit) entry.covered.add(line);
  }

  report(): LineCoverageReport {
    const sorted = (lines: Set<number>) => [...lines].sort((left, right) => left - right);
    return {
      files: [...this.byPath]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([path, entry]) => ({
          path,
          executable: sorted(entry.executable),
          covered: sorted(entry.covered),
        })),
    };
  }
}

function malformed(message: string): never {
  throw new HealthReportError('malformed', message);
}

/** Backslashes to slashes and no leading `./`; the one shape diff coverage matches against. */
function posix(path: string): string {
  let result = path.trim().replace(/\\/gu, '/');
  while (result.startsWith('./')) result = result.slice(2);
  return result;
}

function lineNumber(raw: string | undefined, what: string): number {
  if (raw === undefined || !/^\d+$/u.test(raw) || Number(raw) < 1) {
    malformed(`${what} has a line number that is not a positive integer: ${String(raw)}`);
  }
  return Number(raw);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    // The pattern admits only the five names in the table.
    return ENTITIES[name.toLowerCase()] as string;
  });
}

function attribute(attributes: string, name: string): string | undefined {
  const value = new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(attributes)?.[1];
  return value === undefined ? undefined : decodeXml(value);
}

/** Elements by name, with or without a body; a self-closing element has an empty body. */
function* elements(text: string, name: string): Generator<{ attributes: string; body: string }> {
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, 'gu');
  for (const match of text.matchAll(pattern)) {
    // Group 1 always participates (possibly empty); group 2 is absent for `<x/>`.
    yield { attributes: match[1] as string, body: match[2] ?? '' };
  }
}

// ─── lcov ────────────────────────────────────────────────────────────────────

/**
 * `SF:` opens a file and `DA:<line>,<hits>[,<checksum>]` records one line in it.
 *
 * The same `SF:` may appear more than once — lcov concatenates per-test sections — and the
 * sections are merged, a line covered if any section hit it.
 */
function lcov(text: string): LineCoverageReport {
  const result = new Accumulator();
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) current = lcovSourceFile(line, result);
    else if (line.startsWith('DA:')) lcovLine(line, current, result);
  }
  if (current === null) malformed('document is not an lcov report: no SF record');
  return result.report();
}

/** `SF:<path>`: opens (or reopens) a file and returns its path. */
function lcovSourceFile(line: string, result: Accumulator): string {
  const current = posix(line.slice(3));
  if (current === '') malformed('lcov SF record names no file');
  result.file(current);
  return current;
}

/** `DA:<line>,<hits>[,<checksum>]`, which must follow an `SF:` record. */
function lcovLine(line: string, current: string | null, result: Accumulator): void {
  if (current === null) malformed('lcov DA record before any SF record');
  const [number, hits] = line.slice(3).split(',');
  if (hits === undefined || !/^\d+$/u.test(hits.trim())) {
    malformed(`lcov DA record has no hit count: ${line}`);
  }
  result.line(current, lineNumber(number?.trim(), 'lcov DA record'), Number(hits) > 0);
}

// ─── cobertura ───────────────────────────────────────────────────────────────

/**
 * Every `<line number hits>` of every `<class filename>`.
 *
 * Cobertura repeats a method's lines under `<methods>` and again under the class's own
 * `<lines>`; reading both is harmless because the line sets are unions. A `<line>` with no
 * `hits` is skipped, as `coverage.ts` skips it — it states nothing about execution. The
 * `<sources>` root is not prepended: diff coverage matches by path suffix, and a CI
 * runner's absolute checkout path would only make the path less like the diff's.
 */
function cobertura(text: string): LineCoverageReport {
  if (!/<coverage\b/iu.test(text) || !/<packages\b/iu.test(text)) {
    malformed('document is not a cobertura report');
  }
  const result = new Accumulator();
  for (const { attributes, body } of elements(text, 'class')) {
    const filename = attribute(attributes, 'filename');
    if (filename === undefined) continue;
    const path = posix(filename);
    result.file(path);
    for (const line of elements(body, 'line')) {
      const hits = attribute(line.attributes, 'hits');
      if (hits === undefined) continue;
      const number = lineNumber(attribute(line.attributes, 'number'), 'cobertura <line>');
      result.line(path, number, Number(hits) > 0);
    }
  }
  return result.report();
}

// ─── jacoco ──────────────────────────────────────────────────────────────────

/**
 * `<sourcefile>` line records: `nr` is the line, `ci` the covered instructions on it.
 *
 * The line data lives under `<sourcefile>`, not `<class>` — `coverage.ts` reads the
 * class's LINE counter, which has no line numbers. The path is the package's VM name
 * (`com/example`) joined to the source file name, for the same reason `coverage.ts` gives:
 * neither alone is a repository path.
 */
function jacoco(text: string): LineCoverageReport {
  if (!/<report\b/iu.test(text)) malformed('document is not a JaCoCo report');
  const result = new Accumulator();
  for (const pack of elements(text, 'package')) {
    const directory = attribute(pack.attributes, 'name') ?? '';
    for (const source of elements(pack.body, 'sourcefile')) {
      jacocoSourceFile(directory, source, result);
    }
  }
  return result.report();
}

/** One `<sourcefile>`; one with no `name` is skipped, since it names no file. */
function jacocoSourceFile(
  directory: string,
  source: { attributes: string; body: string },
  result: Accumulator,
): void {
  const name = attribute(source.attributes, 'name');
  if (name === undefined) return;
  const path = posix(directory === '' ? name : `${directory}/${name}`);
  result.file(path);
  for (const line of elements(source.body, 'line')) {
    const number = lineNumber(attribute(line.attributes, 'nr'), 'JaCoCo <line>');
    result.line(path, number, Number(attribute(line.attributes, 'ci') ?? '0') > 0);
  }
}

// ─── go coverprofile ─────────────────────────────────────────────────────────

const GO_BLOCK = /^(.+):(\d+)\.\d+,(\d+)\.\d+\s+\d+\s+(\d+)$/u;

/**
 * `file:startLine.col,endLine.col statements count` blocks, each spanning its lines.
 *
 * Blocks share their boundary line — one block ends on the line the next begins — so a
 * line is covered when **any** block spanning it ran. Taking the last block's count
 * instead would report a line inside an executed `if` as uncovered because the `else`
 * that starts on it did not run. Paths stay as Go writes them, module-qualified; diff
 * coverage matches them by suffix.
 */
function goProfile(text: string): LineCoverageReport {
  const lines = text.split(/\r?\n/u).map((line) => line.trim());
  const body = lines.filter((line) => line !== '');
  if (!body[0]?.startsWith('mode:')) malformed('document is not a Go coverprofile: no mode line');
  const result = new Accumulator();
  for (const line of body.slice(1)) {
    const match = GO_BLOCK.exec(line);
    if (match === null) malformed(`Go coverprofile block cannot be read: ${line}`);
    const from = lineNumber(match[2], 'Go coverprofile block');
    const to = lineNumber(match[3], 'Go coverprofile block');
    if (to < from) malformed(`Go coverprofile block ends before it starts: ${line}`);
    const path = posix(match[1] as string);
    const hit = Number(match[4]) > 0;
    for (let number = from; number <= to; number += 1) result.line(path, number, hit);
  }
  return result.report();
}

const READERS: Readonly<Record<LineCoverageFormat, (text: string) => LineCoverageReport>> = {
  lcov,
  cobertura,
  'jacoco-xml': jacoco,
  'go-coverprofile': goProfile,
};

/**
 * Reads a coverage report into executable and covered line numbers per file.
 *
 * Refuses, with `HealthReportError`, a report over `MAX_HEALTH_REPORT_BYTES` before
 * decoding it, a format it does not read (`unsupported`), and any record it cannot read
 * (`malformed`) — see the module comment for why a bad record is not skipped.
 */
export function parseLineCoverage(
  format: LineCoverageFormat,
  input: Uint8Array,
): LineCoverageReport {
  const reader = READERS[format] as ((text: string) => LineCoverageReport) | undefined;
  if (reader === undefined) {
    throw new HealthReportError('unsupported', `No line coverage reader for ${String(format)}`);
  }
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `${format} report is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  return reader(new TextDecoder().decode(input));
}
