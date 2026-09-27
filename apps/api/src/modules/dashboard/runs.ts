/**
 * runs.ts — Dashboard run detail and status-patch routes
 *
 * GET   /api/v1/dashboard/runs/:id        — retrieve a single run record
 * PATCH /api/v1/dashboard/runs/:id/status — update a run's status field
 */
import { Hono } from 'hono';
import { PERSISTED_RUN_STATUS_VALUES } from '@automate/shared-contracts';
import type { RunRepository } from '../../repositories/run-repository.js';
import { PatchRunStatusBodySchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DashboardRunsOptions {
  repository: RunRepository;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

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

    // `.catch(() => null)` and a schema, not `(await c.req.json()) as
    // Record<string, unknown>` with a hand-rolled field check. `req.json()`
    // **throws** on an empty or malformed body, and the throw used to escape the
    // handler — so `PATCH` with no body at all was a 500 the error boundary could
    // not tell from a real fault, with the validation below it never having run.
    // That is the defect `schemas.ts` was written to undo for the two write
    // routes beside this one; this was the one it missed.
    // `.catch(() => null)` and a schema, not `(await c.req.json()) as
    // Record<string, unknown>` with a hand-rolled field check. `req.json()`
    // **throws** on an empty or malformed body, and the throw used to escape the
    // handler — so `PATCH` with no body at all was a 500 the error boundary could
    // not tell from a real fault, with the validation below it never having run.
    // That is the defect `schemas.ts` was written to undo for the two write
    // routes beside this one; this was the one it missed.
    const parsed = PatchRunStatusBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: `Invalid status. Must be one of: ${PERSISTED_RUN_STATUS_VALUES.join(', ')}`,
          issues: parsed.error.issues,
        },
        400,
      );
    }

    // `parsed.data.status` is already the persisted subset, because the schema is
    // built from `PERSISTED_RUN_STATUS_VALUES`. That is what `toPersistedStatus`
    // used to be called for here, and the assertion it needed is now the schema's
    // — so no cast can widen a status past the column between the check and the
    // write.
    await options.repository.patchRun(id, { status: parsed.data.status });
    const updated = await options.repository.getRun(id);
    return c.json(updated);
  });

  return app;
}
