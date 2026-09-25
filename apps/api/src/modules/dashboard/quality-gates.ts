/**
 * quality-gates.ts — In-memory quality gate store and routes
 *
 * GET  /api/v1/dashboard/quality-gates      — list all quality gates
 * POST /api/v1/dashboard/quality-gates      — create a quality gate
 * GET  /api/v1/dashboard/quality-gates/:id  — get a single quality gate
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface QualityGate {
  id: string;
  name: string;
  /** Required pass rate (0–100) for a run to pass this gate */
  passRateThreshold: number;
  createdAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface QualityGateStore {
  list(): Promise<QualityGate[]>;
  add(gate: Omit<QualityGate, 'id' | 'createdAt'>): Promise<QualityGate>;
  get(id: string): Promise<QualityGate | null>;
}

export class InMemoryQualityGateStore implements QualityGateStore {
  private readonly _gates = new Map<string, QualityGate>();

  async list(): Promise<QualityGate[]> {
    return Array.from(this._gates.values());
  }

  async add(gate: Omit<QualityGate, 'id' | 'createdAt'>): Promise<QualityGate> {
    const id = randomUUID();
    const g: QualityGate = {
      ...gate,
      id,
      createdAt: new Date().toISOString(),
    };
    this._gates.set(id, g);
    return g;
  }

  async get(id: string): Promise<QualityGate | null> {
    return this._gates.get(id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface DashboardQualityGatesOptions {
  store: QualityGateStore;
}

export function createDashboardQualityGatesRoutes(options: DashboardQualityGatesOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/dashboard/quality-gates ──────────────────────────────────
  app.get('/api/v1/dashboard/quality-gates', async (c) => {
    const gates = await options.store.list();
    return c.json(gates);
  });

  // ── POST /api/v1/dashboard/quality-gates ─────────────────────────────────
  app.post('/api/v1/dashboard/quality-gates', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const { name, passRateThreshold } = body;

    if (typeof name !== 'string' || !name) {
      return c.json({ error: 'name is required' }, 400);
    }
    if (
      typeof passRateThreshold !== 'number' ||
      passRateThreshold < 0 ||
      passRateThreshold > 100
    ) {
      return c.json(
        { error: 'passRateThreshold must be a number between 0 and 100' },
        400,
      );
    }

    const gate = await options.store.add({ name, passRateThreshold });
    return c.json(gate, 201);
  });

  // ── GET /api/v1/dashboard/quality-gates/:id ──────────────────────────────
  app.get('/api/v1/dashboard/quality-gates/:id', async (c) => {
    const id = c.req.param('id');
    const gate = await options.store.get(id);
    if (!gate) {
      return c.json({ error: 'Quality gate not found' }, 404);
    }
    return c.json(gate);
  });

  return app;
}
