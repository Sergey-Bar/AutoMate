/**
 * Records which code produced the coverage summary sitting in `./coverage`.
 *
 * `coverage-summary.json` says what the numbers are. It cannot say whether they
 * describe the code currently on disk, because it is a gitignored artifact and
 * nothing in it points at an input. A package can be rewritten, stripped of a
 * module, or deleted outright and the ratchet will still read the old numbers
 * and report a pass. This writes the missing half: a content hash of every input,
 * beside the summary.
 *
 * It runs as the second half of a package's `test` script rather than as a
 * Vitest reporter, for two reasons. Vitest 4's `coverage.reporter` only accepts
 * tuples of istanbul reporters — a custom reporter is not a supported entry, and
 * both a path string and a reporter instance fail inside the provider. And
 * running after the tests is the honest order anyway: a run that failed produced
 * no evidence, so it leaves no stamp, and `&&` stops the stamp from being written.
 *
 * Because it is part of the same `test` task, the stamp travels with Turborepo's
 * cache exactly as the summary does. A cache hit is only served when the task's
 * inputs are unchanged, so a restored stamp describes those inputs by
 * construction.
 *
 * Run from a package root, which is what `pnpm --filter <pkg> test` does.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FRESHNESS_IGNORED_DIRECTORIES,
  hashContent,
  hashInputs,
  PROVENANCE_FILENAME,
} from './lib/coverage-freshness.mjs';

/** Extensions that can hold source a coverage run instruments. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);

/**
 * Every input file under `root/src`, as `{ path, hash }` with a `/`-separated
 * path relative to the package root.
 *
 * Test files are included even though they are excluded from the report: a
 * deleted test changes the numbers without changing a measured file, and that is
 * exactly the regression the ratchet has to notice.
 *
 * @param {string} root package root
 * @returns {Array<{ path: string, hash: string }>}
 */
export function collectCoverageInputs(root) {
  const files = [...sourceFilesUnder(path.join(root, 'src'))].map((full) => ({
    path: relativeTo(root, full),
    hash: hashContent(readFileSync(full)),
  }));
  // The Vitest config decides what is measured, so a change to it invalidates the
  // summary as surely as a change to a measured file.
  for (const name of ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js']) {
    const configPath = path.join(root, name);
    if (!existsSync(configPath)) continue;
    files.push({ path: name, hash: hashContent(readFileSync(configPath)) });
  }
  return files;
}

/**
 * Every file beneath `dir` that a coverage run could instrument.
 *
 * A generator rather than a loop inside the collector, because the walk and the
 * hashing are different jobs and folding them together is what pushed this module
 * over the complexity ceiling. A symlink to a directory is not a directory as far
 * as `readdirSync` with `withFileTypes` is concerned, so this cannot loop on one.
 *
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* sourceFilesUnder(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (FRESHNESS_IGNORED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFilesUnder(full);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

/**
 * A path relative to the package root, always with `/` separators.
 *
 * Windows would otherwise record `src\index.ts` in the stamp and `src/index.ts`
 * after a checkout on Linux, so the same tree would hash differently on two
 * machines and every ratchet run would report a spurious change.
 *
 * @param {string} root
 * @param {string} full
 * @returns {string}
 */
function relativeTo(root, full) {
  return path.relative(root, full).replaceAll('\\', '/');
}

/**
 * @param {string} root
 * @returns {{ root: string, files: Array<{ path: string, hash: string }>, hash: string } | null}
 */
export function writeCoverageProvenance(root) {
  const coverageDir = path.join(root, 'coverage');
  if (!existsSync(coverageDir)) return null;
  const files = collectCoverageInputs(root);
  const stamp = {
    root,
    files: files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    hash: hashInputs(files),
  };
  writeFileSync(
    path.join(coverageDir, PROVENANCE_FILENAME),
    `${JSON.stringify(stamp, null, 2)}\n`,
    'utf8',
  );
  return stamp;
}

// Only act when invoked as the script, so importing this from the ratchet is safe.
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const stamp = writeCoverageProvenance(process.cwd());
  if (stamp === null) {
    // A package with no `coverage/` produced no summary, so there is nothing to
    // attribute. Not an error: `tests/contract` legitimately measures nothing.
    process.stderr.write(
      'No coverage/ directory, so no provenance stamp was written. The coverage ' +
        'summary is unattributable and the ratchet will say so.\n',
    );
  }
}
