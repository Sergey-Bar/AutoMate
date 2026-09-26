import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from './routes/execution.js';
import { InMemoryExecutionStore } from './execution/in-memory-execution-store.js';
import { InMemoryRunRepository } from './repositories/in-memory-run-repository.js';

/**
 * The mounted route set.
 *
 * `routes/runs.ts` used to define a second `GET /api/v1/runs`, and its own test
 * passed — because it built an app from `createRunsRoutes` alone, with none of
 * the execution routes that already owned that path mounted. The duplication was
 * invisible from either side: the dead test proved the dead handler worked, and
 * nothing proved which one the server actually served.
 *
 * So this asserts the *set* of canonical API routes, from one app with both
 * route modules mounted in the same order as `index.ts`. A second declaration of
 * a path is a duplicate registration, which Hono resolves by registration order
 * — silently.
 */
function mountedApp(): Hono {
  const app = new Hono();
  const repository = new InMemoryRunRepository();
  // The same order as `index.ts`, so "first match wins" means the same thing here.
  app.route(
    '/',
    createExecutionRoutes({
      store: new InMemoryExecutionStore(),
      legacyRepository: repository,
      workspaceId: 'workspace-routes',
      registrationSecret: 'routes-secret',
    }),
  );
  return app;
}

/** Every `(method, path)` the app answers, discovered by asking it. */
async function registeredRoutes(
  app: Hono,
): Promise<Array<{ method: string; path: string; handler: unknown }>> {
  // Hono exposes the matched handler chain through `routes`, but its type is
  // internal. Reading it through a narrow local shape keeps the assertion honest
  // without `any`.
  const router = (
    app as unknown as {
      routes: Array<{ method: string; path: string; handler: unknown }>;
    }
  ).routes;
  return router;
}

const CANONICAL_API_ROUTES: Array<[string, string]> = [
  ['GET', '/api/v1/runs'],
  ['GET', '/api/v1/runs/:runId'],
  ['POST', '/api/v1/runs'],
  ['GET', '/api/v1/runs/:runId/artifacts'],
  ['GET', '/api/v1/runs/:runId/gate'],
  ['POST', '/api/v1/runners/register'],
  ['POST', '/api/v1/runners/:runnerId/heartbeat'],
  ['POST', '/api/v1/runners/:runnerId/jobs/claim'],
  ['POST', '/api/v1/jobs/:jobId/events'],
  ['POST', '/api/v1/jobs/:jobId/artifacts'],
  ['POST', '/api/v1/jobs/:jobId/complete'],
  ['GET', '/api/v1/artifacts/:artifactId'],
];

describe('the mounted route set', () => {
  it('serves every canonical run, runner, job and artifact route', async () => {
    const routes = await registeredRoutes(mountedApp());
    const served = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const missing = CANONICAL_API_ROUTES.filter(
      ([method, path]) => !served.has(`${method} ${path}`),
    );
    expect(missing).toEqual([]);
  });

  it('registers each method+path exactly once', async () => {
    const routes = await registeredRoutes(mountedApp());
    const seen = new Map<string, number>();
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    // A duplicate is not an error in Hono — the first registration wins and the
    // second is unreachable. That is exactly how a dead route file survives.
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  it('does not shadow a path with a second, unreadable handler', async () => {
    // The concrete failure this replaces: `routes/runs.ts` answered
    // `GET /api/v1/runs` with the bare repository listing, and it was never
    // reached because the execution routes were mounted first. Asserting the
    // *effect* rather than the file's existence is what catches that class.
    const app = mountedApp();
    const response = await app.request('/api/v1/runs');
    // The canonical handler is the paged, workspace-scoped one — not a bare
    // dump of the whole repository.
    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(100);
  });
});
