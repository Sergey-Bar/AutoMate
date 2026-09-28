/**
 * quarantine.test.ts — the four `quarantine.ts` routes:
 *
 *   GET    /api/v1/dashboard/quarantine
 *   POST   /api/v1/dashboard/quarantine
 *   PATCH  /api/v1/dashboard/quarantine/:id
 *   DELETE /api/v1/dashboard/quarantine/:id
 *
 * `dashboard-contract.test.ts` covers the decision rule and the attribution; this
 * file is the per-module HTTP surface, mounted over `createDashboardQuarantineRoutes`
 * alone, and adds the things a route-level view can see that a store-level one
 * cannot: which status code each failure gets, what a rejected id is told, and
 * whether a decision is applied or only reported.
 */
import { describe, expect, it } from 'vitest';
/**
 * The boundary's body, named.
 *
 * A cast to `Record<string, unknown>` can read any shape and so checks none, which is
 * how `body.error` stayed a bare string in this suite after the migration: the
 * assertion was satisfied by a field that no longer exists.
 */
interface BoundaryBody {
  /** The success shapes these same files read: `id`, `status`, `allowed`, `runs`. */
  [key: string]: unknown;
  error: {
    code: string;
    message: string;
    requestId: string;
    details: {
      issues: Array<{ path: unknown[]; message?: string }>;
      fieldErrors?: Record<string, unknown>;
      /** The statuses a client may ask for, rather than a sentence naming them. */
      allowed?: string[];
      /** How long to wait, rather than a sentence saying to try again. */
      retryAfterSeconds?: number;
      from?: string;
      to?: string;
    };
  };
}

import { withErrorBoundary } from '../../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import {
  createDashboardQuarantineRoutes,
  InMemoryQuarantineStore,
  type QuarantineEntry,
  type QuarantineStore,
} from './quarantine.js';
import type { ResolveQuarantineOutcome } from './drizzle-stores.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ENTRY = { testTitle: 'flaky login', testFile: 'e2e/auth/login.spec.ts' };

/**
 * A store for an installation that does not hold the entry being probed.
 *
 * `quarantine` has no `workspace_id` column, so a quarantine entry belongs to an
 * *installation*, not to a workspace. "Not mine" is therefore expressed as a store
 * whose listing is empty, while the row itself is kept in `foreign` so a test can
 * prove the probe did not touch it. The question the route has to answer is the
 * same one either way: given that the store will not disclose this id, does the
 * caller learn anything from the response?
 */
class ScopedQuarantineStore implements QuarantineStore {
  readonly askedToResolve: string[] = [];
  readonly askedToRemove: string[] = [];

  constructor(readonly foreign: QuarantineEntry[] = []) {}

  async list(): Promise<QuarantineEntry[]> {
    return [];
  }

  async add(): Promise<QuarantineEntry> {
    throw new Error('this installation cannot create a quarantine entry');
  }

  async remove(id: string): Promise<boolean> {
    this.askedToRemove.push(id);
    return false;
  }

  async resolve(id: string): Promise<ResolveQuarantineOutcome> {
    this.askedToResolve.push(id);
    return { kind: 'not_found' };
  }
}

const FOREIGN_ENTRY: QuarantineEntry = {
  id: 'theirs',
  testTitle: 'their flaky test',
  testFile: 'e2e/their.spec.ts',
  reason: null,
  quarantinedAt: '2026-09-01T00:00:00.000Z',
  status: 'pending',
};

function mount(store: QuarantineStore): Hono {
  return withErrorBoundary(createDashboardQuarantineRoutes({ store }));
}

function build(): { app: Hono; store: InMemoryQuarantineStore } {
  const store = new InMemoryQuarantineStore();
  return { app: mount(store), store };
}

function post(app: Hono, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  // `app.request` is typed `Response | Promise<Response>`; the `async` wrapper is
  // what narrows it, and it costs nothing.
  return (async () =>
    app.request('/api/v1/dashboard/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }))();
}

function patch(
  app: Hono,
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return (async () =>
    app.request(`/api/v1/dashboard/quarantine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }))();
}

function del(app: Hono, id: string): Promise<Response> {
  return (async () => app.request(`/api/v1/dashboard/quarantine/${id}`, { method: 'DELETE' }))();
}

async function addEntry(app: Hono, title = VALID_ENTRY.testTitle): Promise<string> {
  const response = await post(app, { ...VALID_ENTRY, testTitle: title });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/quarantine
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/quarantine', () => {
  it('returns the entries with the state each one stands in', async () => {
    const { app } = build();
    const id = await addEntry(app, 'first');
    await addEntry(app, 'second');
    await patch(app, id, { status: 'approved', resolution: 'fixed in #412' });

    const response = await app.request('/api/v1/dashboard/quarantine');

    expect(response.status).toBe(200);
    const body = (await response.json()) as QuarantineEntry[];
    expect(body.map((entry) => [entry.testTitle, entry.status]).sort()).toEqual([
      ['first', 'approved'],
      ['second', 'pending'],
    ]);
    expect(body[0]?.quarantinedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns an empty array rather than 404 for an installation with none', async () => {
    const response = await mount(new InMemoryQuarantineStore()).request(
      '/api/v1/dashboard/quarantine',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('does not list an entry that belongs to another installation', async () => {
    const store = new ScopedQuarantineStore([FOREIGN_ENTRY]);

    const body = (await (
      await mount(store).request('/api/v1/dashboard/quarantine')
    ).json()) as unknown;

    expect(body).toEqual([]);
    expect(store.foreign).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/dashboard/quarantine
// ---------------------------------------------------------------------------

describe('POST /api/v1/dashboard/quarantine', () => {
  it('creates the entry, attributes it, and starts it pending', async () => {
    const { app, store } = build();

    const response = await post(app, { ...VALID_ENTRY, reason: 'network timeout' });

    expect(response.status).toBe(201);
    const body = (await response.json()) as QuarantineEntry;
    expect(body).toMatchObject({ ...VALID_ENTRY, reason: 'network timeout', status: 'pending' });
    expect(body.id).not.toBe('');
    expect(Number.isNaN(Date.parse(body.quarantinedAt))).toBe(false);
    // `pending`, not `approved`: a fresh quarantine has not yet been decided on by
    // anybody, and defaulting it to the state that removes a test from the pass rate
    // would hide a test with no decision behind it.
    expect(store.recorded.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['quarantine.created', 'anonymous'],
    ]);
  });

  it('accepts a null reason as "no reason given" and keeps it null', async () => {
    const { app } = build();

    const body = (await (
      await post(app, { ...VALID_ENTRY, reason: null })
    ).json()) as QuarantineEntry;

    expect(body.reason).toBeNull();
  });

  it('rejects a body that is absent, is not JSON, or is not an object', async () => {
    const { app } = build();

    const absent = await app.request('/api/v1/dashboard/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const notJson = await post(app, 'not json at all');
    const notAnObject = await post(app, 'null');
    const anArray = await post(app, [VALID_ENTRY]);

    // 400, not 500: `req.json()` throws on an absent or malformed body, and an
    // uncaught throw here is a 500 indistinguishable from a real fault.
    for (const response of [absent, notJson, notAnObject, anArray]) {
      expect(response.status).toBe(400);
    }
  });

  it('rejects a body that is missing a required field, a blank one, or an unknown one', async () => {
    const { app } = build();

    const cases: unknown[] = [
      { testFile: VALID_ENTRY.testFile },
      { testTitle: VALID_ENTRY.testTitle },
      { ...VALID_ENTRY, testTitle: '   ' },
      { ...VALID_ENTRY, testFile: '' },
      { ...VALID_ENTRY, testTitle: 42 },
      { ...VALID_ENTRY, status: 'approved' },
      { ...VALID_ENTRY, quarantinedAt: '2026-01-01T00:00:00.000Z' },
    ];

    for (const body of cases) {
      const response = await post(app, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('names the field that was wrong, and keeps `status` out of a create', async () => {
    const { app } = build();

    const response = await post(app, { testFile: VALID_ENTRY.testFile });
    const body = (await response.json()) as BoundaryBody;

    expect(body.error.code).toBe('INVALID_QUARANTINE_ENTRY');
    expect(body.error.message).toBe('Invalid quarantine entry');
    expect(
      body.error.details.issues.map((issue) => String((issue as { path: unknown[] }).path[0])),
    ).toEqual(['testTitle']);
  });

  it('attributes the write to the request id it was given', async () => {
    const { app, store } = build();

    await post(app, VALID_ENTRY, { 'x-request-id': 'req-quarantine-1' });

    expect(store.recorded[0]).toMatchObject({
      actorId: 'anonymous',
      requestId: 'req-quarantine-1',
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/dashboard/quarantine/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/dashboard/quarantine/:id', () => {
  it('applies a decision and returns the entry in its new state', async () => {
    const { app } = build();
    const id = await addEntry(app);

    const response = await patch(app, id, {
      status: 'approved',
      resolution: 'fixed in #412',
      resolutionType: 'fixed',
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as QuarantineEntry).toMatchObject({
      id,
      status: 'approved',
      // The reason the test was quarantined is not replaced by the resolution: they
      // answer different questions.
      reason: null,
    });
  });

  it('records the decision, because approving removes a test from the pass rate', async () => {
    const { app, store } = build();
    const id = await addEntry(app);

    await patch(app, id, { status: 'rejected', resolution: 'genuinely broken' });

    expect(store.recorded.map((entry) => entry.action)).toEqual([
      'quarantine.created',
      'quarantine.rejected',
    ]);
    expect(store.recorded[1]?.details).toMatchObject({ from: 'pending', to: 'rejected' });
  });

  it('is idempotent: a retried identical decision is not an error and writes nothing new', async () => {
    const { app, store } = build();
    const id = await addEntry(app);
    const body = { status: 'approved', resolution: 'fixed in #412' };

    const first = await patch(app, id, body);
    const second = await patch(app, id, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // A retry must not append a second audit row claiming a decision that happened
    // once — "who decided this" is the question the table exists to answer.
    expect(store.recorded).toHaveLength(2);
  });

  it('refuses to re-open a decided entry, and says which states it may take', async () => {
    const { app, store } = build();
    const id = await addEntry(app);
    await patch(app, id, { status: 'rejected', resolution: 'genuinely broken' });

    const response = await patch(app, id, { status: 'approved', resolution: 'changed my mind' });

    // 409, not 400: the request was well formed and the entry exists, but its state
    // forbids the move. Resending the same body cannot fix it.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'INVALID_STATE_TRANSITION',
        message: 'Invalid quarantine transition',
        details: { from: 'rejected', to: 'approved', allowed: ['rejected'] },
      },
    });
    // Refused, not applied: the store still says `rejected` and recorded no second
    // decision.
    expect((await store.list())[0]?.status).toBe('rejected');
    expect(store.recorded).toHaveLength(2);
  });

  it('refuses `pending` as a destination, before it reaches the store', async () => {
    // `pending` is where an entry starts. Accepting it as a destination would put a
    // decided entry back to undecided with no record of the decision that was
    // reversed, and the column has no history to report it from.
    const { app, store } = build();
    const id = await addEntry(app);

    const response = await patch(app, id, { status: 'pending', resolution: 'undecided again' });

    expect(response.status).toBe(400);
    expect(store.recorded).toHaveLength(1);
  });

  it('requires a resolution, because the decision changes what the dashboard reports', async () => {
    const { app, store } = build();
    const id = await addEntry(app);

    for (const body of [{ status: 'approved' }, { status: 'approved', resolution: '  ' }]) {
      const response = await patch(app, id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(store.recorded).toHaveLength(1);
  });

  it('rejects a malformed or absent body, and an unknown field', async () => {
    const { app, store } = build();
    const id = await addEntry(app);

    const absent = await app.request(`/api/v1/dashboard/quarantine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    const notJson = await patch(app, id, 'not json at all');
    const unknownField = await patch(app, id, {
      status: 'approved',
      resolution: 'fixed',
      workspaceId: 'workspace-other',
    });
    const badType = await patch(app, id, {
      status: 'approved',
      resolution: 'fixed',
      resolutionType: 'eventually',
    });

    for (const response of [absent, notJson, unknownField, badType]) {
      expect(response.status).toBe(400);
    }
    expect(store.recorded).toHaveLength(1);
  });

  it('answers 404 for an entry that does not exist, and decides nothing', async () => {
    const { app, store } = build();

    const response = await patch(app, 'no-such-entry', {
      status: 'approved',
      resolution: 'fixed',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'QUARANTINE_ENTRY_NOT_FOUND', message: 'Quarantine entry not found' },
    });
    expect(store.recorded).toHaveLength(0);
  });

  it('will not decide an entry held by another installation, and says nothing about it', async () => {
    const store = new ScopedQuarantineStore([FOREIGN_ENTRY]);
    const app = mount(store);

    const response = await patch(app, 'theirs', { status: 'approved', resolution: 'fixed' });

    // 404, not 403: a 403 would confirm the id exists here.
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'QUARANTINE_ENTRY_NOT_FOUND', message: 'Quarantine entry not found' },
    });
    expect(store.askedToResolve).toEqual(['theirs']);
    // And the decision was not applied to somebody else's row.
    expect(store.foreign[0]).toEqual(FOREIGN_ENTRY);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/dashboard/quarantine/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/dashboard/quarantine/:id', () => {
  it('removes the entry and confirms it', async () => {
    const { app, store } = build();
    const id = await addEntry(app);

    const response = await del(app, id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(await store.list()).toEqual([]);
    expect(store.recorded.map((entry) => entry.action)).toEqual([
      'quarantine.created',
      'quarantine.removed',
    ]);
  });

  it('answers 404 for an id that is not there, and is idempotent-safe', async () => {
    const { app, store } = build();
    const id = await addEntry(app);

    expect((await del(app, id)).status).toBe(200);
    const second = await del(app, id);

    // The second delete removes nothing, so it says so. Reporting 200 for a delete
    // that removed nothing is how a caller comes to believe a test is back in the
    // pass rate.
    expect(second.status).toBe(404);
    expect(await second.json()).toMatchObject({
      error: { code: 'QUARANTINE_ENTRY_NOT_FOUND', message: 'Quarantine entry not found' },
    });
    expect(store.recorded.map((entry) => entry.action)).toEqual([
      'quarantine.created',
      'quarantine.removed',
    ]);
  });

  it('answers 404 for an id that could not exist, without a stack trace', async () => {
    const { app } = build();

    for (const id of ['not-a-uuid', '%2e%2e%2fadmin', 'a'.repeat(400)]) {
      const response = await del(app, id);
      expect(response.status, id.slice(0, 24)).toBe(404);
      expect(await response.text()).not.toContain('at ');
    }
  });

  it('will not remove an entry held by another installation', async () => {
    const store = new ScopedQuarantineStore([FOREIGN_ENTRY]);
    const app = mount(store);

    const response = await del(app, 'theirs');

    expect(response.status).toBe(404);
    expect(store.askedToRemove).toEqual(['theirs']);
    // A cross-installation delete must not be a delete.
    expect(store.foreign).toHaveLength(1);
  });
});
