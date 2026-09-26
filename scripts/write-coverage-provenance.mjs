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
  /** @type {Array<{ path: string, hash: string }>} */
  const files = [];
  const stack = [path.join(root, 'src')];
  while (stack.length > 0) {
    const current = /** @type {string} */ (stack.pop());
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (FRESHNESS_IGNORED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push({
        path: path.relative(root, full).replaceAll('\\', '/'),
        hash: hashContent(readFileSync(full)),
      });
    }
  }
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
