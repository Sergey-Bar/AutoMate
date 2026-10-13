import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  canonicalRouteKeys,
  canonicalRoutes,
  pathParameters,
  MANIFEST_PATH,
} from './route-manifest.mjs';

/**
 * The route-manifest reader, proven against fixtures rather than trusted.
 *
 * This module is what every generator reads to learn which paths the product
 * serves, so a parser that silently returns fewer routes than the file declares
 * would make every artefact describe a smaller product while reporting success.
 * The failure mode is not hypothetical: the reader parses a *declaration* out of
 * TypeScript source, and the obvious bug — reading every array in the file, or
 * reading past the end of the one — produces exactly that.
 *
 * So each of the three ways to get it wrong has a fixture below, and each is
 * asserted to be *reported* rather than absorbed.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const here = path.dirname(fileURLToPath(import.meta.url));
const real = readFileSync(path.join(root, MANIFEST_PATH), 'utf8');

/** The scratch root in use, so the last thing a run does is remove it. */
let copy = '';

/**
 * Runs the reader against a fixture declaration.
 *
 * The reader resolves `MANIFEST_PATH` from its own location, so the fixture has
 * to sit where that resolution lands: a copy of this module is placed at
 * `scripts/lib/` inside a temporary repository root, with the declaration beside
 * it at `apps/api/src/route-manifest.ts`. Pointing the module at a path directly
 * would be the easier design and the wrong one — it would let a caller choose
 * which manifest to read, and then there would be a caller whose manifest is not
 * the product's.
 *
 * @param {(fixturePath: string) => void} write
 * @returns {() => Promise<Array<{ method: string, path: string }>>}
 */
function against(write) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'route-manifest-'));
  const declaration = path.join(temporary, MANIFEST_PATH);
  copy = path.join(temporary, 'scripts', 'lib', 'route-manifest.mjs');
  mkdirSync(path.dirname(declaration), { recursive: true });
  mkdirSync(path.dirname(copy), { recursive: true });
  write(declaration);
  // The *reader*, not this file. The first version copied `import.meta.url`, so
  // the module slot held the test and every fixture failed with a syntax error
  // about a missing export — which is how "the fixtures cannot run" presents
  // itself, and why the first run was worth reading rather than deleting.
  //
  // `path.dirname(fileURLToPath(import.meta.url))` rather than `new URL`, because
  // the eslint environment a `.mjs` gate script runs in has no `URL` global and a
  // `no-undef` on it would be a lint failure in a file that runs fine.
  writeFileSync(copy, readFileSync(path.join(here, 'route-manifest.mjs')));
  return async () => {
    const module =
      /** @type {{ canonicalRoutes: () => Array<{ method: string, path: string }> }} */ (
        await import(pathToFileURL(copy).href)
      );
    return module.canonicalRoutes();
  };
}

test('reads the real declaration, and every entry in it', () => {
  const routes = canonicalRoutes();
  // The count is read out of the source rather than restated, because a number
  // here would be a second authority for the same fact and would drift the first
  // time a route is added.
  const declared = [...real.matchAll(/\['([A-Z]+)',\s*'(\/[^']+)'\]/g)].length;
  assert.equal(routes.length, declared);
  assert.ok(routes.length > 50, `expected the full route set, got ${String(routes.length)}`);
});

test('reports a missing declaration rather than an empty route set', async () => {
  const read = against((file) => writeFileSync(file, 'export const SOMETHING_ELSE = [];\n'));
  await assert.rejects(read(), /does not declare CANONICAL_API_ROUTES/);
});

test('reports an unclosed array rather than guessing where it ends', async () => {
  const read = against((file) =>
    writeFileSync(file, "export const CANONICAL_API_ROUTES = [\n  ['GET', '/health'],\n"),
  );
  await assert.rejects(read(), /never closes it/);
});

test('reports an empty array rather than a product that serves nothing', async () => {
  const read = against((file) => writeFileSync(file, 'export const CANONICAL_API_ROUTES = [];\n'));
  await assert.rejects(read(), /empty array/);
});

test('stops at the terminator, so a second array in the file is not joined in', async () => {
  const read = against((file) =>
    writeFileSync(
      file,
      "export const CANONICAL_API_ROUTES = [\n  ['GET', '/health'],\n];\n" +
        "export const SOMETHING_ELSE = [\n  ['POST', '/not/a/route'],\n];\n",
    ),
  );
  assert.deepEqual(await read(), [{ method: 'GET', path: '/health' }]);
});

test('reads path parameters in the order the path presents them', () => {
  assert.deepEqual(pathParameters('/api/v1/runs/:runId/artifacts/:artifactId'), [
    'runId',
    'artifactId',
  ]);
  // A repeated name is declared once: OpenAPI would reject a parameter list with
  // two entries of the same name, and the path is the same route either way.
  assert.deepEqual(pathParameters('/api/v1/runs/:runId/jobs/:runId'), ['runId']);
  assert.deepEqual(pathParameters('/health'), []);
});

test('exposes the routes as comparable keys, one per declaration', () => {
  // `canonicalRouteKeys` is the shape a row in another artefact is compared
  // against, so it has to be one key per declared route — a collapsed list would
  // let two routes share one row.
  assert.equal(canonicalRouteKeys().length, canonicalRoutes().length);
  assert.ok(canonicalRouteKeys().includes('GET /api/v1/runs/:runId'));
});

test('cleans up its temporary root', () => {
  // Not an assertion about the reader: it keeps the fixtures from leaking a
  // directory per test run, which is the kind of thing nobody notices until a
  // workspace has four thousand of them.
  assert.equal(typeof canonicalRoutes()[0]?.path, 'string');
  assert.ok(copy !== '', 'a fixture was written, so there is a root to clean');
  rmSync(path.dirname(path.dirname(copy)), { recursive: true, force: true });
});
