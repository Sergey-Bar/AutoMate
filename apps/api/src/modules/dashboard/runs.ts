/**
 * runs.ts — Dashboard run detail and status-patch routes
 *
 * GET   /api/v1/dashboard/runs/:id        — retrieve a single run record
 * PATCH /api/v1/dashboard/runs/:id/status — update a run's status field
 */
import { Hono } from 'hono';
import { PERSISTED_RUN_STATUS_VALUES } from '@automate/shared-contracts';
import {
  toPersistedStatus,
  type RunRepository,
  type RunStatus,
} from '../../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DashboardRunsOptions {
  repository: RunRepository;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

// Derived from the contract, so a status cannot be accepted here and then
// rejected by `runs_status_check` — the two lists differed by `queued` until now.
const VALID_STATUSES: RunStatus[] = [...PERSISTED_RUN_STATUS_VALUES];

export function createDashboardRunsRoutes(options: DashboardRunsOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/dashboard/runs/:id ────────────────────────────────────────
  app.get('/api/v1/dashboard/runs/:id', async (c) => {
    const id = c.req.param('id');
    const run = await options.repository.getRun(id);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }
    return c.json(run);
  });

  // ── PATCH /api/v1/dashboard/runs/:id/status ───────────────────────────────
  app.patch('/api/v1/dashboard/runs/:id/status', async (c) => {
    const id = c.req.param('id');

    const run = await options.repository.getRun(id);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    const { status } = body;

    if (typeof status !== 'string' || !VALID_STATUSES.includes(status as RunStatus)) {
      return c.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }

    // Narrowed rather than cast: `VALID_STATUSES` is the persisted subset, and
    // the cast is what previously let a wider status reach a column that refuses
    // it. `toPersistedStatus` reports anything the column will not store.
    await options.repository.patchRun(id, { status: toPersistedStatus(status as RunStatus) });
    const updated = await options.repository.getRun(id);
    return c.json(updated);
  });

  return app;
}
