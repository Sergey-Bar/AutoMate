import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The test-support boundary.
 *
 * `apps/api/src/infrastructure/synthetic-credentials.ts` was a test-only fixture
 * living in product source: imported by exactly one `*.test.ts` and by no
 * production code, yet measured by coverage as if it were product. That is the
 * same defect as excluding a test file — a denominator inflated with code whose
 * "coverage" says nothing about what ships.
 *
 * Moving it is the fix; this is what keeps the move meaningful. A `test-support/`
 * directory that production code may import is a second product package with
 * better branding, and nothing about the move alone would stop that.
 *
 * The check is a source scan rather than a coverage assertion, because a coverage
 * assertion only reports the problem after a run, and reports it as a number
 * nobody reads.
 */

/** Every `.ts`/`.tsx` file under a path, recursively. A missing path yields []. */
/**
 * @param {string} relativeRoot
 * @param {(name: string) => boolean} accept
 * @returns {string[]}
 */
function walk(relativeRoot, accept) {
  /** @type {string[]} */
  const found = [];
  const stack = [path.join(root, relativeRoot)];
  while (stack.length > 0) {
    const current = /** @type {string} */ (stack.pop());
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (accept(entry.name)) found.push(full);
    }
  }
  return found;
}

/** @param {string} name */
const isTypeScript = (name) => /\.(ts|tsx|mts|cts)$/.test(name);
/** @param {string} name */
const isTestFile = (name) => /\.(test|spec)\.[cm]?tsx?$/.test(name);

/**
 * Every product source file: TypeScript, and not itself a test.
 *
 * @param {string} relativeRoot
 * @returns {string[]}
 */
function productSourceFiles(relativeRoot) {
  return walk(relativeRoot, (name) => isTypeScript(name) && !isTestFile(name));
}

/**
 * The immediate subdirectory names of a workspace group.
 *
 * @param {string} group
 * @returns {string[]}
 */
function dirsIn(group) {
  try {
    return readdirSync(path.join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function isDirectory(relativePath) {
  try {
    return statSync(path.join(root, relativePath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every `src/test-support/` directory, relative to the repository root.
 *
 * @returns {string[]}
 */
function packagesWithTestSupport() {
  /** @type {string[]} */
  const found = [];
  for (const group of ['apps', 'packages', 'tools']) {
    for (const dir of dirsIn(group)) {
      const candidate = path.join(group, dir, 'src', 'test-support');
      if (isDirectory(candidate)) found.push(candidate);
    }
  }
  return found;
}

/**
 * `import`/`from` specifiers a file names.
 *
 * @param {string} source
 * @returns {string[]}
 */
function importSpecifiers(source) {
  return [...source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  );
}

/**
 * Every test file in a package, as one blob.
 *
 * Test files only, not product source: "reachable from a test" is the claim, and
 * a fixture's name also appearing in a product import would make an unused fixture
 * look used.
 *
 * @param {string} relativeRoot
 * @returns {string}
 */
function testFileSource(relativeRoot) {
  return walk(relativeRoot, isTestFile)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

/**
 * Test-support files under one workspace group that no test imports.
 *
 * @param {string} relativeRoot
 * @param {string[]} supportDirs
 * @returns {string[]}
 */
function unreferencedSupportFiles(relativeRoot, supportDirs) {
  const imported = testFileSource(relativeRoot);
  /** @type {string[]} */
  const unused = [];
  for (const supportDir of supportDirs) {
    if (!supportDir.startsWith(`${relativeRoot}/`)) continue;
    for (const entry of readdirSync(path.join(root, supportDir), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      if (imported.includes(entry.name.replace(/\.tsx?$/, ''))) continue;
      unused.push(path.join(supportDir, entry.name));
    }
  }
  return unused;
}

test('a test-support directory exists to be enforced', () => {
  const found = packagesWithTestSupport();
  assert.ok(
    found.length > 0,
    'no src/test-support/ directory found; the boundary check would pass on absence, ' +
      'which is how a fixture in product source came to be measured as product',
  );
});

test('no product source file imports from a test-support directory', () => {
  const supportDirs = packagesWithTestSupport();
  assert.ok(supportDirs.length > 0, 'no test-support directory to check');

  /** @type {string[]} */
  const offences = [];
  for (const relativeRoot of ['apps', 'packages', 'tools', 'scripts', 'e2e', 'tests']) {
    for (const file of productSourceFiles(relativeRoot)) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (!/(^|\/)test-support\//.test(specifier)) continue;
        offences.push(
          `${path.relative(root, file)} imports "${specifier}", which is test support, not product`,
        );
      }
    }
  }
  assert.deepEqual(offences, []);
});

test('a test-support file is reachable from at least one test', () => {
  // A fixture nobody imports is dead code that still costs a reader time, and an
  // exclusion nobody needs. The removal condition on the register row is "no
  // longer a fixture", and this is how that shows up before the row does.
  const supportDirs = packagesWithTestSupport();
  assert.deepEqual(
    ['apps', 'packages', 'tools'].flatMap((group) => unreferencedSupportFiles(group, supportDirs)),
    [],
  );
});
