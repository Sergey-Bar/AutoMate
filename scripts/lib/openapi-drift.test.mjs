import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildOpenApiDocument,
  readApiSources,
  scanRoutes,
  toTemplate,
} from './openapi-document.mjs';

/**
 * The route half of the OpenAPI drift gate (ledger RF-11). The schema half is
 * `packages/shared-contracts/src/openapi.test.ts`; the two are separate so that this one needs no
 * build and can sit in `pnpm docs:check`, which runs before one.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const committed = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs', 'openapi.json'), 'utf8'));

/** @param {{ path: string, text: string }[]} files */
const scan = (files) => scanRoutes(files).map((route) => `${route.method} ${route.path}`);

test('a route registration is found whatever the Hono instance is called', () => {
  assert.deepEqual(
    scan([
      {
        path: 'apps/api/src/routes/x.ts',
        text: [
          "app.get('/api/v1/runs/:runId', handler);",
          'health.get("/health", handler);',
          'routes.post(`/api/v1/jobs/:jobId/events`, handler);',
          "router.delete('/ready', handler);",
        ].join('\n'),
      },
    ]),
    // Sorted by path, then method.
    ['post /api/v1/jobs/:jobId/events', 'get /api/v1/runs/:runId', 'get /health', 'delete /ready'],
  );
});

test('calls that are not routes are not mistaken for them', () => {
  assert.deepEqual(
    scan([
      {
        path: 'apps/api/src/x.ts',
        text: [
          "const header = c.req.header('x-request-id');",
          "const found = entries.get('key');",
          "const other = lookup.get('not/a/route');",
          'app.get(pathFromElsewhere, handler);',
        ].join('\n'),
      },
    ]),
    [],
  );
});

test('the same route registered twice is one route', () => {
  const text = "app.get('/api/v1/a', one);\napp.get('/api/v1/a', two);";
  assert.equal(scanRoutes([{ path: 'apps/api/src/a.ts', text }]).length, 1);
});

test('path parameters become OpenAPI templates and are declared', () => {
  assert.deepEqual(toTemplate('/api/v1/runs/:runId/artifacts/:artifactId'), {
    template: '/api/v1/runs/{runId}/artifacts/{artifactId}',
    parameters: ['runId', 'artifactId'],
  });
  const document = buildOpenApiDocument(
    scanRoutes([{ path: 'apps/api/src/a.ts', text: "app.get('/api/v1/runs/:runId', h);" }]),
    {},
  );
  const operation = /** @type {any} */ (document.paths)['/api/v1/runs/{runId}'].get;
  assert.deepEqual(operation.parameters, [
    { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
  ]);
  assert.ok(operation.responses.default, 'OpenAPI requires every operation to have a response');
});

test('the committed docs/openapi.json lists exactly the routes the API registers', () => {
  const registered = scanRoutes(readApiSources(REPO_ROOT));
  assert.ok(
    registered.length > 50,
    `only ${String(registered.length)} routes were found; the scan has stopped seeing the API and ` +
      'every comparison below would pass on nothing',
  );
  const documented = Object.entries(committed.paths).flatMap(([template, operations]) =>
    Object.keys(/** @type {object} */ (operations)).map((method) => `${method} ${template}`),
  );
  const expected = registered.map((route) => {
    return `${route.method} ${toTemplate(route.path).template}`;
  });
  assert.deepEqual(
    documented.sort(),
    expected.sort(),
    'docs/openapi.json and the registered routes disagree; run `pnpm build` then `pnpm openapi:generate`',
  );
});

test('a route added to the API makes the document stale, so the gate can fail', () => {
  const sources = readApiSources(REPO_ROOT);
  const withNewRoute = [
    ...sources,
    {
      path: 'apps/api/src/routes/new.ts',
      text: "app.get('/api/v1/a-route-nobody-documented', h);",
    },
  ];
  const documented = new Set(
    Object.entries(committed.paths).flatMap(([template, operations]) =>
      Object.keys(/** @type {object} */ (operations)).map((method) => `${method} ${template}`),
    ),
  );
  const missing = scanRoutes(withNewRoute)
    .map((route) => `${route.method} ${toTemplate(route.path).template}`)
    .filter((key) => !documented.has(key));
  assert.deepEqual(missing, ['get /api/v1/a-route-nobody-documented']);
});

test('the document is OpenAPI 3.1 with a response on every operation', () => {
  assert.equal(committed.openapi, '3.1.0');
  for (const [template, operations] of Object.entries(committed.paths)) {
    for (const [method, operation] of Object.entries(/** @type {object} */ (operations))) {
      assert.ok(/** @type {any} */ (operation).responses, `${method} ${template} has no responses`);
    }
  }
});
