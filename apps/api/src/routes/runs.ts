/**
 * runs.ts — GET /api/v1/runs route
 *
 * Returns all persisted run records from the RunRepository.
 * Consumes the same RunRepository instance shared with the reporter ingestion
 * route, so runs appear immediately after a reporter event is accepted.
 */
import { Hono } from 'hono';
import type { RunRepository } from '../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Route factory options
// ---------------------------------------------------------------------------

export interface RunsRouteOptions {
  /**
   * Persistence seam — must be the same repository instance wired into the
   * reporter routes so runs are visible immediately after ingestion.
   */
  repository: RunRepository;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Creates the runs listing Hono app.
 *
 * @param options  Route configuration, including the persistence repository.
 */
export function createRunsRoutes(options: RunsRouteOptions): Hono {
  const app = new Hono();

  // ------------------------------------------------------------------
  // GET /api/v1/runs — list all run records (versioned canonical path)
  // ------------------------------------------------------------------
  app.get('/api/v1/runs', async (c) => {
    const runs = await options.repository.listRuns();
    return c.json(runs);
  });

  return app;
}
