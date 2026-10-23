import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACCESS_TAG,
  buildMatrix,
  compareMatrix,
  concretePath,
  describeRoutes,
  evidenceCandidates,
  handlerChain,
  isEndpoint,
  namesWorkspace,
  patternMatches,
  summarise,
  tagOf,
  unevidencedGuardedRoutes,
} from './authz-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {string} access
 * @returns {() => void}
 */
function guardTagged(access) {
  const middleware = () => undefined;
  Object.defineProperty(middleware, ACCESS_TAG, { value: access });
  return middleware;
}
const plain = () => undefined;

test('a path pattern is matched the way Hono matches it', () => {
  assert.equal(patternMatches('/api/v1/runs/:runId', '/api/v1/runs/x'), true);
  assert.equal(patternMatches('/api/v1/runs/:runId', '/api/v1/runs/x/events'), false);
  assert.equal(patternMatches('/api/v1/reporter/*', '/api/v1/reporter/events'), true);
  assert.equal(patternMatches('/api/v1/reporter/*', '/api/v1/reporter'), true);
  assert.equal(patternMatches('/api/v1/reporter/*', '/api/v1/reporting/kpis'), false);
  assert.equal(patternMatches('/*', '/anything/at/all'), true);
  assert.equal(patternMatches('*', '/anything'), true);
  assert.equal(patternMatches('/health', '/health'), true);
  assert.equal(patternMatches('/health', '/healthz'), false);
  assert.equal(concretePath('/a/:id/b/:other/*'), '/a/x/b/x/x');
});

test('the chain for a request is every ALL and same-method entry that matches, in order', () => {
  const routes = [
    { method: 'ALL', path: '/*', handler: plain },
    { method: 'ALL', path: '/api/v1/reporter/*', handler: guardTagged('reporter-secret') },
    { method: 'POST', path: '/api/v1/reporter/events', handler: plain },
    { method: 'GET', path: '/api/v1/reporter/events', handler: plain },
  ];
  const chain = handlerChain(routes, 'POST', '/api/v1/reporter/events');
  assert.deepEqual(
    chain.map((entry) => `${entry.method} ${entry.path}`),
    ['ALL /*', 'ALL /api/v1/reporter/*', 'POST /api/v1/reporter/events'],
  );
});

test('a tag is read from the handler, and only a string tag counts', () => {
  assert.equal(tagOf(guardTagged('runner-credential')), 'runner-credential');
  assert.equal(tagOf(plain), undefined);
  assert.equal(tagOf('not a function'), undefined);
  const wrong = () => undefined;
  Object.defineProperty(wrong, ACCESS_TAG, { value: 42 });
  assert.equal(tagOf(wrong), undefined);
});

test('middleware and tagged guards are not endpoints; a route with a path and a method is', () => {
  assert.equal(isEndpoint({ method: 'ALL', path: '/x', handler: plain }), false);
  assert.equal(isEndpoint({ method: 'GET', path: '/x/*', handler: plain }), false);
  assert.equal(
    isEndpoint({ method: 'POST', path: '/x', handler: guardTagged('runner-credential') }),
    false,
  );
  assert.equal(isEndpoint({ method: 'GET', path: '/x', handler: plain }), true);
});

test('access is read from the guards in the chain: none is open, a wildcard guard covers its subtree', () => {
  const routes = [
    { method: 'ALL', path: '/api/v1/reporter/*', handler: guardTagged('reporter-secret') },
    { method: 'POST', path: '/api/v1/reporter/events', handler: plain },
    {
      method: 'POST',
      path: '/api/v1/jobs/:jobId/complete',
      handler: guardTagged('runner-credential'),
    },
    { method: 'POST', path: '/api/v1/jobs/:jobId/complete', handler: plain },
    { method: 'GET', path: '/health', handler: plain },
  ];
  const rows = describeRoutes({ routes, tests: [] });
  /** @param {string} key */
  const access = (key) => rows.find((row) => `${row.method} ${row.path}` === key)?.access;
  assert.equal(access('POST /api/v1/reporter/events'), 'reporter-secret');
  assert.equal(access('POST /api/v1/jobs/:jobId/complete'), 'runner-credential');
  assert.equal(access('GET /health'), 'open');
  assert.equal(rows.length, 3, 'a guard and its endpoint on one path are one row');
});

test('two different guards on one route are both named', () => {
  const routes = [
    { method: 'ALL', path: '/a/*', handler: guardTagged('reporter-secret') },
    { method: 'POST', path: '/a/b', handler: guardTagged('runner-credential') },
    { method: 'POST', path: '/a/b', handler: plain },
  ];
  assert.equal(
    describeRoutes({ routes, tests: [] })[0]?.access,
    'reporter-secret+runner-credential',
  );
});

test('workspaceScoped is read from the endpoint code, and not from a guard', () => {
  const scoped = (/** @type {string} */ ws) => ws;
  assert.equal(namesWorkspace([scoped]), true);
  assert.equal(namesWorkspace([() => 'nothing here']), false);
  assert.equal(namesWorkspace(['not a function']), false);
});

test('evidence is the test that names the route most, preferring the API package', () => {
  const tests = [
    { path: 'tests/e2e/a.spec.ts', text: "get('/api/v1/runs/x'); get('/api/v1/runs/y');" },
    { path: 'apps/api/src/b.test.ts', text: 'request(`/api/v1/runs/${id}`)' },
    { path: 'apps/api/src/authz-matrix.test.ts', text: "'/api/v1/runs/x' x 9" },
    { path: 'apps/api/src/c.test.ts', text: "'/api/v1/runsx/1'" },
  ];
  assert.deepEqual(evidenceCandidates('/api/v1/runs/:runId', tests), [
    'apps/api/src/b.test.ts',
    'tests/e2e/a.spec.ts',
  ]);
  assert.deepEqual(evidenceCandidates('/api/v1/never', tests), []);
});

/** @type {import('./authz-matrix.mjs').Row} */
const ROW = {
  method: 'GET',
  path: '/a',
  access: 'open',
  workspaceScoped: false,
  evidenceTest: 'apps/api/src/a.test.ts',
  composition: 'always',
};
const TESTS = [{ path: 'apps/api/src/a.test.ts', text: "get('/a')" }];

test('a matrix that agrees with the application has no findings', () => {
  assert.deepEqual(compareMatrix([ROW], [ROW], TESTS), []);
});

test('a registered route with no row is a finding (the dummy-route case)', () => {
  const dummy = { ...ROW, path: '/dummy', evidenceTest: null };
  const findings = compareMatrix([ROW], [ROW, dummy], TESTS);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /GET \/dummy: registered \(open\) and has no row/);
});

test('a row for a route that is not registered is a finding', () => {
  const stale = { ...ROW, path: '/gone' };
  assert.match(
    compareMatrix([ROW, stale], [ROW], TESTS).join('\n'),
    /GET \/gone: in the matrix and not registered/,
  );
});

test('a row whose access disagrees with the application is a finding, in both directions', () => {
  const guarded = { ...ROW, access: 'runner-credential' };
  assert.match(
    compareMatrix([ROW], [guarded], TESTS).join('\n'),
    /access is "open" in the matrix and "runner-credential"/,
  );
  assert.match(
    compareMatrix([guarded], [ROW], TESTS).join('\n'),
    /access is "runner-credential" in the matrix and "open"/,
  );
});

test('workspaceScoped and composition disagreements are findings', () => {
  assert.match(
    compareMatrix([ROW], [{ ...ROW, workspaceScoped: true }], TESTS).join('\n'),
    /workspaceScoped/,
  );
  assert.match(
    compareMatrix([ROW], [{ ...ROW, composition: 'database' }], TESTS).join('\n'),
    /composition/,
  );
});

test('evidence is compared loosely: another test naming the route does not disturb a row', () => {
  const tests = [
    ...TESTS,
    { path: 'apps/api/src/z.test.ts', text: "get('/a'); get('/a'); get('/a')" },
  ];
  const fresh = { ...ROW, evidenceTest: 'apps/api/src/z.test.ts' };
  assert.deepEqual(compareMatrix([ROW], [fresh], tests), []);
});

test('evidence that no longer names the route is a finding', () => {
  const tests = [{ path: 'apps/api/src/a.test.ts', text: 'nothing relevant' }];
  assert.match(
    compareMatrix([ROW], [{ ...ROW, evidenceTest: null }], tests).join('\n'),
    /no longer names the route/,
  );
});

test('an application that registers nothing is a finding, not a clean matrix', () => {
  assert.deepEqual(compareMatrix([ROW], [], TESTS), ['the application registered no routes']);
});

test('a guarded route with no test is a finding; an open one without is not', () => {
  assert.deepEqual(unevidencedGuardedRoutes([{ ...ROW, evidenceTest: null }]), []);
  assert.match(
    unevidencedGuardedRoutes([{ ...ROW, access: 'reporter-secret', evidenceTest: null }]).join(''),
    /reporter-secret route with no test/,
  );
});

test('buildMatrix sorts and groups, and the summary counts by access class', () => {
  const rows = buildMatrix(
    [
      { routes: [{ method: 'GET', path: '/b', handler: plain }], composition: 'always' },
      { routes: [{ method: 'GET', path: '/a', handler: plain }], composition: 'database' },
    ],
    [],
  );
  assert.deepEqual(
    rows.map((row) => `${row.path}:${row.composition}`),
    ['/a:database', '/b:always'],
  );
  assert.deepEqual(summarise(rows), { open: 2 });
});

test('the committed matrix is well formed, and its classes are the ones the API can tag', () => {
  const matrix = JSON.parse(
    readFileSync(path.join(root, 'docs/quality/authz-matrix.json'), 'utf8'),
  );
  const source = readFileSync(path.join(root, 'apps/api/src/http/access.ts'), 'utf8');
  const declared = [
    ...(source.match(/GUARDED_ACCESS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);
  assert.ok(declared.length >= 4, 'could not read GUARDED_ACCESS from access.ts');
  const known = new Set([...declared, 'open']);
  const keys = new Set();
  for (const row of matrix.routes) {
    assert.ok(row.method && row.path.startsWith('/'), `${row.method} ${row.path}`);
    for (const part of String(row.access).split('+'))
      assert.ok(known.has(part), `${row.path}: unknown class ${part}`);
    assert.equal(typeof row.workspaceScoped, 'boolean');
    assert.ok(row.composition === 'always' || row.composition === 'database');
    const key = `${row.method} ${row.path}`;
    assert.ok(!keys.has(key), `${key} listed twice`);
    keys.add(key);
  }
  assert.deepEqual(
    matrix.summary,
    summarise(matrix.routes),
    'summary is not the count of the rows',
  );
  assert.deepEqual(unevidencedGuardedRoutes(matrix.routes), []);
});
