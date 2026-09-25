/**
 * registry.ts — Connector registry with health checks
 *
 * GET /api/v1/connectors        — list all registered connectors with status
 * GET /api/v1/connectors/:id/health — health check (returns status, never leaks credentials)
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type ConnectorType = 'github' | 'jira' | 'slack' | 'sql';
export type ConnectorStatus = 'configured' | 'not_configured' | 'error';

export interface ConnectorEntry {
  id: string;
  name: string;
  type: ConnectorType;
  status: ConnectorStatus;
  createdAt: string; // ISO-8601
  /** Optional metadata — NEVER stores credentials */
  description: string | null;
}

export interface ConnectorHealthResult {
  id: string;
  name: string;
  type: ConnectorType;
  status: ConnectorStatus;
  checkedAt: string; // ISO-8601
  /** Human-readable message (no credential data) */
  message: string | null;
}

export interface ConnectorRegistry {
  list(): ConnectorEntry[];
  get(id: string): ConnectorEntry | undefined;
  register(entry: Omit<ConnectorEntry, 'id' | 'createdAt'>): ConnectorEntry;
  updateStatus(id: string, status: ConnectorStatus): boolean;
  remove(id: string): boolean;
}

export class InMemoryConnectorRegistry implements ConnectorRegistry {
  private readonly _connectors = new Map<string, ConnectorEntry>();

  list(): ConnectorEntry[] {
    return Array.from(this._connectors.values());
  }

  get(id: string): ConnectorEntry | undefined {
    return this._connectors.get(id);
  }

  register(entry: Omit<ConnectorEntry, 'id' | 'createdAt'>): ConnectorEntry {
    const id = randomUUID();
    const connector: ConnectorEntry = {
      ...entry,
      id,
      createdAt: new Date().toISOString(),
    };
    this._connectors.set(id, connector);
    return connector;
  }

  updateStatus(id: string, status: ConnectorStatus): boolean {
    const existing = this._connectors.get(id);
    if (!existing) return false;
    this._connectors.set(id, { ...existing, status });
    return true;
  }

  remove(id: string): boolean {
    return this._connectors.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface ConnectorRegistryOptions {
  registry: ConnectorRegistry;
}

const VALID_TYPES: ConnectorType[] = ['github', 'jira', 'slack', 'sql'];

export function createConnectorRegistryRoutes(options: ConnectorRegistryOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/connectors ───────────────────────────────────────────────
  app.get('/api/v1/connectors', (c) => {
    return c.json(options.registry.list());
  });

  // ── POST /api/v1/connectors ──────────────────────────────────────────────
  app.post('/api/v1/connectors', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const { name, type, description } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }
    if (typeof type !== 'string' || !(VALID_TYPES as string[]).includes(type)) {
      return c.json(
        { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
        400,
      );
    }

    const connector = options.registry.register({
      name: name.trim(),
      type: type as ConnectorType,
      status: 'not_configured',
      description: typeof description === 'string' ? description : null,
    });

    return c.json(connector, 201);
  });

  // ── GET /api/v1/connectors/:id/health ────────────────────────────────────
  app.get('/api/v1/connectors/:id/health', (c) => {
    const id = c.req.param('id');
    const connector = options.registry.get(id);

    if (!connector) {
      return c.json({ error: 'Connector not found' }, 404);
    }

    const statusMessages: Record<ConnectorStatus, string> = {
      configured: 'Connector is configured and operational',
      not_configured: 'Connector has no credentials configured',
      error: 'Connector configuration error — check credentials',
    };

    const result: ConnectorHealthResult = {
      id: connector.id,
      name: connector.name,
      type: connector.type,
      status: connector.status,
      checkedAt: new Date().toISOString(),
      message: statusMessages[connector.status],
    };

    return c.json(result);
  });

  // ── DELETE /api/v1/connectors/:id ────────────────────────────────────────
  app.delete('/api/v1/connectors/:id', (c) => {
    const id = c.req.param('id');
    const removed = options.registry.remove(id);
    if (!removed) {
      return c.json({ error: 'Connector not found' }, 404);
    }
    return c.json({ removed: true });
  });

  return app;
}
