import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One place constructs a canonical run result.
 *
 * `playwright-json.ts` and `junit-xml.ts` each built a complete
 * `CanonicalRunResultSchema.parse({ … })` envelope — nine identical boilerplate
 * fields — and each derived the run status from its own copy of a ladder. The ladders
 * were not the same ladder, and the difference was a real defect: JUnit had no
 * `flaky` rung, so a `<rerunFailure>` produced `status: 'passed'` while the identical
 * outcome from a Playwright report produced `flaky`.
 *
 * `canonical-run-result.ts` is now the only constructor. A third adapter, or a fourth,
 * would be written by copying whichever file was open — so this test fails if
 * `parse(` on that schema reappears anywhere else.
 *
 * `safeParse` is deliberately **not** flagged. The API's ingestion services validate
 * untrusted input with it, and that is a different job from constructing a result:
 * validation has no business filling in nine envelope fields, and a schema used to
 * validate is not a second declaration of it.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');
const OWNER = 'packages/reporter/src/canonical-run-result.ts';

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|mjs)$/;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.kilo',
  '.turbo',
  'blob-report',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'var',
]);

function sourceFiles(directory: string): string[] {
  const stats = statSync(directory, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (SOURCE_EXTENSIONS.test(entry.name)) found.push(full);
  }
  return found;
}

/** `CanonicalRunResultSchema.parse(` — or the `RunResultSchema` alias, which is the same object. */
const CONSTRUCTOR = /(CanonicalRunResultSchema|RunResultSchema)\.parse\(/;

function constructors(): string[] {
  const found: string[] = [];
  for (const directory of ['apps', 'packages', 'tools', 'tests']) {
    for (const file of sourceFiles(path.join(repoRoot, directory))) {
      const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
      if (relative === OWNER) continue;
      // Comments stripped, so the rationale written above — and the one in this file
      // — is not mistaken for a call. A mention in prose is not a construction.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (CONSTRUCTOR.test(source)) {
        const line = source.split('\n').findIndex((text) => CONSTRUCTOR.test(text)) + 1;
        found.push(`${relative}:${line} constructs a canonical run result`);
      }
    }
  }
  return found.sort();
}

describe('canonical run result construction', () => {
  it('finds the source files it is meant to scan', () => {
    const scanned = sourceFiles(path.join(repoRoot, 'packages'));
    expect(scanned.length).toBeGreaterThan(50);
  });

  it('lives in exactly one file, and that file exists', () => {
    // Asserted so the list of "allowed" owners is not a permission granted to a file
    // that was renamed away: a gate whose exemption names nothing is a gate that
    // exempts everything.
    expect(statSync(path.join(repoRoot, OWNER)).isFile()).toBe(true);
  });

  it('is not constructed anywhere else', () => {
    expect(constructors()).toEqual([]);
  });

  it('still validates untrusted input with safeParse, which is a different job', () => {
    // The API's ingestion services must keep validating. If this test started failing
    // because `safeParse` disappeared, the fix would be to reintroduce the check — not
    // to relax this one.
    const ingestion = readFileSync(
      path.join(repoRoot, 'apps/api/src/services/reporter-ingestion.ts'),
      'utf8',
    );
    expect(ingestion).toMatch(/CanonicalRunResultSchema\.safeParse\(/);
  });
});
