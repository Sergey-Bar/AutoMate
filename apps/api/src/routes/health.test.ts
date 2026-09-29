import { describe, expect, it } from 'vitest';
import { createHealthRoutes } from './health.js';
import { createAgentRoutes } from './agents.js';
import { AGENT_DOMAINS } from './agent-registry.js';
import { syntheticConnectionString } from '../test-support/synthetic-credentials.js';

/**
 * The readiness endpoints, and the alias between them.
 *
 * `/ready` and `/api/v1/ready` are the same handler registered twice, which is the
 * cheapest kind of surface to get wrong: a divergence between them is invisible
 * from either one, and the two are read by different things — a container runtime
 * configured with one path and a load balancer with the other. So both are asked,
 * on every case, and the answers are compared rather than asserted separately.
 *
 * A readiness response is also the most widely-read body in the product, because it
 * is what a probe logs and what a dashboard shows when the API will not take
 * traffic. That is why nothing derived from a failure may appear in it.
 */
const READY_PATHS = ['/ready', '/api/v1/ready'] as const;

describe('health and readiness routes', () => {
  it('keeps liveness public and gates readiness on the database', async () => {
    const app = createHealthRoutes();
    const live = await app.request('/api/v1/health');
    expect(live.status).toBe(200);
    expect((await live.json()) as { status: string }).toMatchObject({ status: 'healthy' });
    const notReady = await app.request('/api/v1/ready');
    expect(notReady.status).toBe(503);
    expect((await notReady.json()) as { status: string }).toMatchObject({ status: 'not_ready' });

    const ready = createHealthRoutes({
      databaseUrl: 'postgres://ready',
      checkDatabase: async () => undefined,
    });
    const response = await ready.request('/api/v1/ready');
    expect(response.status).toBe(200);
    expect((await response.json()) as { status: string }).toMatchObject({ status: 'ready' });
  });

  it('answers liveness without a database, on both paths', async () => {
    // Liveness and readiness are different questions. A probe asking "is the process
    // wedged" must not be refused because Postgres is down, or a transient database
    // outage restarts every replica at once.
    const app = createHealthRoutes({ databaseUrl: undefined });

    for (const path of ['/health', '/api/v1/health']) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        status: 'healthy',
        service: 'automate-api',
      });
    }
  });

  it('states the contract version on /api/v1/health only, on purpose', async () => {
    // The two liveness paths are *not* interchangeable, and the difference is
    // deliberate: the versioned one is what a client parses. Stated here so that
    // harmonising them is a decision somebody makes rather than a diff.
    const app = createHealthRoutes();

    const plain = (await (await app.request('/health')).json()) as Record<string, unknown>;
    const versioned = (await (await app.request('/api/v1/health')).json()) as Record<
      string,
      unknown
    >;

    expect(plain['version']).toBeUndefined();
    expect(versioned['version']).toBe('1');
  });
});

describe('the readiness alias', () => {
  it('answers both paths identically when the database is reachable', async () => {
    const app = createHealthRoutes({
      databaseUrl: 'postgres://automate:secret@db.internal:5432/automate',
      checkDatabase: async () => undefined,
    });

    const bodies: Array<{ path: string; status: number; body: unknown }> = [];
    for (const path of READY_PATHS) {
      const response = await app.request(path);
      bodies.push({ path, status: response.status, body: await response.json() });
    }

    // A byte-for-byte comparison, not "both are 200": a readiness body that differed
    // between the two paths would leave whichever consumer reads the other one
    // deciding on a shape it was never given.
    expect(bodies[0]?.status).toBe(200);
    expect(bodies[1]?.status).toBe(200);
    expect(bodies[1]?.body).toEqual(bodies[0]?.body);
    expect(bodies[0]?.body).toEqual({ status: 'ready', service: 'automate-api' });
  });

  it('answers both paths identically when the database check fails', async () => {
    const app = createHealthRoutes({
      databaseUrl: 'postgres://automate:secret@db.internal:5432/automate',
      checkDatabase: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
      },
    });

    for (const path of READY_PATHS) {
      const response = await app.request(path);
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toEqual({
        status: 'not_ready',
        reason: 'database is unavailable',
      });
    }
  });

  it('answers both paths identically when no database url is configured', async () => {
    const app = createHealthRoutes({ databaseUrl: undefined });

    for (const path of READY_PATHS) {
      const response = await app.request(path);
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toEqual({
        status: 'not_ready',
        reason: 'DATABASE_URL is not configured',
      });
    }
  });

  it('probes the database once per request, and only when a url is configured', async () => {
    // Two probes would double the connection cost of every readiness tick, and the
    // composition root injects `checkDatabase` precisely so a probe does not build a
    // fresh pool per call.
    let probes = 0;
    const app = createHealthRoutes({
      databaseUrl: 'postgres://automate@db.internal:5432/automate',
      checkDatabase: async () => {
        probes += 1;
      },
    });

    for (const path of READY_PATHS) await app.request(path);
    expect(probes).toBe(2);

    probes = 0;
    const unconfigured = createHealthRoutes({
      databaseUrl: undefined,
      checkDatabase: async () => {
        probes += 1;
      },
    });
    await unconfigured.request('/ready');
    expect(probes).toBe(0);
  });

  it('does not probe the database when the health routes are asked instead', async () => {
    let probes = 0;
    const app = createHealthRoutes({
      databaseUrl: 'postgres://automate@db.internal:5432/automate',
      checkDatabase: async () => {
        probes += 1;
      },
    });

    for (const path of ['/health', '/api/v1/health', '/api/v1/features']) {
      expect((await app.request(path)).status, path).toBe(200);
    }
    expect(probes).toBe(0);
  });
});

describe('what a readiness response is allowed to say', () => {
  it('never leaks the connection string, the password, or the driver error', async () => {
    // A probe body is the most widely-read response in a deployment: it is what a
    // container runtime prints, what a load balancer surfaces, and what an operator
    // pastes into a ticket. A `pg` error carries the host, the port, the user and
    // often the database name, and the configured url carries the password outright.
    const connectionString = syntheticConnectionString();
    const driverMessage = `connect ECONNREFUSED 10.0.0.7:5432 (${connectionString})`;
    const app = createHealthRoutes({
      databaseUrl: connectionString,
      checkDatabase: async () => {
        throw new Error(driverMessage);
      },
    });

    for (const path of READY_PATHS) {
      const response = await app.request(path);
      const text = await response.text();

      expect(response.status, path).toBe(503);
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('postgres://');
      expect(text).not.toContain('10.0.0.7');
      expect(text).not.toContain('5432');
      expect(text).not.toContain('ECONNREFUSED');
      expect(text).not.toContain('db.internal');
      // The whole body, not a substring search: nothing derived from the failure.
      expect(JSON.parse(text)).toEqual({
        status: 'not_ready',
        reason: 'database is unavailable',
      });
    }
  });

  it('does not echo the configured url back when the check is refused for another reason', async () => {
    const app = createHealthRoutes({
      databaseUrl: syntheticConnectionString(),
      checkDatabase: async () => {
        throw new TypeError('cannot read properties of undefined (reading "then")');
      },
    });

    const text = await (await app.request('/ready')).text();

    // Not a database error either — a programming fault — and still reported as the
    // same opaque "the database is unavailable", so a defect in this file is not
    // published to every probe that reads it.
    expect(JSON.parse(text)).toEqual({ status: 'not_ready', reason: 'database is unavailable' });
  });

  it('carries no timestamp, so two healthy probes are byte-identical', async () => {
    // `/health` stamps a timestamp on purpose. Readiness does not: it is polled
    // every few seconds, and a changing body makes a probe's output impossible to
    // diff between the last good and the first bad one.
    const app = createHealthRoutes({
      databaseUrl: 'postgres://automate@db.internal:5432/automate',
      checkDatabase: async () => undefined,
    });

    const first = await (await app.request('/ready')).text();
    const second = await (await app.request('/api/v1/ready')).text();

    expect(first).toBe(second);
    expect(JSON.parse(first)).not.toHaveProperty('timestamp');
  });
});

describe('the capability manifest', () => {
  it('answers publicly, with the version and a derived feature set', async () => {
    const response = await createHealthRoutes().request('/api/v1/features');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      features: Record<string, boolean>;
      version: string;
    };
    expect(body.version).toBe('1');
    // Every domain the contract declares is advertised, and every one is reported
    // `false` — no domain has a configured execution adapter today.
    //
    // This was `toEqual({ features: {}, version: '1' })`: the empty object *was*
    // the assertion, so the endpoint was required to claim the platform had no
    // features while `/api/v1/agents` in the same process listed five agent
    // domains. A test encodes a defect just as effectively as code does.
    expect(Object.keys(body.features).sort()).toEqual(
      AGENT_DOMAINS.map((domain) => `agent.${domain}`).sort(),
    );
    expect(Object.values(body.features).every((available) => available === false)).toBe(true);
  });

  it('reports the same domains the agent routes serve', async () => {
    // The two endpoints used to disagree because each carried its own copy of the
    // answer. They read one registry now, and this is what says so.
    const features = (await (await createHealthRoutes().request('/api/v1/features')).json()) as {
      features: Record<string, boolean>;
    };
    const listed = (await (await createAgentRoutes().request('/api/v1/agents')).json()) as {
      integrations: Array<{ domain: string }>;
    };
    expect(
      Object.keys(features.features)
        .map((key) => key.replace('agent.', ''))
        .sort(),
    ).toEqual(listed.integrations.map((item) => item.domain).sort());
  });
});
