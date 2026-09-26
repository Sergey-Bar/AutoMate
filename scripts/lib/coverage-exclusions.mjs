/**
 * The coverage exclusions register, and the check that keeps it true.
 *
 * A Vitest `coverage.exclude` entry is a claim that some code does not need
 * testing. `apps/api` carried four such claims that appeared nowhere except as
 * bare strings inside a config, one of them the largest file in the repository —
 * so a reader of the coverage report could not tell which paths were unmeasured
 * on purpose and which were unmeasured because nobody wrote a test.
 *
 * This module compares two sources of truth and fails when they disagree:
 *
 *   - the configs: every `exclude` glob in a package's `coverage` object that is
 *     not part of the shared policy in `vitest.shared.ts`;
 *   - the register: `docs/quality/coverage-exclusions.md`.
 *
 * Both directions matter. A new exclusion with no row is an unrecorded claim; a
 * row for a glob nobody excludes is a justification for a decision that was
 * reverted, and it is how a register rots into a list of good intentions.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const REGISTER_PATH = path.join(root, 'docs', 'quality', 'coverage-exclusions.md');
const SHARED_CONFIG_PATH = path.join(root, 'vitest.shared.ts');

const WORKSPACE_ROOTS = ['apps', 'packages', 'tools', 'tests'];
const SKIPPED_DIRECTORIES = new Set(['.turbo', 'coverage', 'dist', 'node_modules']);

/**
 * @param {string} relativeRoot
 * @returns {string[]} workspace-relative directory paths holding a vitest config
 */
function listPackageDirectories(relativeRoot) {
  const base = path.join(root, relativeRoot);
  if (!existsSync(base)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    const relative = path.relative(root, full).replaceAll('\\', '/');
    if (existsSync(path.join(full, 'vitest.config.ts'))) found.push(relative);
    else found.push(...listPackageDirectories(relative));
  }
  return found.sort();
}

/**
 * The body of the first `coverage: { ... }` object, found by matching braces.
 *
 * Extracting the `coverage` object before looking for `exclude` is what keeps
 * `test.exclude` — which controls test *discovery* and is a different setting
 * with a similar name — out of the results. Reading every `exclude: [...]` in the
 * file reported `['node_modules', 'dist']` from the discovery list as coverage
 * exclusions, which would have demanded a register row for two globs that are not
 * exclusions of anything.
 *
 * @param {string} source
 * @returns {string | null}
 */
export function extractCoverageObject(source) {
  const start = source.indexOf('coverage:');
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

/**
 * Globs the `coverage` object excludes.
 *
 * @param {string} source a whole `vitest.config.ts`
 * @returns {string[]}
 */
export function extractCoverageExclusions(source) {
  const coverageObject = extractCoverageObject(source);
  if (coverageObject === null) return [];
  /** @type {string[]} */
  const found = [];
  for (const block of coverageObject.matchAll(/exclude:\s*\[([^\]]*)\]/g)) {
    for (const match of block[1].matchAll(/'([^']+)'/g)) {
      found.push(/** @type {string} */ (match[1]));
    }
  }
  return [...new Set(found)];
}

/**
 * Package and glob pairs the register documents, read from the per-package table
 * in `docs/quality/coverage-exclusions.md`.
 *
 * The table is located by its header rather than by a row pattern, because a row
 * pattern silently skips any row that does not match — which is precisely how a
 * typo in a justification would end up documenting nothing. A row inside the
 * table that does not parse is returned as a finding instead.
 *
 * @param {string} markdown
 * @returns {{ rows: Array<{ package: string, glob: string }>, unparsed: string[] }}
 */
export function parseRegister(markdown) {
  /** @type {Array<{ package: string, glob: string }>} */
  const rows = [];
  /** @type {string[]} */
  const unparsed = [];
  let inTable = false;
  for (const line of markdown.split('\n')) {
    if (/^\|\s*Package\s*\|\s*Excluded glob\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    // A non-table, non-blank line ends the table: the next heading, or the prose
    // that separates it from the rejected-exclusions table.
    if (inTable && !line.startsWith('|') && line.trim() !== '') inTable = false;
    if (!inTable) continue;
    if (/^\|\s*-{2,}/.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const packageCell = cells[0] ?? '';
    const globCell = cells[1] ?? '';
    if (!/^`[\w@/.-]+`$/.test(packageCell) || !/^`[^`]+`$/.test(globCell)) {
      unparsed.push(line.trim());
      continue;
    }
    rows.push({ package: packageCell.slice(1, -1), glob: globCell.slice(1, -1) });
  }
  return { rows, unparsed };
}

/** The globs `vitest.shared.ts` applies to every package. */
function sharedPolicyGlobs() {
  const source = readFileSync(SHARED_CONFIG_PATH, 'utf8');
  const block = source.match(/exclude:\s*\[([\s\S]*?)\n {4}\],/);
  if (block === null) {
    throw new Error('vitest.shared.ts no longer declares a coverage exclude list');
  }
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => /** @type {string} */ (m[1])));
}

/** @returns {string[]} findings; empty means the register and the configs agree */
export function findRegisterDisagreements() {
  const shared = sharedPolicyGlobs();
  const markdown = readFileSync(REGISTER_PATH, 'utf8');
  const { rows, unparsed } = parseRegister(markdown);
  const documented = rows.map((row) => `${row.package} ${row.glob}`);

  /** @type {string[]} */
  const findings = [];

  for (const line of unparsed) {
    findings.push(
      'docs/quality/coverage-exclusions.md has a row in the per-package table that does ' +
        `not name a package and a glob in backticks: ${line}`,
    );
  }

  for (const packageName of WORKSPACE_ROOTS.flatMap(listPackageDirectories)) {
    const configPath = `${packageName}/vitest.config.ts`;
    const configured = extractCoverageExclusions(readFileSync(path.join(root, configPath), 'utf8'));
    for (const glob of configured) {
      if (shared.has(glob)) continue;
      if (documented.includes(`${packageName} ${glob}`)) continue;
      findings.push(
        `${configPath} excludes "${glob}" from coverage, but ` +
          `docs/quality/coverage-exclusions.md has no row for ${packageName}.`,
      );
    }
  }

  for (const { package: packageName, glob } of rows) {
    const configPath = `${packageName}/vitest.config.ts`;
    if (!existsSync(path.join(root, configPath))) {
      findings.push(
        `docs/quality/coverage-exclusions.md documents ${packageName} ${glob}, ` +
          `but ${configPath} does not exist.`,
      );
      continue;
    }
    const configured = extractCoverageExclusions(readFileSync(path.join(root, configPath), 'utf8'));
    if (!configured.includes(glob)) {
      findings.push(
        `docs/quality/coverage-exclusions.md documents ${packageName} ${glob}, ` +
          `but ${configPath} no longer excludes it.`,
      );
    }
  }

  return findings;
}
