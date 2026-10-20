/**
 * The OpenAPI document for the API (ledger RF-11), and the route scan that feeds it.
 *
 * Two halves, deliberately from two different sources, so neither is written by hand:
 *
 * - **`components.schemas`** comes from the Zod contracts in `@automate/shared-contracts`, which
 *   both the API and the client already validate against, converted by `buildComponentSchemas`.
 * - **`paths`** comes from a static scan of `apps/api/src` for route registrations, so a route
 *   that is added without being in the document is a failing test and not a stale artefact.
 *
 * What this document does **not** claim, stated here because a file called `openapi.json` reads
 * as more than it is: operations are not yet bound to the request and response schemas they use,
 * so it describes which routes exist and which shapes the contracts define, not which route takes
 * which shape. Binding them is the next step and needs the routes to declare their schemas, not
 * a heuristic over their source.
 *
 * Pure functions only. Reading the tree and writing the file are in `scripts/openapi.mjs`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The HTTP methods a Hono route is registered with. */
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * A registration such as `app.get('/api/v1/runs/:runId', ...)`. The receiver is any identifier,
 * because the route files name their `Hono` instance `app`, `health`, `routes` and `router`.
 * The path has to be a string literal that starts with `/api`, `/health`, `/ready` or
 * `/metrics`: that is what separates a route from `map.get('key')` and `c.req.header('x')`.
 */
const ROUTE = new RegExp(
  `\\b\\w+\\.(${METHODS.join('|')})\\(\\s*[\`'"](/(?:api|health|ready|metrics)[^\`'"]*)[\`'"]`,
  'g',
);

/**
 * @typedef {{ method: string, path: string, file: string }} Route
 * @typedef {{ path: string, text: string }} SourceFile
 */

/**
 * The routes registered in `files`, sorted and de-duplicated.
 *
 * @param {SourceFile[]} files repository-relative path and text of each non-test source file
 * @returns {Route[]}
 */
export function scanRoutes(files) {
  /** @type {Map<string, Route>} */
  const found = new Map();
  for (const file of files) {
    for (const match of file.text.matchAll(ROUTE)) {
      const method = match[1] ?? '';
      const routePath = match[2] ?? '';
      found.set(`${method} ${routePath}`, { method, path: routePath, file: file.path });
    }
  }
  return [...found.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/**
 * Every non-test `.ts` file under `apps/api/src`.
 *
 * @param {string} root repository root
 * @returns {SourceFile[]}
 */
export function readApiSources(root) {
  /** @type {SourceFile[]} */
  const files = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !/\.test\.ts$/.test(entry.name)) {
        files.push({
          path: path.relative(root, full).replaceAll('\\', '/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(path.join(root, 'apps', 'api', 'src'));
  return files;
}

/**
 * `/api/v1/runs/:runId` as OpenAPI writes it, and the parameter names it carries.
 *
 * @param {string} routePath
 * @returns {{ template: string, parameters: string[] }}
 */
export function toTemplate(routePath) {
  /** @type {string[]} */
  const parameters = [];
  const template = routePath.replace(/:(\w+)/g, (_match, name) => {
    parameters.push(name);
    return `{${name}}`;
  });
  return { template, parameters };
}

/**
 * @param {Route[]} routes
 * @param {Record<string, unknown>} componentSchemas
 * @returns {{ openapi: string, info: object, paths: Record<string, Record<string, unknown>>, components: object }}
 */
export function buildOpenApiDocument(routes, componentSchemas) {
  /** @type {Record<string, Record<string, unknown>>} */
  const paths = {};
  for (const route of routes) {
    const { template, parameters } = toTemplate(route.path);
    const operations = (paths[template] ??= {});
    operations[route.method] = {
      operationId: `${route.method}${template.replace(/[^A-Za-z0-9]+(.)?/g, (_m, next) => (next ?? '').toUpperCase())}`,
      tags: [template.split('/')[3] ?? template.split('/')[1] ?? 'root'],
      'x-source': route.file,
      ...(parameters.length > 0
        ? {
            parameters: parameters.map((name) => ({
              name,
              in: 'path',
              required: true,
              schema: { type: 'string' },
            })),
          }
        : {}),
      responses: { default: { description: 'Defined by the route handler.' } },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Automate API',
      version: '1',
      description:
        'Generated by `pnpm openapi:generate`; do not edit. `paths` lists the routes registered ' +
        'in apps/api/src and `components.schemas` the Zod contracts in @automate/shared-contracts. ' +
        'Operations are not yet bound to the schemas they use.',
    },
    paths,
    components: { schemas: componentSchemas },
  };
}
