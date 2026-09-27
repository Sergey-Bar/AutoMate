/**
 * quality-gates.test.ts — the three `quality-gates.ts` routes:
 *
 *   GET  /api/v1/dashboard/quality-gates
 *   POST /api/v1/dashboard/quality-gates
 *   GET  /api/v1/dashboard/quality-gates/:id
 *
 * A gate is the threshold a run is measured against, so a gate that cannot be read
 * back is a threshold that silently does not apply. That is why the create response
 * and the `GET /:id` response are asserted to be the same object, and why the
 * `workspace_id` case is here at all — `quality_gate_config.workspace_id` is the
 * column a gate's *name* used to be written into, so "a caller may not set the
 * workspace through the body" is not a style preference here.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  createDashboardQualityGatesRoutes,
  InMemoryQualityGateStore,
  type QualityGate,
  type QualityGateStore,
} from './quality-gates.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A store for an installation that does not hold the gate being probed.
 *
 * `DrizzleQualityGateStore` deliberately leaves `workspace_id` unset — a gate the
 * dashboard creates is installation-scoped, not workspace-scoped — so "not mine" is
 * expressed as a store whose rows are empty, with the foreign row kept beside it so
 * a test can prove the probe did not reach it.
 */
class ScopedQualityGateStore implements QualityGateStore {
  readonly askedFor: string[] = [];

  constructor(readonly foreign: QualityGate[] = []) {}

  async list(): Promise<QualityGate[]> {
    return [];
  }

  async add(): Promise<QualityGate> {
    throw new Error('this installation cannot create a quality gate');
  }

  async get(id: string): Promise<QualityGate | null> {
    this.askedFor.push(id);
    return null;
  }
}

const FOREIGN_GATE: QualityGate = {
  id: 'theirs',
  name: 'their main gate',
  passRateThreshold: 99,
  createdAt: '2026-09-01T00:00:00.000Z',
};

function mount(store: QualityGateStore): Hono {
  return new Hono().route('/', createDashboardQualityGatesRoutes({ store }));
}

function build(): { app: Hono; store: InMemoryQualityGateStore } {
  const store = new InMemoryQualityGateStore();
  return { app: mount(store), store };
}

function post(app: Hono, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  // `app.request` is typed `Response | Promise<Response>`; the `async` wrapper is
  // what narrows it, and it costs nothing.
  return (async () =>
    app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }))();
}

async function createGate(app: Hono, name = 'Main branch gate'): Promise<QualityGate> {
  const response = await post(app, { name, passRateThreshold: 90 });
  expect(response.status).toBe(201);
  return (await response.json()) as QualityGate;
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/quality-gates
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/quality-gates', () => {
  it('lists the gates an operator has configured', async () => {
    const { app } = build();
    await createGate(app, 'Main');
    await createGate(app, 'Nightly');

    const response = await app.request('/api/v1/dashboard/quality-gates');

    expect(response.status).toBe(200);
    const body = (await response.json()) as QualityGate[];
    expect(body.map((gate) => [gate.name, gate.passRateThreshold])).toEqual([
      ['Main', 90],
      ['Nightly', 90],
    ]);
  });

  it('returns an empty array rather than 404 for an installation with none', async () => {
    const response = await mount(new InMemoryQualityGateStore()).request(
      '/api/v1/dashboard/quality-gates',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('does not list a gate belonging to another installation', async () => {
    const store = new ScopedQualityGateStore([FOREIGN_GATE]);

    const body = (await (
      await mount(store).request('/api/v1/dashboard/quality-gates')
    ).json()) as unknown;

    expect(body).toEqual([]);
    expect(store.foreign).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/dashboard/quality-gates
// ---------------------------------------------------------------------------

describe('POST /api/v1/dashboard/quality-gates', () => {
  it('creates the gate with an id and a creation time, and records who made it', async () => {
    const { app, store } = build();

    const response = await post(app, { name: 'Main branch gate', passRateThreshold: 90 });

    expect(response.status).toBe(201);
    const body = (await response.json()) as QualityGate;
    expect(body.id).not.toBe('');
    expect(body).toMatchObject({ name: 'Main branch gate', passRateThreshold: 90 });
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
    // A gate nobody can account for is the failure the audit table exists to prevent,
    // and the dashboard is an unauthenticated surface, so "anonymous" is a recorded
    // answer rather than an omission.
    expect(store.recorded.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['quality_gate.created', 'anonymous'],
    ]);
  });

  it('accepts the two threshold boundaries', async () => {
    const { app } = build();

    expect((await post(app, { name: 'Never fails', passRateThreshold: 0 })).status).toBe(201);
    expect((await post(app, { name: 'Impossible', passRateThreshold: 100 })).status).toBe(201);
  });

  it('rejects a body that is absent, is not JSON, or is not an object', async () => {
    const { app, store } = build();

    const absent = await app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const notJson = await post(app, 'not json at all');
    const notAnObject = await post(app, 'null');
    const anArray = await post(app, [{ name: 'Gate', passRateThreshold: 90 }]);

    // 400, not 500. An uncaught `req.json()` throw is a 500 the error boundary
    // cannot tell from a genuine fault.
    for (const response of [absent, notJson, notAnObject, anArray]) {
      expect(response.status).toBe(400);
    }
    expect(store.recorded).toHaveLength(0);
  });

  it('rejects a name that is missing, blank, or not a string', async () => {
    const { app, store } = build();

    for (const body of [
      { passRateThreshold: 90 },
      { name: '   ', passRateThreshold: 90 },
      { name: 42, passRateThreshold: 90 },
      { name: 'x'.repeat(201), passRateThreshold: 90 },
    ]) {
      const response = await post(app, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(store.recorded).toHaveLength(0);
  });

  it('rejects a threshold that is missing, not a number, or outside 0–100', async () => {
    const { app, store } = build();

    for (const body of [
      { name: 'Gate' },
      { name: 'Gate', passRateThreshold: 'ninety' },
      { name: 'Gate', passRateThreshold: -1 },
      { name: 'Gate', passRateThreshold: 101 },
      { name: 'Gate', passRateThreshold: Number.NaN },
      { name: 'Gate', passRateThreshold: Number.POSITIVE_INFINITY },
    ]) {
      const response = await post(app, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(store.recorded).toHaveLength(0);
  });

  it('rejects a body carrying workspaceId, which is how a gate got a name once', async () => {
    // `quality_gate_config.workspace_id` used to hold the gate's display name, and
    // `list()` read the name back out of it — so every gate was scoped to a
    // workspace that did not exist. `.strict()` is what stops a caller writing that
    // column through the body.
    const { app, store } = build();

    const response = await post(app, {
      name: 'Main branch gate',
      passRateThreshold: 90,
      workspaceId: 'workspace-other-install',
    });

    expect(response.status).toBe(400);
    expect(store.recorded).toHaveLength(0);
  });

  it('names the field that was wrong, rather than only that something was', async () => {
    const { app } = build();

    const body = (await (await post(app, { name: 'Gate', passRateThreshold: 101 })).json()) as {
      error: string;
      issues: Array<{ path: unknown[] }>;
    };

    expect(body.error).toBe('Invalid quality gate');
    expect(body.issues.map((issue) => issue.path[0])).toContain('passRateThreshold');
  });

  it('attributes the creation to the request id it was given', async () => {
    const { app, store } = build();

    await post(app, { name: 'Gate', passRateThreshold: 90 }, { 'x-request-id': 'req-gate-1' });

    expect(store.recorded[0]).toMatchObject({ actorId: 'anonymous', requestId: 'req-gate-1' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/quality-gates/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/quality-gates/:id', () => {
  it('returns the gate that was created, unchanged', async () => {
    const { app } = build();
    const created = await createGate(app, 'Release gate');

    const response = await app.request(`/api/v1/dashboard/quality-gates/${created.id}`);

    // The create response and the read response are the same object. A gate that is
    // created one thing and read back as another is a threshold nobody can rely on.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(created);
  });

  it('returns a distinct gate per id', async () => {
    const { app } = build();
    const first = await createGate(app, 'First');
    const second = await createGate(app, 'Second');

    expect(first.id).not.toBe(second.id);
    const body = (await (
      await app.request(`/api/v1/dashboard/quality-gates/${second.id}`)
    ).json()) as QualityGate;
    expect(body.name).toBe('Second');
  });

  it('answers 404 for an id that was never created', async () => {
    const { app } = build();

    const response = await app.request('/api/v1/dashboard/quality-gates/no-such-gate');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Quality gate not found' });
  });

  it('answers 404 for an id that could not exist, without a stack trace', async () => {
    const { app } = build();

    for (const id of ['not-a-uuid', '%2e%2e%2fadmin', 'a'.repeat(400)]) {
      const response = await app.request(`/api/v1/dashboard/quality-gates/${id}`);
      expect(response.status, id.slice(0, 24)).toBe(404);
      expect(await response.text()).not.toContain('at ');
    }
  });

  it('hides a gate belonging to another installation behind the same 404', async () => {
    const store = new ScopedQualityGateStore([FOREIGN_GATE]);
    const app = mount(store);

    const response = await app.request('/api/v1/dashboard/quality-gates/theirs');

    // 404, not 403: a 403 would confirm the id exists here.
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Quality gate not found' });
    expect(store.askedFor).toEqual(['theirs']);
  });
});
