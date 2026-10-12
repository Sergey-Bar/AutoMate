import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catalogPath = 'packages/projects/src/tool-catalog.ts';
const browserCopyPath = 'apps/web/src/lib/qa-tools.ts';

/**
 * The browser boundary for the tool catalogue.
 *
 * `apps/web` imports `@automate/projects/tool-catalog`, and a browser bundle
 * that pulls in `node:fs` is either a build failure or — worse — a bundle that
 * silently includes a polyfill and grows by hundreds of kilobytes for code the
 * browser cannot use. The package's own detection modules legitimately use Node
 * built-ins; the catalogue must not, because its whole reason for moving into
 * `packages/projects` was that two runtimes read the same fifty rows.
 *
 * The check is a source scan rather than a bundler run, because a bundler
 * reports the problem as a size delta nobody reads, and because the constraint
 * is the point of the module rather than a consequence of it.
 */

/** @param {string} source */
function importSpecifiers(source) {
  return [...source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  );
}

test('the tool catalogue imports no Node built-in', () => {
  const source = readFileSync(path.join(root, catalogPath), 'utf8');
  const builtins = importSpecifiers(source).filter((specifier) => /^node:/u.test(specifier));
  assert.deepEqual(
    builtins,
    [],
    `${catalogPath} imports a Node built-in, so the browser bundle would carry code the browser cannot run`,
  );
});

test('the browser keeps one copy of the registry, in the package', () => {
  // A second copy in `apps/web` would drift from this one exactly the way the
  // hand-written list drifted from the tools it described, and nothing about
  // deleting it once would stop a second one appearing.
  assert.equal(
    existsSync(path.join(root, browserCopyPath)),
    false,
    `${browserCopyPath} exists; the cockpit must read the catalogue from @automate/projects/tool-catalog instead`,
  );
  const cockpit = readFileSync(path.join(root, 'apps/web/src/components/Main.tsx'), 'utf8');
  assert.match(
    cockpit,
    /from '@automate\/projects\/tool-catalog'/u,
    'the cockpit no longer imports the catalogue from the package; a browser copy is back',
  );
});
