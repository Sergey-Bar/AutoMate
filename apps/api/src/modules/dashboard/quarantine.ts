/**
 * quarantine.ts — In-memory quarantine store and routes
 *
 * GET    /api/v1/dashboard/quarantine      — list quarantined tests
 * POST   /api/v1/dashboard/quarantine      — add a test to quarantine
 * DELETE /api/v1/dashboard/quarantine/:id  — remove from quarantine
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface QuarantineEntry {
  id: string;
  testTitle: string;
  testFile: string;
  reason: string | null;
  quarantinedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface QuarantineStore {
  list(): Promise<QuarantineEntry[]>;
  add(entry: Omit<QuarantineEntry, 'id' | 'quarantinedAt'>): Promise<QuarantineEntry>;
  remove(id: string): Promise<boolean>;
}

/**
 * In-memory (transient) implementation of QuarantineStore.
 * State is lost when the process restarts. For production, replace with a
 * Drizzle-backed implementation that persists to Postgres.
 */
export class InMemoryQuarantineStore implements QuarantineStore {
  private readonly _entries = new Map<string, QuarantineEntry>();

  async list(): Promise<QuarantineEntry[]> {
    return Array.from(this._entries.values());
  }

  async add(entry: Omit<QuarantineEntry, 'id' | 'quarantinedAt'>): Promise<QuarantineEntry> {
    const id = randomUUID();
    const e: QuarantineEntry = {
      ...entry,
      id,
      quarantinedAt: new Date().toISOString(),
    };
    this._entries.set(id, e);
    return e;
  }

  async remove(id: string): Promise<boolean> {
    return this._entries.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface DashboardQuarantineOptions {
  store: QuarantineStore;
}

export function createDashboardQuarantineRoutes(options: DashboardQuarantineOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/dashboard/quarantine ─────────────────────────────────────
  app.get('/api/v1/dashboard/quarantine', async (c) => {
    const entries = await options.store.list();
    return c.json(entries);
  });

  // ── POST /api/v1/dashboard/quarantine ────────────────────────────────────
  app.post('/api/v1/dashboard/quarantine', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const { testTitle, testFile, reason } = body;

    if (typeof testTitle !== 'string' || !testTitle) {
      return c.json({ error: 'testTitle is required' }, 400);
    }
    if (typeof testFile !== 'string' || !testFile) {
      return c.json({ error: 'testFile is required' }, 400);
    }

    const entry = await options.store.add({
      testTitle,
      testFile,
      reason: typeof reason === 'string' ? reason : null,
    });

    return c.json(entry, 201);
  });

  // ── DELETE /api/v1/dashboard/quarantine/:id ───────────────────────────────
  app.delete('/api/v1/dashboard/quarantine/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await options.store.remove(id);
    if (!removed) {
      return c.json({ error: 'Quarantine entry not found' }, 404);
    }
    return c.json({ removed: true });
  });

  return app;
}
