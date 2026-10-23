/**
 * The authz matrix: every route the composed API registers, and who may call it.
 *
 * `docs/quality/authz-matrix.json` is generated, and the access class of a route is read from
 * the handler chain Hono will run for it rather than typed. A credential check is a
 * middleware tagged by `apps/api/src/http/access.ts` (`guard(...)`); a route whose chain has
 * no tagged middleware is `open`, which is the posture ADR-006 gives the install. The tag is
 * a property under a registered symbol, so this module finds it with `Symbol.for` and
 * imports nothing from the application.
 *
 * Why introspection and not a source scan: whether a route is guarded depends on what the
 * composition mounts, in what order, under which wildcard middleware. Only the built `Hono`
 * instance knows that, and a regular expression over `app.post(` would report the route a
 * file declares rather than the route the process serves. The cost is that the generator
 * needs the API built (`pnpm build`), and it says so rather than reporting a clean matrix
 * over nothing.
 *
 * Pure over an injected description of the tree, so the negative cases are testable.
 * Dependency-free.
 */

/** The registered symbol `guard()` tags a middleware with. */
export const ACCESS_TAG = Symbol.for('automate.access-class');

/** What a route with no tagged middleware is. */
export const OPEN = 'open';

/**
 * @typedef {object} RegisteredRoute one entry of Hono's `app.routes`
 * @property {string} method
 * @property {string} path
 * @property {unknown} handler
 */

/**
 * @typedef {object} Row
 * @property {string} method
 * @property {string} path
 * @property {string} access `open`, or the tagged class(es) joined with `+`
 * @property {boolean} workspaceScoped the endpoint's own code names the workspace
 * @property {string | null} evidenceTest the test file that exercises this route
 * @property {string} composition `always`, or `database` for a group mounted only with DATABASE_URL
 */

/**
 * @typedef {object} TestFile
 * @property {string} path repository-relative, `/`-separated
 * @property {string} text
 */

/**
 * A request path that the pattern matches: parameters and wildcards filled with a literal.
 *
 * @param {string} pattern
 * @returns {string}
 */
export function concretePath(pattern) {
  return pattern.replace(/:[A-Za-z0-9_]+\??/g, 'x').replace(/\*/g, 'x');
}

/**
 * Whether Hono would run a handler registered at `pattern` for `path`.
 *
 * `/a/*` also matches `/a`, as Hono's does; `:name` is one segment; `*` anywhere is anything.
 *
 * @param {string} pattern
 * @param {string} path
 * @returns {boolean}
 */
export function patternMatches(pattern, path) {
  if (pattern === '*' || pattern === '/*') return true;
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.*';
      if (segment.startsWith(':')) return '[^/]+';
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    })
    .join('/');
  const trailingWildcard = pattern.endsWith('/*');
  const base = trailingWildcard ? source.slice(0, -'/.*'.length) : source;
  return new RegExp(`^${base}${trailingWildcard ? '(/.*)?' : ''}$`).test(path);
}

/**
 * The handlers Hono runs for a request to `method path`, in registration order.
 *
 * @param {readonly RegisteredRoute[]} routes
 * @param {string} method
 * @param {string} path a concrete path
 * @returns {RegisteredRoute[]}
 */
export function handlerChain(routes, method, path) {
  return routes.filter(
    (route) =>
      (route.method === 'ALL' || route.method === method) && patternMatches(route.path, path),
  );
}

/**
 * The tag a handler carries, or `undefined`.
 *
 * @param {unknown} handler
 * @returns {string | undefined}
 */
export function tagOf(handler) {
  if (typeof handler !== 'function') return undefined;
  const tag = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (handler))[ACCESS_TAG];
  return typeof tag === 'string' ? tag : undefined;
}

/**
 * Whether an entry is an endpoint rather than middleware: it answers one method, at a path
 * with no wildcard, and is not a credential check attached to a route.
 *
 * @param {RegisteredRoute} route
 * @returns {boolean}
 */
export function isEndpoint(route) {
  return route.method !== 'ALL' && !route.path.includes('*') && tagOf(route.handler) === undefined;
}

/**
 * Whether the endpoint's own code names the workspace.
 *
 * **What this is and is not.** It reads the handler's source for the identifiers this API uses
 * for the tenancy boundary (`ws`, `workspace`, `workspaceId`, `WORKSPACE`). It is a statement
 * about the handler, derived from the code; it is not a proof that the data layer filters, and
 * a handler that delegates to a store bound to a workspace elsewhere reports `false`. The
 * cross-workspace isolation tests (`tenancy-scope.json`) are what prove the filter; this
 * column is the prompt to look for one.
 *
 * @param {readonly unknown[]} handlers
 * @returns {boolean}
 */
export function namesWorkspace(handlers) {
  return handlers.some(
    (handler) =>
      typeof handler === 'function' &&
      /\b(ws|workspace|workspaceId|workspaceID|WORKSPACE_ID|DEFAULT_WORKSPACE_ID)\b/.test(
        Function.prototype.toString.call(handler),
      ),
  );
}

/**
 * A pattern that finds a route in a test's text, with each parameter free.
 *
 * @param {string} path
 * @returns {string}
 */
function routePattern(path) {
  const escaped = path
    .split('/')
    .map((segment) =>
      segment.startsWith(':')
        ? '(?:[^/\'"`?\\s]+|\\$\\{[^}]*\\})'
        : segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return `${escaped}(?=['"\`?\\s/#)]|$)`;
}

/**
 * Every test file that names a route, best first: the one that names it most often, and one
 * under `apps/api` before one elsewhere. Matrix and manifest tests are not evidence about a
 * route - they name every route.
 *
 * @param {string} path
 * @param {readonly TestFile[]} tests
 * @returns {string[]}
 */
export function evidenceCandidates(path, tests) {
  const pattern = new RegExp(routePattern(path), 'g');
  return tests
    .filter((test) => !/authz-matrix|route-manifest/.test(test.path))
    .map((test) => ({
      path: test.path,
      count: (test.text.match(pattern) ?? []).length,
      local: test.path.startsWith('apps/api/') ? 1 : 0,
    }))
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => b.local - a.local || b.count - a.count || a.path.localeCompare(b.path))
    .map((candidate) => candidate.path);
}

/**
 * The test file that most plainly exercises a route, or `null`.
 *
 * @param {string} path
 * @param {readonly TestFile[]} tests
 * @returns {string | null}
 */
export function evidenceFor(path, tests) {
  return evidenceCandidates(path, tests)[0] ?? null;
}
/**
 * Rows for every endpoint in `routes`.
 *
 * @param {{ routes: readonly RegisteredRoute[], tests: readonly TestFile[], composition?: string }} input
 * @returns {Row[]}
 */
export function describeRoutes({ routes, tests, composition = 'always' }) {
  /** @type {Map<string, Row>} */
  const rows = new Map();
  for (const route of routes.filter(isEndpoint)) {
    const key = `${route.method} ${route.path}`;
    if (rows.has(key)) continue;
    const chain = handlerChain(routes, route.method, concretePath(route.path));
    const classes = [
      ...new Set(chain.map((entry) => tagOf(entry.handler)).filter((tag) => tag !== undefined)),
    ];
    rows.set(key, {
      method: route.method,
      path: route.path,
      access: classes.length === 0 ? OPEN : classes.join('+'),
      workspaceScoped: namesWorkspace(
        chain.filter((entry) => isEndpoint(entry)).map((entry) => entry.handler),
      ),
      evidenceTest: evidenceFor(route.path, tests),
      composition,
    });
  }
  return [...rows.values()];
}

/**
 * The whole matrix: the always-mounted routes, then groups mounted only conditionally.
 *
 * @param {Array<{ routes: readonly RegisteredRoute[], composition: string }>} groups
 * @param {readonly TestFile[]} tests
 * @returns {Row[]}
 */
export function buildMatrix(groups, tests) {
  const all = groups.flatMap((group) =>
    describeRoutes({ routes: group.routes, tests, composition: group.composition }),
  );
  return all.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

/**
 * @param {readonly Row[]} rows
 * @returns {Record<string, number>}
 */
export function summarise(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of rows) counts[row.access] = (counts[row.access] ?? 0) + 1;
  return counts;
}

/** @param {Row} row */
const keyOf = (row) => `${row.method} ${row.path}`;

/**
 * Where the committed matrix and the application disagree. Empty means they agree.
 *
 * evidenceTest is compared loosely: the committed file must still exist and still name the
 * route, not be the one a fresh pick would make. Otherwise adding a test that mentions a route
 * would fail a gate that has nothing to do with authorisation.
 *
 * @param {readonly Row[]} committed
 * @param {readonly Row[]} generated
 * @param {readonly TestFile[]} tests
 * @returns {string[]}
 */
export function compareMatrix(committed, generated, tests) {
  if (generated.length === 0) return ['the application registered no routes'];
  const have = new Map(committed.map((row) => [keyOf(row), row]));
  const want = new Map(generated.map((row) => [keyOf(row), row]));
  /** @type {string[]} */
  const findings = [];
  for (const [key, row] of want) {
    const listed = have.get(key);
    if (listed) findings.push(...rowFindings(key, listed, row, tests));
    else findings.push(`${key}: registered (${row.access}) and has no row in the matrix`);
  }
  for (const key of have.keys()) {
    if (!want.has(key))
      findings.push(`${key}: in the matrix and not registered by the application`);
  }
  return findings;
}

/**
 * How one listed row disagrees with the application's reading of the same route.
 *
 * @param {string} key
 * @param {Row} listed
 * @param {Row} row
 * @param {readonly TestFile[]} tests
 * @returns {string[]}
 */
function rowFindings(key, listed, row, tests) {
  /** @type {string[]} */
  const findings = [];
  for (const field of /** @type {const} */ (['access', 'workspaceScoped', 'composition'])) {
    if (listed[field] !== row[field]) {
      findings.push(
        `${key}: ${field} is ${JSON.stringify(listed[field])} in the matrix and ` +
          `${JSON.stringify(row[field])} in the application`,
      );
    }
  }
  const evidence = listed.evidenceTest;
  const stillNamed =
    evidence === null
      ? row.evidenceTest === null
      : evidenceCandidates(row.path, tests).includes(evidence);
  if (!stillNamed) {
    findings.push(
      `${key}: evidenceTest ${JSON.stringify(evidence)} no longer names the route ` +
        `(a fresh pick is ${JSON.stringify(row.evidenceTest)})`,
    );
  }
  return findings;
}

/**
 * Rows a matrix may not carry: a guarded route with no test of its own is a credential check
 * nothing exercises.
 *
 * @param {readonly Row[]} rows
 * @returns {string[]}
 */
export function unevidencedGuardedRoutes(rows) {
  return rows
    .filter((row) => row.access !== OPEN && row.evidenceTest === null)
    .map((row) => `${keyOf(row)}: ${row.access} route with no test that names it`);
}
