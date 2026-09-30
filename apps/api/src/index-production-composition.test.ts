import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbSchema from '@automate/db';
import {
  syntheticApiKey,
  syntheticAwsKeyId,
  syntheticConnectionString,
  syntheticCookieSecret,
  syntheticInstallationKey,
  syntheticReporterSecret,
  syntheticRunnerRegistrationSecret,
  syntheticVaultSecret,
} from './test-support/synthetic-credentials.js';

// Production composition must fail at the policy gate, before any database
// client, in-memory fallback, or secret literal is constructed. The module is
// imported dynamically with a production environment so module scope — not a
// test-visible function — is what is exercised.
const original = { ...process.env };

/**
 * A budget for a file whose cost is one module import.
 *
 * `refuses to compose without a cookie secret` imports the entire API graph for the
 * first time, and it takes about **2 seconds** with nothing else running. Under
 * `pnpm verify` — turbo running twenty package suites in parallel — that first
 * import was measured at **37 seconds**, and it blew the package's 30s
 * `testTimeout`, failing a test whose subject is a fail-closed startup policy.
 *
 * That is the shape of a gate nobody can trust: it reports a policy failure for a
 * reason that has nothing to do with the policy, so the response is to rerun it, and
 * a gate that must be rerun is a gate that provides nothing. The package default is
 * right for the PGlite suites and is left alone; this file is given its own budget
 * because its cost is a *cold transform of the composition root*, which no amount of
 * fixture work will make cheap.
 *
 * 120s is headroom, not a target. If this ever genuinely needs 120s, something has
 * started importing more than the composition root.
 *
 * The budget is on the **test** and on the `beforeAll` that imports, not on
 * `vi.setConfig`. `vi.setConfig({ testTimeout })` in a `beforeAll` does not reliably
 * override a value the config file already set for the file, and the failure it
 * produced looked like an assertion failure rather than a budget problem.
 * 180s is headroom for a 1.6s operation, not a target: if this ever genuinely needs
 * 180s, something has started importing more than the composition root.
 */
const COMPOSITION_IMPORT_TIMEOUT_MS = 180_000;

/**
 * A budget for a file whose cost is one module import.
 *
 * `refuses to compose without a cookie secret` imports the entire API graph for the
 * first time, and it takes about **2 seconds** with nothing else running. Under
 * `pnpm verify` — turbo running twenty package suites in parallel — that first
 * import was measured at **37 seconds**, and it blew the package's 30s
 * `testTimeout`, failing a test whose subject is a fail-closed startup policy.
 *
 * That is the shape of a gate nobody can trust: it reports a policy failure for a
 * reason that has nothing to do with the policy, so the response is to rerun it, and
 * a gate that must be rerun is a gate that provides nothing. The package default is
 * right for the PGlite suites and is left alone; this file is given its own budget
 * because its cost is a *cold transform of the composition root*, which no amount of
 * fixture work will make cheap.
 *
 * 120s is headroom, not a target. If this ever genuinely needs 120s, something has
 * started importing more than the composition root.
 */
beforeAll(() => {
  vi.setConfig({ testTimeout: 120_000 });
});

const VALID_SECRETS = {
  // All assembled, and all audited in `test-support/synthetic-credentials.test.ts`.
  // Two of these were hand-written at 22 and 27 characters, which is under the floor
  // every secret now has — so the composition test was asserting a startup a
  // deployment cannot have, and it passed only because nothing compared it to the
  // policy it was standing in for.
  COOKIE_SECRET: syntheticCookieSecret(),
  REPORTER_SECRET: syntheticReporterSecret(),
  // gitleaks's `generic-api-key` rule matches these two names regardless of the
  // value, and a literal here is a credential-shaped string committed to the
  // repository for a secret scanner to find.
  AUTOMATE_API_KEY: syntheticApiKey(),
  VAULT_SECRET: syntheticVaultSecret(),
  RUNNER_REGISTRATION_SECRET: syntheticRunnerRegistrationSecret(),
  // Required in production since ledger P-72b: the API will not derive an
  // installation key, so a production composition has to present one. Without this
  // the whole suite refused to boot — which is the refusal working.
  AUTOMATE_INSTALLATION_KEY: syntheticInstallationKey(),
};

const OBJECT_STORE = {
  OBJECT_STORE_ENDPOINT: 'https://objects.example.com',
  OBJECT_STORE_BUCKET: 'automate-artifacts',
  OBJECT_STORE_REGION: 'eu-central-1',
  OBJECT_STORE_ACCESS_KEY_ID: syntheticAwsKeyId(),
  OBJECT_STORE_SECRET_ACCESS_KEY: 'object-store-secret-long-enough',
};

function productionEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env['NODE_ENV'] = 'production';
  for (const key of [
    'COOKIE_SECRET',
    'SESSION_SECRET',
    'REPORTER_SECRET',
    'AUTOMATE_API_KEY',
    'AUTOMATE_INSTALLATION_KEY',
    'VAULT_SECRET',
    'RUNNER_REGISTRATION_SECRET',
    'DATABASE_URL',
    'WORKSPACE_ID',
    ...Object.keys(OBJECT_STORE),
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, VALID_SECRETS);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

/**
 * The real migration graph, in journal order, as one script.
 *
 * The same reader `errors/db-error-classification.test.ts` uses, restated because
 * `tests/integration` is not a dependency of `apps/api`.
 */
function readMigrations(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

/** A canonical run result, for the ingestion assertions below. */
function canonicalResult(workspaceId: string): Record<string, unknown> {
  const digest = 'b'.repeat(64);
  return {
    contractVersion: '2',
    identity: { runId: 'run-production-composition', workspaceId },
    status: 'passed',
    startedAt: '2026-09-25T00:00:00.000Z',
    attempts: [
      {
        index: 1,
        testId: 'test-1',
        specPath: 'tests/example.spec.ts',
        title: 'example',
        status: 'passed',
        rawStatus: 'passed',
        startedAt: '2026-09-25T00:00:00.000Z',
        evidence: [],
        flakiness: 'unknown',
      },
    ],
    steps: [],
    evidence: [],
    provenance: {
      producer: 'playwright',
      producerVersion: '1.0.0',
      adapterVersion: '1.0.0',
      sourceDigest: digest,
      sourceUri: 'artifact://run-production-composition/report.json',
    },
    retention: { class: 'standard' },
    proof: { state: 'verified', digest, verifier: 'test' },
    completeness: { state: 'complete', missingShards: [], duplicateShards: [] },
    raw: {},
  };
}

describe('production composition', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
  });

  afterAll(() => {
    // Restore the package default, so no suite that runs after this one inherits a
    // budget it did not ask for. (The per-test timeout above is independent of this and
    // does not need restoring — which is the point of using it.)
    vi.setConfig({ testTimeout: 30_000 });
  });

  // The budget is on the **test**, not on `vi.setConfig` in a `beforeAll`.
  //
  // This file failed intermittently under `pnpm verify` and not once in four
  // consecutive isolated runs of the package, so the cost is contention, not logic.
  // The first `import('./index.js')` is a cold transform of the whole API graph, and
  // that cost is what `COMPOSITION_IMPORT_TIMEOUT_MS` above pays for.
  it(
    'refuses to compose without a cookie secret',
    async () => {
      productionEnv({ COOKIE_SECRET: undefined });
      await expect(import('./index.js')).rejects.toThrow('COOKIE_SECRET is required in production');
    },
    COMPOSITION_IMPORT_TIMEOUT_MS,
  );

  it('refuses to compose without a database url', async () => {
    productionEnv();
    await expect(import('./index.js')).rejects.toThrow('DATABASE_URL is required in production');
  });

  it(
    'refuses to compose in production without an operator-provided installation key',
    async () => {
      // Ledger P-72b. `ensureBootstrap` ran on every boot that had a database,
      // production included, and inserted a credential derived from a default
      // `installationKey` that lives in the repository — so a production
      // deployment grew a key nobody chose, on first boot, silently.
      //
      // The whole suite failing to compose until a key was added to `VALID_SECRETS`
      // is the refusal working, and this is the assertion that says so: a
      // deployment must be given a key rather than being issued one.
      // A `DATABASE_URL` is supplied because the database policy gate runs first —
      // without one the composition fails on that instead, and the test would be
      // asserting the wrong refusal. Unreachable is deliberate: the guard this test
      // is about runs *before* a connection is attempted, so a refused import means
      // the refusal fired rather than that the connection did.
      productionEnv({
        DATABASE_URL: 'postgres://127.0.0.1:1/unreachable',
        ...OBJECT_STORE,
        AUTOMATE_INSTALLATION_KEY: undefined,
      });
      await expect(import('./index.js')).rejects.toThrow(
        /AUTOMATE_INSTALLATION_KEY is required in production/,
      );
    },
    COMPOSITION_IMPORT_TIMEOUT_MS,
  );

  it('refuses an unreachable database url before any in-memory fallback is used', async () => {
    // If composition ran ahead of the policy gate, the import would fail on the
    // database connection (or fall back to in-memory stores) instead.
    productionEnv({
      DATABASE_URL: 'postgres://127.0.0.1:1/unreachable',
      REPORTER_SECRET: undefined,
    });
    await expect(import('./index.js')).rejects.toThrow('REPORTER_SECRET is required in production');
  });

  it('refuses to compose without a durable artifact object store', async () => {
    // Fully valid secrets and a database url: the only remaining gate is the
    // object store, which must fail before the database is contacted and before
    // any local-filesystem artifact store is composed.
    productionEnv({ DATABASE_URL: 'postgres://127.0.0.1:1/unreachable' });
    await expect(import('./index.js')).rejects.toThrow(
      'artifact bytes must be stored in a durable object store',
    );
  });

  it('refuses a half-configured object store at startup', async () => {
    productionEnv({
      DATABASE_URL: 'postgres://127.0.0.1:1/unreachable',
      ...OBJECT_STORE,
      OBJECT_STORE_SECRET_ACCESS_KEY: undefined,
    });
    await expect(import('./index.js')).rejects.toThrow(
      'Object store configuration is incomplete; set OBJECT_STORE_SECRET_ACCESS_KEY',
    );
  });
});

/**
 * The other half of the story: a configuration that *is* valid must compose.
 *
 * Everything above is a refusal, and a suite of refusals cannot fail in the way a
 * composition does. A policy gate that throws correctly while the happy path throws
 * too is a product that only starts when it is misconfigured — the failure mode a
 * startup gate is least likely to be suspected of, because the gate looks like it
 * is working.
 *
 * **What is real here and what is not.** The composition root, the startup policy,
 * `getConfig`, every route factory, the auth middleware, the error boundary and the
 * database itself are all real: PGlite is the same SQL engine the production
 * Postgres is, running the real migration graph, and `identity.integration.test.ts`
 * already drives `DrizzleInstallationKeyStore` against it. Two things are substituted,
 * and only because there is no alternative in-process:
 *
 * 1. `createDbResources` returns a PGlite-backed client instead of a `pg.Pool`. A
 *    `pg.Pool` needs a TCP Postgres, and this repository has no Postgres in CI and
 *    no PGlite-to-TCP bridge in its dependency set. What is being tested is
 *    everything *above* the socket, and that is the composition.
 * 2. `serve` is a no-op, because `index.ts` binds a real listener as an import side
 *    effect. A test that bound one would leave a port open for the rest of the run.
 *
 * Neither substitution is a stub of a *decision*: nothing below `pg.Pool` decides
 * anything this test asserts. The assertions read the database back directly, so a
 * store that was composed but not wired would show up as a missing row rather than
 * as a passing mock.
 */
describe('a valid production configuration', () => {
  const WORKSPACE = 'workspace-production-composition';
  const API_KEY = syntheticApiKey();
  const REPORTER_SECRET = VALID_SECRETS.REPORTER_SECRET;

  let client: PGlite | undefined;
  let composed: typeof import('./index.js') | undefined;

  beforeAll(async () => {
    client = new PGlite();
    await client.exec(readMigrations());
    const database = client;

    // Registered before the import below, which is the whole point: `doMock` is
    // hoisted per-call, so it must run inside the hook rather than at file scope.
    vi.doMock('@hono/node-server', () => ({ serve: () => undefined }));
    vi.doMock('@automate/db', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@automate/db')>();
      return {
        ...actual,
        createDbResources: () => ({
          db: drizzle(database, { schema: dbSchema }),
          close: async () => undefined,
        }),
      };
    });

    // Every gate satisfied at once, which is the whole point: the refusals above are
    // each about one missing piece, and none of them says what happens when nothing
    // is missing.
    productionEnv({
      DATABASE_URL: syntheticConnectionString(),
      WORKSPACE_ID: WORKSPACE,
      ...OBJECT_STORE,
    });
    composed = await import('./index.js');
  }, COMPOSITION_IMPORT_TIMEOUT_MS);

  afterAll(async () => {
    vi.doUnmock('@automate/db');
    vi.doUnmock('@hono/node-server');
    await client?.close();
    client = undefined;
  });

  /** The composed app, with the credential a production caller must present. */
  function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!composed) throw new Error('the composition root was never imported');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${API_KEY}`);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    // `app.request` is typed `Response | Promise<Response>`; the `async` wrapper is
    // what narrows it, and it costs nothing.
    return (async () => composed?.app.request(path, { ...init, headers }))();
  }

  it('composes, and exports a fetchable app and a durable execution store', () => {
    expect(composed).toBeDefined();
    expect(typeof composed?.app.fetch).toBe('function');
    // Exported so the worker can be pointed at the same store. A composition that
    // built one and did not export it would leave the worker on a different one.
    expect(composed?.executionStore).toBeDefined();
  });

  it('answers liveness and readiness, with readiness proved by a real query', async () => {
    const live = await request('/api/v1/health');
    const ready = await request('/ready');
    const versionedReady = await request('/api/v1/ready');

    expect(live.status).toBe(200);
    // `checkDatabase` runs `SELECT 1` against the composed client, and the bootstrap
    // install row was written by the composition root's own module-scope await. A
    // 200 here is a database that answered.
    expect(ready.status).toBe(200);
    expect(versionedReady.status).toBe(200);
    const readyBody = await ready.json();
    expect(readyBody).toEqual({ status: 'ready', service: 'automate-api' });
    // Both readiness paths, byte for byte: a container runtime and a load balancer
    // configured with different ones must not be reading different contracts.
    expect(await versionedReady.json()).toEqual(readyBody);
  });

  it('bootstraps the installation key in the database, not in the process', async () => {
    // `index.ts` awaits `ensureBootstrap` at module scope, deriving the hash from
    // the configured cookie secret. A composition that reached the listener without
    // writing this row would have no installation identity to authenticate against.
    const rows = await client?.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM installation_keys',
    );
    expect(rows?.rows[0]?.count).toBe(1);
  });

  it('refuses the legacy process-local control plane', async () => {
    // The production branch of `mountLegacyProcessLocalRoutes`, reachable only from a
    // composition that got past every policy gate. Process-local automations and
    // schedules look like they work and survive nothing.
    for (const path of ['/api/v1/automations', '/api/v1/schedules', '/api/v1/jobs']) {
      const response = await request(path);
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toMatchObject({
        status: 'unavailable',
        code: 'PROCESS_LOCAL_CONTROL_DISABLED',
      });
    }
  });

  it('writes a dashboard mutation to the database, not to a process-local store', async () => {
    const created = await request('/api/v1/dashboard/quarantine', {
      method: 'POST',
      body: JSON.stringify({
        testTitle: 'flaky login',
        testFile: 'e2e/auth/login.spec.ts',
        reason: 'network timeout',
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string; status: string };
    expect(entry.status).toBe('pending');

    // Read past the API, straight out of the database. Production policy refuses the
    // in-memory store outright, so a row here is the only way a composition that
    // wired the Drizzle store could have produced it — and an in-memory store would
    // have made the composition throw rather than answer.
    const rows = await client?.query<{ test_title: string; status: string }>(
      'SELECT test_title, status FROM quarantine WHERE id = $1',
      [entry.id],
    );
    expect(rows?.rows).toEqual([{ test_title: 'flaky login', status: 'pending' }]);

    // And it comes back through the API, from that row.
    const listed = await request('/api/v1/dashboard/quarantine');
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: entry.id, testTitle: 'flaky login' }),
    ]);
  });

  it('ingests a canonical result only with the reporter secret, into the database', async () => {
    const body = JSON.stringify(canonicalResult(WORKSPACE));
    const unauthenticated = await composed?.app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(unauthenticated?.status).toBe(401);

    const accepted = await composed?.app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${REPORTER_SECRET}` },
      body,
    });
    expect(accepted?.status).toBe(202);

    // The durable ingestion service composed, and scoped the row to `WORKSPACE_ID` —
    // the only tenancy boundary in the product.
    const rows = await client?.query<{ run_id: string; workspace_id: string }>(
      'SELECT run_id, workspace_id FROM canonical_run_results WHERE run_id = $1',
      ['run-production-composition'],
    );
    expect(rows?.rows).toEqual([{ run_id: 'run-production-composition', workspace_id: WORKSPACE }]);
  });

  it('refuses a canonical result whose identity names another workspace', async () => {
    // The same boundary, from the other direction: a result claiming somebody else's
    // workspace is a conflict, and nothing about it is written.
    const response = await composed?.app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${REPORTER_SECRET}` },
      body: JSON.stringify(canonicalResult('workspace-somebody-else')),
    });

    expect(response?.status).toBe(409);
    const rows = await client?.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM canonical_run_results WHERE workspace_id = $1',
      ['workspace-somebody-else'],
    );
    expect(rows?.rows[0]?.count).toBe(0);
  });
});
