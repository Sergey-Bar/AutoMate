/**
 * The canonical API route set, read from the one place that declares it.
 *
 * `apps/api/src/route-manifest.ts` is the authority: it is a plain array of
 * `[method, path]` pairs, and `route-manifest.test.ts` in that package proves
 * the array equals the set of routes the mounted app actually registers — in
 * both directions, and with no `(method, path)` registered twice.
 *
 * So this module's job is *only* to read it. It does not hold a copy, and it does
 * not accept a list from a caller: a generator holding its own list is a second
 * authority, and the failure mode is a document that describes a product this is
 * not while nothing fails because nothing compares the two.
 *
 * **Why parse text rather than import it.** Node 24 will import a TypeScript
 * module directly, and that was tried. It works for a file with no imports —
 * `route-manifest.ts` is one — but the alternative for a file that *does* import
 * anything is either a build step or a dependency on a workspace package being
 * built, and a gate that requires `pnpm build` to have run is a gate that fails
 * on a fresh checkout. Reading the array literal keeps the gate read-only and
 * build-free, at the cost of a parser that has to be strict enough to fail when
 * the shape changes rather than silently return fewer routes.
 *
 * That strictness is the point, so it is tested in `route-manifest.test.mjs`
 * against fixtures: a missing terminator, an empty array, and two entries are
 * all distinguished rather than collapsed into "no routes".
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

/** Where the route set is declared. */
export const MANIFEST_PATH = 'apps/api/src/route-manifest.ts';

/**
 * One `['METHOD', '/path']` pair, anywhere in the source.
 *
 * Anchored on a quote-method-quote-comma-quote-path-quote run, which is the only
 * shape the array uses. Requiring at least one non-slash character in the path
 * keeps a `['*', '']` placeholder from being read as a route.
 */
const ROUTE_ENTRY = /\['([A-Z]+)',\s*'(\/[^']+)'\]/g;

/**
 * The canonical route set, as `method`/`path` pairs, in declaration order.
 *
 * @returns {Array<{ method: string, path: string }>}
 * @throws {Error} when the declaration is missing, empty, or unterminated
 */
export function canonicalRoutes() {
  const source = readFileSync(path.join(root, MANIFEST_PATH), 'utf8');
  const declaration = source.indexOf('export const CANONICAL_API_ROUTES');
  if (declaration === -1) {
    throw new Error(
      `${MANIFEST_PATH} does not declare CANONICAL_API_ROUTES. The declaration is the ` +
        'authority for which paths this product serves; without it nothing can tell a ' +
        'generator which routes to describe.',
    );
  }
  // The array is the block the declaration opens, so it ends at the first `];`
  // after it. Without this bound the scan would read every array in the file and
  // a second, unrelated one would be joined into the route set.
  const terminator = source.indexOf('];', declaration);
  if (terminator === -1) {
    throw new Error(
      `${MANIFEST_PATH} declares CANONICAL_API_ROUTES but never closes it. The parser ` +
        'reads a closed array rather than guessing where one ends.',
    );
  }
  const block = source.slice(declaration, terminator);
  /** @type {Array<{ method: string, path: string }>} */
  const routes = [];
  for (const match of block.matchAll(ROUTE_ENTRY)) {
    const method = match[1];
    const routePath = match[2];
    if (method === undefined || routePath === undefined) continue;
    routes.push({ method, path: routePath });
  }
  if (routes.length === 0) {
    throw new Error(
      `${MANIFEST_PATH} declares CANONICAL_API_ROUTES as an empty array. An empty route ` +
        'set would make every generated artefact describe a product that serves nothing, ' +
        'and every generator would report success.',
    );
  }
  return routes;
}

/** The routes as `METHOD /path` keys, the way a row or a path is compared. */
export function canonicalRouteKeys() {
  return canonicalRoutes().map(({ method, path: routePath }) => `${method} ${routePath}`);
}

/**
 * The path-parameter names one route declares, in order.
 *
 * OpenAPI wants each parameter declared once, in the order the path presents
 * them, so this reads the `:name` segments out of the path rather than trusting
 * a hand-written list beside the route.
 *
 * @param {string} routePath
 * @returns {string[]}
 */
export function pathParameters(routePath) {
  /** @type {string[]} */
  const names = [];
  for (const match of routePath.matchAll(/:([A-Za-z0-9_]+)/g)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
