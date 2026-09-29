import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** The repository root, for the committed data files this suite also reads. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Documentation a person reads to decide whether to trust this product.
 *
 * `unified-repository-migration.md` is **excluded**, and that is a decision worth
 * stating rather than a gap.
 *
 * It is the plan of record for a merge that has already happened, so most of its
 * citations name the repository this one was merged *from* — `src/engine/…`,
 * `perf/…`, `apps/server/…` — and they are correctly absent here. Scoping it by
 * prefix would have meant guessing at the source repository's shape, and a wrong
 * guess either hides real defects or reports the whole document.
 *
 * It is not unexamined. The two citations it carried that were wrong about *this*
 * repository — three references to an `orchestrator/chat.ts` that never existed
 * here, and whose surrounding claim ("deterministic mocks") had itself gone stale
 * — were corrected to point at `packages/automation/src/ai-gateway.ts` and its
 * adapters. What remains exempt is only the past-tense half.
 */
const DOCS = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];

/**
 * Every backticked token in a document that cites a source file.
 *
 * Narrow on purpose. A first pass accepted any backticked token containing a `/`
 * and produced 30 findings, almost all of them things a document is *allowed* to
 * name without them existing: a package name (`@automate/db`), a lint rule
 * (`@typescript-eslint/no-explicit-any`), a URL path (`/api/v1`), and a bare
 * directory relative to whichever package the reader is in (`src/`). A gate that
 * cries wolf is switched off, and this one would have been.
 *
 * So: a token must carry a source-file extension. That is exactly the shape of
 * both real defects — `src/routes/chat.test.ts` and
 * `apps/api/src/modules/orchestrator/chat.ts` — and it is the shape a reader
 * would try to open.
 *
 * @param {string} text
 * @returns {string[]} sorted, de-duplicated
 */
function citedPaths(text) {
  const found = new Set();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const token = (span[1] ?? '').trim();
    // Trailing `path:38-113` and `,` are citations of a place, not of a token.
    const citation = token.replace(/:[\d, -]+$/, '').replace(/[.,;:]$/, '');
    if (!isSourceFileCitation(citation)) continue;
    // A single segment is a basename, and this suite cannot tell which package a
    // reader means by it — `host-scanners.test.mjs` lives in `scripts/lib`, the
    // same token in another document could mean something else. Not checked.
    if (!citation.includes('/')) continue;
    // A scoped package name is a dependency, not a path in this repository.
    if (citation.startsWith('@')) continue;
    // `pnpm --filter x exec vitest run src/x.ts` arrives as one token with spaces.
    if (/\s/.test(citation)) continue;
    found.add(citation);
  }
  return [...found].sort();
}

/**
 * A relative path that names a file this repository would contain.
 *
 * `.mjs`/`.cjs` are included and plain `.js` is **not**: a document may name
 * `dist/index.js` as build output, but a `.mjs` in this repository is always a
 * source gate script that exists. `no-console`'s own reasoning applies — a gate
 * is worth checking, an artefact is not.
 */
const EXTENSION = /\.(?:[cm]?tsx?|ya?ml|mjs|cjs)$/;

/**
 * One path segment: letters, digits, dot, dash, underscore.
 *
 * A leading dot is allowed because `.github/workflows/unified-ci.yml` is the most
 * frequently cited file in the security rules, and a rule that could not check the
 * file it exists to protect would be worse than useless.
 */
const SEGMENT = /^\.?[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Whether a token is a citation of a source file in this repository.
 *
 * Written as three separate checks rather than one pattern. The single-regex
 * version needed a nested quantifier over an overlapping character class — the
 * shape `security/detect-unsafe-regex` flags, and correctly: it was ambiguous
 * about where one segment ended and the next began. Splitting it says the same
 * thing in a form that cannot backtrack badly.
 *
 * @param {string} token
 */
function isSourceFileCitation(token) {
  if (!EXTENSION.test(token)) return false;
  // A leading `./` or `../` is a spelling, not a difference.
  const body = token.replace(/^\.{1,2}\//, '');
  // Every segment must be a plausible name, which is what rules out a URL path,
  // a package name, and prose that happens to end in something.
  return body.split('/').every((segment) => SEGMENT.test(segment));
}

/** Every file under the repository root, as `/`-separated relative paths. */
/** @type {string[] | null} */
let allFiles = null;
function files() {
  if (allFiles !== null) return allFiles;
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(REPO_ROOT, full).replaceAll('\\', '/'));
    }
  };
  walk(REPO_ROOT);
  allFiles = found;
  return allFiles;
}

/**
 * Whether a citation names something that exists.
 *
 * Two readings, because the documents use two. An absolute-from-root path is
 * checked as written; a path relative to whichever package the reader is in
 * (`src/errors/boundary.ts` in `AGENTS.md`, which is all of `apps/api`) is
 * checked as a suffix. The second is what makes the check usable on the
 * conventions sections, which write paths the way a developer types them.
 *
 * @param {string} relative
 */
function resolves(relative) {
  const clean = relative.replace(/^\.\//, '');
  return files().some(
    /** @param {string} file */ (file) => file === clean || file.endsWith(`/${clean}`),
  );
}

test('the documentation exists, so the checks below are about drift and not absence', () => {
  // A scan over a missing file reads as a clean repository. This keeps the next
  // assertions from passing on nothing.
  for (const doc of DOCS) {
    const full = path.join(REPO_ROOT, doc);
    assert.ok(
      existsSync(full) && readFileSync(full, 'utf8').length > 0,
      `${doc} is missing or empty; every drift check below would pass vacuously`,
    );
  }
});

test('the cited path check reaches the documents it claims to', () => {
  // A detector that finds nothing is indistinguishable from clean documents, and
  // the two real defects were invisible for exactly that reason.
  assert.deepEqual(citedPaths('`apps/api/src/routes/chat.test.ts`'), [
    'apps/api/src/routes/chat.test.ts',
  ]);
  assert.deepEqual(citedPaths('`packages/config/src/config.ts` is the source.'), [
    'packages/config/src/config.ts',
  ]);
  // A line range is a citation of a place, and resolves against the file.
  assert.deepEqual(citedPaths('see `.github/workflows/unified-ci.yml:38-113` for the job'), [
    '.github/workflows/unified-ci.yml',
  ]);
  // So is a plain workflow path, which is how the security rules name one.
  assert.deepEqual(citedPaths('`actions/install-scanners/action.yml` installs them'), [
    'actions/install-scanners/action.yml',
  ]);

  // And the shapes a document is allowed to name without them existing. Each of
  // these was a false positive in the first pass, and a gate that reports them
  // gets switched off rather than refined.
  assert.deepEqual(
    citedPaths(
      [
        '`@automate/shared-contracts` is a package',
        '`@typescript-eslint/no-explicit-any` is a rule',
        '`/api/v1/agents` is a route',
        '`src/` is relative to the package',
        '`apps/web/src/store/` is a directory that must not exist',
        '`dist/index.js` is build output',
        '`**/dist` is a glob',
        '`pnpm --filter x test` is a command',
        '`statements/branches` is prose',
      ].join(' '),
    ),
    [],
  );
});

test('no document cites a path that does not exist', () => {
  // Neither of these was in a "planned" section, and both were in documents a
  // reader follows: `AGENTS.md` gave a single-file test command against a file
  // that did not exist, and the migration plan cited a module three times. A
  // reader following either was told to run something that cannot succeed.
  //
  // A gate rather than a review note, because the review note is what did not
  // catch either one.
  const missing = [];
  for (const doc of DOCS) {
    const text = readFileSync(path.join(REPO_ROOT, doc), 'utf8');
    for (const cited of citedPaths(text)) {
      if (resolves(cited)) continue;
      missing.push(`${doc}: \`${cited}\``);
    }
  }
  assert.deepEqual(missing, [], `cited paths that do not exist:\n${missing.join('\n')}`);
});
