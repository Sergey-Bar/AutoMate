/**
 * Diff coverage: of the lines a change added, how many are executable, and how many ran.
 *
 * ## Why a separate number from coverage
 *
 * Repository coverage barely moves on any one pull request, so it cannot tell a reviewer
 * whether *this* change is tested: 400 untested new lines in a 200 000-line repository
 * move the total by a fifth of a point. Counting only the added lines makes the number
 * about the change, and listing the uncovered ones makes it something a reviewer can act
 * on.
 *
 * ## Only executable lines count, and nothing executable is not 100%
 *
 * A comment, a blank line or a type declaration is not executable, and a coverage tool
 * says so by leaving it out. Counting it as uncovered would penalise documentation;
 * counting it as covered would let a change made of comments report 100%. So the
 * denominator is changed lines the report calls executable, and when there are none the
 * ratio is `null` — an absent measurement, the same rule `coverage.ts` applies to an
 * empty report.
 */

export interface LineCoverageInput {
  files: readonly {
    path: string;
    executable: readonly number[];
    covered: readonly number[];
  }[];
}

export interface DiffCoverageOptions {
  /** A prefix stripped from both diff and coverage paths, e.g. a package directory. */
  sourceRoot?: string;
}

export interface DiffCoverageResult {
  covered: number;
  executable: number;
  /** `covered / executable`; `null` when no changed line is executable. */
  ratio: number | null;
  /** Changed executable lines that did not run, per file, sorted. */
  uncovered: { path: string; lines: number[] }[];
  /** Changed files the coverage report has no entry for at all, sorted. */
  unmeasuredFiles: string[];
}

/**
 * The one path shape both sides are compared in.
 *
 * Backslashes become slashes, repeated slashes collapse, leading `./` goes, then one git
 * `a/` or `b/` prefix, then `sourceRoot` when the path is inside it. Stripping `a/`/`b/`
 * unconditionally misreads a top-level directory literally named `a` or `b`; that is the
 * price of reading `--no-prefix` and prefixed diffs alike, and it is paid identically on
 * both sides, so the two still match.
 */
export function normaliseDiffPath(path: string, sourceRoot?: string): string {
  const clean = (value: string) => {
    let result = value
      .trim()
      .replace(/\\/gu, '/')
      .replace(/\/{2,}/gu, '/');
    while (result.startsWith('./')) result = result.slice(2);
    return result;
  };
  let result = clean(path).replace(/^[ab]\//u, '');
  if (sourceRoot !== undefined) {
    const root = clean(sourceRoot).replace(/\/+$/u, '');
    if (root !== '' && result.startsWith(`${root}/`)) result = result.slice(root.length + 1);
  }
  return result;
}

const COUNT = /^\d+$/u;

/** `start[,count]`, where an omitted count means one line. */
function range(text: string): { start: number; count: number } | null {
  const parts = text.split(',');
  const start = parts[0] as string;
  const count = parts[1] ?? '1';
  if (parts.length > 2 || !COUNT.test(start) || !COUNT.test(count)) return null;
  return { start: Number(start), count: Number(count) };
}

/**
 * `@@ -a[,b] +c[,d] @@ …`, read with string operations: the one-pattern version nests
 * quantifiers inside optional groups, the shape `security/detect-unsafe-regex` refuses.
 */
function readHunk(row: string): { oldCount: number; newStart: number; newCount: number } | null {
  if (!row.startsWith('@@ -')) return null;
  const close = row.indexOf(' @@', 4);
  if (close === -1) return null;
  const [old, added, extra] = row.slice(4, close).split(' ');
  if (added === undefined || extra !== undefined || !added.startsWith('+')) return null;
  const before = range(old as string);
  const after = range(added.slice(1));
  if (before === null || after === null) return null;
  return { oldCount: before.count, newStart: after.start, newCount: after.count };
}

/** The path of a `+++ ` header, or `null` for `/dev/null` (the file was deleted). */
function headerPath(rest: string): string | null {
  // `split` always yields at least one element.
  let path = (rest.split('\t')[0] as string).trim();
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  return path === '/dev/null' ? null : normaliseDiffPath(path);
}

/**
 * Added lines per file, by their line number in the **new** file.
 *
 * Hunk lines are read by counting, not by their first character alone: a hunk header
 * states how many old and new lines follow, and until both are used up every line is
 * hunk content. That is what keeps a removed SQL comment (`--- x`) or an added `++ i` from
 * being read as a file header, and what lets a context line whose single leading space an
 * editor stripped still be read as context. A line that is not valid hunk content ends
 * the hunk early rather than being guessed at.
 *
 * `diff --git` resets the current file, so a binary file, a pure rename or a mode change —
 * none of which has a `+++` header — contributes nothing, and a `GIT binary patch` body
 * is never mistaken for added text. A file appears in the map only once it has an added
 * line; a file whose change is only deletions has nothing to measure.
 */
export function parseUnifiedDiff(text: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>();
  const cursor: DiffCursor = { path: null, oldLeft: 0, newLeft: 0, line: 0 };
  for (const raw of text.split('\n')) {
    const row = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (cursor.oldLeft > 0 || cursor.newLeft > 0) {
      if (consumeHunkRow(cursor, row, added)) continue;
      cursor.oldLeft = 0;
      cursor.newLeft = 0;
    }
    readOutsideHunk(cursor, row);
  }
  return added;
}

/** Where `parseUnifiedDiff` is: the current file, and how much of the open hunk is left. */
interface DiffCursor {
  path: string | null;
  oldLeft: number;
  newLeft: number;
  /** The new-file line number the next added or context line has. */
  line: number;
}

/**
 * Read one row as hunk content. `false` when the row is not valid hunk content, which
 * ends the hunk early rather than being guessed at.
 */
function consumeHunkRow(cursor: DiffCursor, row: string, added: Map<string, Set<number>>): boolean {
  const marker = row === '' ? ' ' : row[0];
  switch (marker) {
    case '+':
      if (cursor.path !== null) recordAdded(added, cursor.path, cursor.line);
      cursor.line += 1;
      cursor.newLeft -= 1;
      return true;
    case '-':
      cursor.oldLeft -= 1;
      return true;
    case ' ':
      cursor.oldLeft -= 1;
      cursor.newLeft -= 1;
      cursor.line += 1;
      return true;
    case '\\':
      return true;
    default:
      return false;
  }
}

function recordAdded(added: Map<string, Set<number>>, path: string, line: number): void {
  const set = added.get(path) ?? new Set<number>();
  set.add(line);
  added.set(path, set);
}

/** A row outside a hunk: a file boundary, a `+++` header, or a hunk header. */
function readOutsideHunk(cursor: DiffCursor, row: string): void {
  if (row.startsWith('diff --git ')) {
    cursor.path = null;
    return;
  }
  if (row.startsWith('+++ ')) {
    cursor.path = headerPath(row.slice(4));
    return;
  }
  const hunk = readHunk(row);
  if (hunk !== null) {
    cursor.oldLeft = hunk.oldCount;
    cursor.line = hunk.newStart;
    cursor.newLeft = hunk.newCount;
  }
}

/**
 * Diff coverage of `changed` against a line coverage report.
 *
 * A coverage path matches a diff path when, after `normaliseDiffPath` on both, it is the
 * same path or ends with `/` and the diff path — coverage tools write absolute paths, or
 * module-qualified ones in Go, and the diff is repo-relative. An exact match is preferred;
 * when there is none, every suffix match is merged, because the same file measured by two
 * shards or two tools is one file and a line covered by either ran. A changed file no
 * coverage entry matches is listed in `unmeasuredFiles` and contributes nothing to either
 * count: it may be documentation or it may be a package nobody measured, and the caller
 * is in a better position to say which than a ratio is.
 */
export function diffCoverage(
  changed: ReadonlyMap<string, ReadonlySet<number>>,
  coverage: LineCoverageInput,
  options: DiffCoverageOptions = {},
): DiffCoverageResult {
  const root = options.sourceRoot;
  const files = coverage.files.map((file) => ({
    ...file,
    path: normaliseDiffPath(file.path, root),
  }));
  const wanted = wantedLines(changed, root);
  let covered = 0;
  let executable = 0;
  const uncovered: DiffCoverageResult['uncovered'] = [];
  const unmeasuredFiles: string[] = [];
  for (const [path, lines] of [...wanted].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const matches = matchingFiles(files, path);
    if (matches.length === 0) {
      unmeasuredFiles.push(path);
      continue;
    }
    const measured = measureFile(lines, matches);
    executable += measured.executable;
    covered += measured.covered;
    if (measured.missed.length > 0) {
      uncovered.push({ path, lines: measured.missed.sort((left, right) => left - right) });
    }
  }
  return {
    covered,
    executable,
    ratio: executable === 0 ? null : covered / executable,
    uncovered,
    unmeasuredFiles,
  };
}

/** The changed lines keyed by normalised path; two spellings of one path are merged. */
function wantedLines(
  changed: ReadonlyMap<string, ReadonlySet<number>>,
  root: string | undefined,
): Map<string, Set<number>> {
  const wanted = new Map<string, Set<number>>();
  for (const [path, lines] of changed) {
    const key = normaliseDiffPath(path, root);
    const set = wanted.get(key) ?? new Set<number>();
    for (const value of lines) set.add(value);
    wanted.set(key, set);
  }
  return wanted;
}

type CoverageFile = LineCoverageInput['files'][number];

/** The exact match when there is one, otherwise every suffix match. */
function matchingFiles(files: readonly CoverageFile[], path: string): CoverageFile[] {
  const exact = files.filter((file) => file.path === path);
  return exact.length > 0 ? exact : files.filter((file) => file.path.endsWith(`/${path}`));
}

/** One changed file against its merged coverage entries; non-executable lines count for nothing. */
function measureFile(
  lines: ReadonlySet<number>,
  matches: readonly CoverageFile[],
): { executable: number; covered: number; missed: number[] } {
  const runnable = new Set(matches.flatMap((file) => file.executable));
  const ran = new Set(matches.flatMap((file) => file.covered));
  let executable = 0;
  let covered = 0;
  const missed: number[] = [];
  for (const value of lines) {
    if (!runnable.has(value)) continue;
    executable += 1;
    if (ran.has(value)) covered += 1;
    else missed.push(value);
  }
  return { executable, covered, missed };
}
