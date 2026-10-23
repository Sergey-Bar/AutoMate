import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  syntheticReporterSecret,
  syntheticRunnerRegistrationSecret,
} from './test-support/synthetic-credentials.js';

/**
 * The authz matrix against the running application.
 *
 * `docs/quality/authz-matrix.json` says, for every route the composed API registers, who may
 * call it. This file is what makes that more than a document:
 *
 *  - the committed matrix is compared with the routes the composed app actually registers, so
 *    a route added without a row, or a guard added or dropped, fails here;
 *  - every guarded route is sent a request with **no** credential and a **wrong** one and
 *    must refuse it with 401 or 403, and is sent a **right** one and must not;
 *  - every open route is sent a request with no credential and must not be refused for want of
 *    one.
 *
 * The access class comes from the guard tagged onto the route (`http/access.ts`), so the
 * class and the behaviour are two readings of the same code, compared. A route whose guard
 * stops refusing, or a refusal that is not a guard, makes the two disagree.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface Row {
  method: string;
  path: string;
  access: string;
  workspaceScoped: boolean;
  evidenceTest: string | null;
  composition: string;
}
interface RegisteredRoute {
  method: string;
  path: string;
  handler: unknown;
}
interface TestFile {
  path: string;
  text: string;
}
interface Lib {
  buildMatrix: (
    groups: Array<{ routes: readonly RegisteredRoute[]; composition: string }>,
    tests: readonly TestFile[],
  ) => Row[];
  compareMatrix: (committed: Row[], generated: Row[], tests: readonly TestFile[]) => string[];
  concretePath: (pattern: string) => string;
  unevidencedGuardedRoutes: (rows: Row[]) => string[];
}

const MATRIX_RUNNER = 'authz-matrix-runner';
const REPORTER_SECRET = syntheticReporterSecret();
const REGISTRATION_SECRET = syntheticRunnerRegistrationSecret();

let app: Hono;
let lib: Lib;
let committed: Row[];
let tests: TestFile[];
let projectRoutes: RegisteredRoute[];

beforeAll(async () => {
  // Read at import by the composition root, so they are set before it is imported.
  process.env['REPORTER_SECRET'] = REPORTER_SECRET;
  process.env['RUNNER_REGISTRATION_SECRET'] = REGISTRATION_SECRET;
  lib = (await import(pathToFileURL(path.join(root, 'scripts/lib/authz-matrix.mjs')).href)) as Lib;
  ({ app } = (await import('./index.js')) as unknown as { app: Hono });
  // The groups `index.ts` mounts only with a database. Constructing one reads no option.
  const projects = await import('./routes/projects.js');
  projectRoutes = (
    projects.createProjectsRoutes({} as never) as unknown as { routes: RegisteredRoute[] }
  ).routes;
  committed = (
    JSON.parse(readFileSync(path.join(root, 'docs/quality/authz-matrix.json'), 'utf8')) as {
      routes: Row[];
    }
  ).routes;
  // Only the files the matrix names are needed to check that its evidence still names a route.
  tests = [
    ...new Set(committed.map((row) => row.evidenceTest).filter((file) => file !== null)),
  ].map((file) => ({ path: file, text: readFileSync(path.join(root, file), 'utf8') }));
});

afterAll(() => {
  delete process.env['REPORTER_SECRET'];
  delete process.env['RUNNER_REGISTRATION_SECRET'];
});

const registered = (hono: Hono): RegisteredRoute[] =>
  (hono as unknown as { routes: RegisteredRoute[] }).routes;

function generate(extra?: Hono): Row[] {
  const composed = extra ?? app;
  return lib.buildMatrix(
    [
      { routes: registered(composed), composition: 'always' },
      { routes: projectRoutes, composition: 'database' },
    ],
    tests,
  );
}

describe('the committed matrix and the composed application agree', () => {
  it('has a row for every registered route, and no row for a route that is not registered', () => {
    expect(lib.compareMatrix(committed, generate(), tests)).toEqual([]);
  });

  it('names a test for every guarded route', () => {
    expect(lib.unevidencedGuardedRoutes(committed)).toEqual([]);
  });

  it('classifies at least the four credentials the API demands, and some open routes', () => {
    const classes = new Set(committed.map((row) => row.access));
    for (const access of [
      'open',
      'reporter-secret',
      'runner-registration-secret',
      'runner-credential',
      'enrollment-token',
    ]) {
      expect(classes).toContain(access);
    }
  });

  it('fails when a route is registered with no row', () => {
    const dummy: RegisteredRoute = {
      method: 'GET',
      path: '/api/v1/dummy-added-without-a-row',
      handler: () => new Response('hi'),
    };
    const rows = lib.buildMatrix(
      [
        { routes: [...registered(app), dummy], composition: 'always' },
        { routes: projectRoutes, composition: 'database' },
      ],
      tests,
    );
    const findings = lib.compareMatrix(committed, rows, tests);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/GET \/api\/v1\/dummy-added-without-a-row.*no row/);
  });

  it('fails when a guarded route loses its guard', () => {
    // The same method and path as a guarded route, mounted without the guard.
    const downgraded = new Hono();
    downgraded.post('/api/v1/jobs/:jobId/complete', (c) => c.text('no guard'));
    const rows = lib.buildMatrix(
      [{ routes: registered(downgraded), composition: 'always' }],
      tests,
    );
    const findings = lib.compareMatrix(
      committed.filter((row) => row.path === '/api/v1/jobs/:jobId/complete'),
      rows,
      tests,
    );
    expect(findings.join('\n')).toMatch(/access is "runner-credential" in the matrix and "open"/);
  });
});

/**
 * A request that carries nothing: no cookie, no header, an empty JSON object. `:runnerId` is
 * filled with the registered runner so a route that also checks the path against the token is
 * asked the question this file means to ask.
 */
function probe(row: Row, headers: Record<string, string> = {}): Promise<Response> {
  const url = `http://localhost${lib.concretePath(row.path.replace(':runnerId', MATRIX_RUNNER))}`;
  const hasBody = row.method !== 'GET' && row.method !== 'DELETE';
  const body =
    row.access === 'enrollment-token'
      ? JSON.stringify({ enrollmentToken: 'not-a-token-anybody-issued', capabilities: [] })
      : '{}';
  return Promise.resolve(
    app.request(url, {
      method: row.method,
      headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(hasBody ? { body } : {}),
    }),
  );
}

async function statusOf(response: Response): Promise<number> {
  // An event stream never ends; the status is all that was asked.
  await response.body?.cancel();
  return response.status;
}

const REFUSED = [401, 403];

describe('every guarded route refuses a caller with no credential, and a wrong one', () => {
  const guarded = (): Row[] =>
    committed.filter((row) => row.access !== 'open' && row.composition === 'always');

  it('refuses with 401 or 403 when nothing is presented', async () => {
    const answers: Array<[string, number]> = [];
    for (const row of guarded()) {
      answers.push([`${row.method} ${row.path} (${row.access})`, await statusOf(await probe(row))]);
    }
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.filter(([, status]) => !REFUSED.includes(status))).toEqual([]);
  });

  it('refuses with 401 or 403 when a wrong bearer credential is presented', async () => {
    const answers: Array<[string, number]> = [];
    for (const row of guarded().filter((entry) => entry.access !== 'enrollment-token')) {
      const response = await probe(row, {
        authorization: 'Bearer a-credential-nobody-issued',
        'x-runner-registration-secret': 'a-secret-nobody-configured',
      });
      answers.push([`${row.method} ${row.path} (${row.access})`, await statusOf(response)]);
    }
    expect(answers.filter(([, status]) => !REFUSED.includes(status))).toEqual([]);
  });

  it('lets a reporter secret through the reporter routes, and not the runner ones', async () => {
    for (const row of guarded().filter((entry) => entry.access === 'reporter-secret')) {
      const status = await statusOf(
        await probe(row, { authorization: `Bearer ${REPORTER_SECRET}` }),
      );
      // Past the guard, the empty body is refused for being empty; that is not an authz answer.
      expect(REFUSED, `${row.method} ${row.path}`).not.toContain(status);
    }
    const complete = guarded().find((row) => row.path === '/api/v1/jobs/:jobId/complete');
    expect(complete).toBeDefined();
    expect(
      await statusOf(await probe(complete as Row, { authorization: `Bearer ${REPORTER_SECRET}` })),
    ).toBe(401);
  });

  it('lets the registration secret register a runner, whose token then opens the runner routes', async () => {
    const registerRow = committed.find((row) => row.access === 'runner-registration-secret');
    expect(registerRow).toBeDefined();
    const registered = await app.request(`http://localhost${(registerRow as Row).path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-registration-secret': REGISTRATION_SECRET,
      },
      body: JSON.stringify({
        runnerId: MATRIX_RUNNER,
        manifest: { id: MATRIX_RUNNER, name: 'matrix', capabilities: [], labels: [] },
      }),
    });
    expect(registered.status).toBeLessThan(300);
    const { token } = (await registered.json()) as { token: string };
    expect(typeof token).toBe('string');

    for (const row of guarded().filter(
      (entry) => entry.access === 'runner-credential' && entry.path.startsWith('/api/v1/'),
    )) {
      if (row.path.startsWith('/api/v1/runner/v1/')) continue; // the legacy door has its own tokens
      const status = await statusOf(await probe(row, { authorization: `Bearer ${token}` }));
      expect(REFUSED, `${row.method} ${row.path}`).not.toContain(status);
    }
  });
});

/**
 * Open routes that answer 401 by design. They are the credential exchange itself: they answer
 * about the caller's own session, and gate no data. Each is listed with its reason rather than
 * skipped, so a new route cannot hide in the list unremarked.
 */
const ANSWERS_ABOUT_THE_CALLERS_OWN_SESSION: ReadonlySet<string> = new Set([
  'POST /api/v1/auth/login',
  'GET /api/v1/auth/session',
  'POST /api/v1/auth/logout',
]);

describe('every open route answers a caller with no credential', () => {
  it('does not refuse for want of a credential', async () => {
    const answers: Array<[string, number]> = [];
    for (const row of committed.filter(
      (entry) => entry.access === 'open' && entry.composition === 'always',
    )) {
      const key = `${row.method} ${row.path}`;
      if (ANSWERS_ABOUT_THE_CALLERS_OWN_SESSION.has(key)) continue;
      answers.push([key, await statusOf(await probe(row))]);
    }
    expect(answers.length).toBeGreaterThan(30);
    expect(answers.filter(([, status]) => REFUSED.includes(status))).toEqual([]);
  });

  it('keeps the exemption list to routes that exist and are open', () => {
    for (const key of ANSWERS_ABOUT_THE_CALLERS_OWN_SESSION) {
      const row = committed.find((entry) => `${entry.method} ${entry.path}` === key);
      expect(row?.access, key).toBe('open');
    }
  });
});
