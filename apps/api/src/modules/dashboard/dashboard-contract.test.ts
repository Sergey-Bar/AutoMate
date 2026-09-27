import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDashboardQuarantineRoutes, InMemoryQuarantineStore } from './quarantine.js';
import { createDashboardQualityGatesRoutes, InMemoryQualityGateStore } from './quality-gates.js';
import { canTransitionQuarantine, QUARANTINE_STATUSES, QUARANTINE_TRANSITIONS } from './schemas.js';

/**
 * The dashboard's write boundary, at the route.
 *
 * Two properties that neither the store tests nor the pre-existing route tests
 * could have established:
 *
 * 1. **A body that is not there is a 400, not a 500.** Every dashboard write used
 *    `const body = (await c.req.json()) as Record<string, unknown>`. `req.json()`
 *    *throws* on an empty body, and nothing caught it, so `POST` with no body
 *    escaped the handler as an unhandled rejection that the error boundary rendered
 *    as a 500 — indistinguishable from a genuine fault, and the field checks below
 *    it never ran. The status is asserted here because the boundary is not mounted
 *    in this app: what is being proven is that the handler *answers*.
 *
 * 2. **A decision is attributed.** `audit_events` had no writer anywhere in the
 *    repository. Approving a quarantine removes a test from the pass rate, which
 *    changes whether a release looks green, and nothing recorded who decided that.
 */

function buildApp(store: InMemoryQuarantineStore, gates: InMemoryQualityGateStore): Hono {
  const app = new Hono();
  app.route('/', createDashboardQuarantineRoutes({ store }));
  app.route('/', createDashboardQualityGatesRoutes({ store: gates }));
  return app;
}

function build(): { app: Hono; store: InMemoryQuarantineStore; gates: InMemoryQualityGateStore } {
  const store = new InMemoryQuarantineStore();
  const gates = new InMemoryQualityGateStore();
  return { app: buildApp(store, gates), store, gates };
}

async function addEntry(app: Hono, title = 'flaky login'): Promise<string> {
  const res = await app.request('/api/v1/dashboard/quarantine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testTitle: title, testFile: 'e2e/login.spec.ts', reason: 'CI' }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe('dashboard write bodies', () => {
  it('answers 400, not 500, for a POST with no body at all', async () => {
    const { app } = build();

    const res = await app.request('/api/v1/dashboard/quality-gates', { method: 'POST' });

    expect(res.status).toBe(400);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const { app } = build();

    const res = await app.request('/api/v1/dashboard/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });

    expect(res.status).toBe(400);
  });

  it('answers 400 for a JSON body of the wrong shape', async () => {
    const { app } = build();

    const notANumber = await app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 5, passRateThreshold: 'ninety' }),
    });
    const outOfRange = await app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gate', passRateThreshold: 101 }),
    });
    const unexpectedField = await app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gate', passRateThreshold: 90, workspaceId: 'ws-a' }),
    });

    expect(notANumber.status).toBe(400);
    expect(outOfRange.status).toBe(400);
    // `.strict()`, so a caller cannot smuggle a field the API ignores — which is how
    // `workspace_id` ended up holding a gate's name in the first place.
    expect(unexpectedField.status).toBe(400);
  });

  it('reports which field was wrong, rather than only that something was', async () => {
    const { app } = build();

    const res = await app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passRateThreshold: 90 }),
    });
    const body = (await res.json()) as { issues: Array<{ path: unknown[] }> };

    expect(body.issues.map((issue) => issue.path[0])).toContain('name');
  });
});

describe('quarantine decisions', () => {
  it('lists the status, because a quarantine nobody can see the state of cannot be acted on', async () => {
    const { app } = build();
    await addEntry(app);

    const res = await app.request('/api/v1/dashboard/quarantine');
    const body = (await res.json()) as Array<{ status: string }>;

    expect(body).toHaveLength(1);
    expect(body[0]?.status).toBe('pending');
  });

  it('approves a pending entry and records who decided', async () => {
    const { app, store } = build();
    const id = await addEntry(app);

    const res = await app.request(`/api/v1/dashboard/quarantine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', resolution: 'fixed in #412' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('approved');
    const decision = store.recorded.find((entry) => entry.action === 'quarantine.approved');
    expect(decision).toBeDefined();
    expect(decision?.details).toMatchObject({ from: 'pending', to: 'approved' });
  });

  it('answers 409 when the entry is already decided, and names the states it may take', async () => {
    const { app } = build();
    const id = await addEntry(app);
    const approve = (status: string) =>
      app.request(`/api/v1/dashboard/quarantine/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution: 'because' }),
      });

    await approve('rejected');
    const res = await approve('approved');

    // 409 and not 400: the request was well formed and the resource exists, but its
    // current state forbids the move. Resending the same body cannot fix it.
    expect(res.status).toBe(409);
    const body = (await res.json()) as { from: string; to: string; allowed: string[] };
    expect(body.from).toBe('rejected');
    expect(body.to).toBe('approved');
    expect(body.allowed).toEqual(['rejected']);
  });

  it('refuses to re-open an entry through the body, before any store call', async () => {
    const { app } = build();
    const id = await addEntry(app);

    const res = await app.request(`/api/v1/dashboard/quarantine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending', resolution: 'undecided again' }),
    });

    // `pending` is the state an entry *starts* in. Accepting it as a destination
    // would make a resolved entry pending again with no record of the decision that
    // was reversed — and the column has no history to report it from.
    expect(res.status).toBe(400);
  });

  it('requires a resolution, because approving removes a test from the pass rate', async () => {
    const { app } = build();
    const id = await addEntry(app);

    const res = await app.request(`/api/v1/dashboard/quarantine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });

    expect(res.status).toBe(400);
  });

  it('answers 404 for a decision about an entry that does not exist', async () => {
    const { app } = build();

    const res = await app.request('/api/v1/dashboard/quarantine/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', resolution: 'fixed' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('the transition rule', () => {
  it('permits a decision only out of pending, and never back into it', () => {
    expect(canTransitionQuarantine('pending', 'approved')).toBe(true);
    expect(canTransitionQuarantine('pending', 'rejected')).toBe(true);
    // A no-op to the same state is allowed, so a retried request is not an error.
    expect(canTransitionQuarantine('pending', 'pending')).toBe(true);
    expect(canTransitionQuarantine('approved', 'rejected')).toBe(false);
    expect(canTransitionQuarantine('rejected', 'approved')).toBe(false);
    expect(canTransitionQuarantine('approved', 'pending')).toBe(false);
  });

  it('permits no state out of itself, and names every state exactly once', () => {
    for (const status of QUARANTINE_STATUSES) {
      expect(QUARANTINE_TRANSITIONS[status], `no transition table for ${status}`).toBeDefined();
    }
    expect([...new Set(QUARANTINE_STATUSES)].sort()).toEqual([...QUARANTINE_STATUSES].sort());
  });
});

describe('attribution', () => {
  it('records an anonymous dashboard write as anonymous, rather than omitting it', async () => {
    const { app, gates } = build();

    const res = await app.request('/api/v1/dashboard/quality-gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-42' },
      body: JSON.stringify({ name: 'Main gate', passRateThreshold: 90 }),
    });

    expect(res.status).toBe(201);
    // A row naming a session that never existed would be worse than one admitting
    // nobody was: "who did this" has to have an answer, even when the answer is
    // "nobody we can identify".
    expect(gates.recorded[0]).toMatchObject({
      actorId: 'anonymous',
      requestId: 'req-42',
      action: 'quality_gate.created',
    });
  });
});
