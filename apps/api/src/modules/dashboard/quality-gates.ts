/**
 * quality-gates.ts — the quality gate store and its routes.
 *
 * The body is validated by `CreateQualityGateBodySchema` rather than by three
 * hand-rolled field checks against an `as Record<string, unknown>` assertion. See
 * `schemas.ts`: an empty body used to throw out of the handler and surface as a 500,
 * and the assertion meant the "type" of the body was never actually checked.
 */

import { Hono } from 'hono';
import { DomainError } from '../../errors/domain-error.js';
import { randomUUID } from 'node:crypto';
import { InMemoryAuditSink, type AuditEntry, type WriteContext } from './audit-sink.js';
import { CreateQualityGateBodySchema } from './schemas.js';
import { currentRequestId } from '../../observability/request-context.js';

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

/** A gate as it arrives from a caller: no id, no timestamp. */
export type NewQualityGate = Omit<QualityGate, 'id' | 'createdAt'>;

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface QualityGateStore {
  list(): Promise<QualityGate[]>;
  add(gate: NewQualityGate, context?: WriteContext): Promise<QualityGate>;
  get(id: string): Promise<QualityGate | null>;
}

export class InMemoryQualityGateStore implements QualityGateStore {
  private readonly _gates = new Map<string, QualityGate>();

  constructor(private readonly audit: InMemoryAuditSink = new InMemoryAuditSink()) {}

  /** The creations this store recorded. Read by tests to assert attribution. */
  get recorded(): readonly AuditEntry[] {
    return this.audit.entries;
  }

  async list(): Promise<QualityGate[]> {
    return Array.from(this._gates.values());
  }

  async add(gate: NewQualityGate, context?: WriteContext): Promise<QualityGate> {
    const id = randomUUID();
    const g: QualityGate = {
      ...gate,
      id,
      createdAt: new Date().toISOString(),
    };
    this._gates.set(id, g);
    await this.audit.record({
      action: 'quality_gate.created',
      resourceType: 'quality_gate',
      resourceId: id,
      ...(context ?? { actorId: 'system', actorType: 'system' as const }),
      details: { name: gate.name, passRateThreshold: gate.passRateThreshold },
    });
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
  /**
   * Who to attribute a creation to. `'anonymous'` by default, which is what an
   * unauthenticated write is — a recorded value, not an omission.
   */
  contextFor?: (c: { req: { header(name: string): string | undefined } }) => WriteContext;
}

/**
 * The audit context for a write with no authenticated principal.
 *
 * The request is not an input: the id comes from the request context, so there is
 * nothing here for a caller to supply and nothing that can disagree (ledger O-1b).
 * Outside a request — a test, a background job — the id is absent rather than
 * invented, because a fabricated correlatable-looking id in an audit row is worse than
 * a missing one.
 */
function defaultContext(): WriteContext {
  return {
    actorId: 'anonymous',
    actorType: 'user',
    requestId: currentRequestId() ?? null,
  };
}

export function createDashboardQualityGatesRoutes(options: DashboardQualityGatesOptions): Hono {
  const app = new Hono();
  const contextFor = options.contextFor ?? defaultContext;

  // ── GET /api/v1/dashboard/quality-gates ──────────────────────────────────
  app.get('/api/v1/dashboard/quality-gates', async (c) => {
    const gates = await options.store.list();
    return c.json(gates);
  });

  // ── POST /api/v1/dashboard/quality-gates ─────────────────────────────────
  app.post('/api/v1/dashboard/quality-gates', async (c) => {
    // `.catch(() => null)`: `req.json()` throws on an empty or malformed body, and
    // the throw used to escape as a 500 — indistinguishable from a real fault, with
    // the validation below never having run.
    const body = await c.req.json().catch(() => null);
    const parsed = CreateQualityGateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('INVALID_QUALITY_GATE', 'Invalid quality gate', {
        details: { issues: parsed.error.issues },
      });
    }

    const gate = await options.store.add(parsed.data, contextFor(c));
    return c.json(gate, 201);
  });

  // ── GET /api/v1/dashboard/quality-gates/:id ──────────────────────────────
  app.get('/api/v1/dashboard/quality-gates/:id', async (c) => {
    const id = c.req.param('id');
    const gate = await options.store.get(id);
    if (!gate) {
      throw new DomainError('QUALITY_GATE_NOT_FOUND', 'Quality gate not found');
    }
    return c.json(gate);
  });

  return app;
}
