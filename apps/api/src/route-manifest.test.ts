import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from './routes/execution.js';
import { createHealthRoutes } from './routes/health.js';
import { createReporterRoutes } from './routes/reporter.js';
import { createReporterResultsRoute } from './routes/reporter-results.js';
import { createReportingRoutes } from './routes/reporting.js';
import { createRunnerRoutes } from './routes/runner.js';
import { createOrchestrationRoutes } from './routes/orchestration.js';
import { createEventsRoutes } from './routes/events.js';
import { createAgentRoutes } from './routes/agents.js';
import { createAuthRoutes } from './routes/auth.js';
import { createDashboardModule } from './modules/dashboard/index.js';
import { InMemoryExecutionStore } from './execution/in-memory-execution-store.js';
import { InMemoryRunRepository } from './repositories/in-memory-run-repository.js';
import { ReporterIngestionService } from './services/reporter-ingestion.js';
import { InMemoryRealtimeBus } from './realtime/realtime-bus.js';
import { RunnerControlService } from './services/runner-control.js';
import { OrchestrationService } from './services/orchestration-service.js';

/**
 * The mounted route set.
 *
 * `routes/runs.ts` used to define a second `GET /api/v1/runs`, and its own test
 * passed — because it built an app from `createRunsRoutes` alone, with none of
 * the execution routes that already owned that path mounted. The duplication was
 * invisible from either side: the dead test proved the dead handler worked, and
 * nothing proved which one the server actually served.
 *
 * So this asserts the *set* of canonical API routes, from one app with **every**
 * route module mounted in the same order as `index.ts`. A second declaration of
 * a path is a duplicate registration, which Hono resolves by registration order
 * — silently.
 *
 * **Why all of them, and not only the execution routes.** The original version
 * mounted `createExecutionRoutes` alone, so it could only see collisions *within*
 * that module. The class of bug it was written for — the same `(method, path)`
 * claimed by two modules — is invisible to a single-module view: if
 * `modules/dashboard/runs.ts` and `routes/reporter.ts` both answer
 * `GET /api/v1/runs`, a manifest built from the execution routes alone reports a
 * clean set. A collision is only detectable from the union, so the union is what
 * is mounted.
 *
 * A route that is registered but absent from `CANONICAL_API_ROUTES` is also
 * reported. The manifest is the answer to "which paths does this product serve",
 * and a path missing from it is a path nothing has claimed as canonical — which
 * is how a route ends up unlisted, unreviewed, and untested.
 */
function mountedApp(): Hono {
  const app = new Hono();
  const repository = new InMemoryRunRepository();
  const bus = new InMemoryRealtimeBus();
  // The same order as `index.ts`, so "first match wins" means the same thing here.
  app.route('/', createHealthRoutes({}));
  app.route(
    '/',
    createAuthRoutes({
      cookieSecret: 'route-manifest-cookie-secret-32-characters',
      installationId: '00000000-0000-4000-8000-000000000001',
      installationKeyHash: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      secureCookies: false,
    }).app,
  );
  app.route('/', createReporterRoutes('reporter-secret', { repository, bus }));
  app.route(
    '/',
    createExecutionRoutes({
      store: new InMemoryExecutionStore(),
      legacyRepository: repository,
      workspaceId: 'workspace-routes',
      registrationSecret: 'routes-secret',
    }),
  );
  app.route('/', createAgentRoutes());
  app.route('/', createEventsRoutes({ bus, workspaceId: 'workspace-routes' }));
  app.route(
    '/',
    createDashboardModule({
      repository,
      quarantineStore: undefined,
      qualityGateStore: undefined,
    }),
  );
  app.route(
    '/',
    createReporterResultsRoute(new ReporterIngestionService('workspace-routes'), {
      reporterSecret: 'reporter-secret',
    }),
  );
  app.route('/', createReportingRoutes(new ReporterIngestionService('workspace-routes')));
  app.route('/', createRunnerRoutes(new RunnerControlService()));
  app.route('/', createOrchestrationRoutes(new OrchestrationService()));
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

/**
 * Endpoints only.
 *
 * Hono records `app.use` and `app.all` on the same list, under the `ALL` method
 * and a wildcard path. Those are middleware — the body limit, the auth guard, the
 * ingestion rate limiter — and a wildcard is not a `(method, path)` a client can
 * call, so counting them as endpoints produced both a false duplicate
 * (`ALL /*` is registered by more than one module) and a false gap. They are
 * asserted separately in the middleware case below rather than dropped.
 */
function isEndpoint(route: { method: string; path: string }): boolean {
  return route.method !== 'ALL' && !route.path.includes('*');
}

/**
 * The canonical `(method, path)` set, one line per route the product serves.
 *
 * Every route the app answers must appear here. The `it` case below fails on a
 * route that is missing from this list, so a new route cannot be added without
 * being claimed as canonical — which is the moment to notice that nothing tests
 * it.
 */
const CANONICAL_API_ROUTES: Array<[string, string]> = [
  // Health and capability manifest.
  ['GET', '/health'],
  ['GET', '/api/v1/health'],
  ['GET', '/api/v1/ready'],
  ['GET', '/ready'],
  ['GET', '/api/v1/features'],
  // Sessions.
  ['POST', '/api/v1/auth/login'],
  ['GET', '/api/v1/auth/session'],
  ['POST', '/api/v1/auth/logout'],
  // Ingestion.
  ['POST', '/api/v1/reporter/events'],
  ['POST', '/api/v1/reporter/upload'],
  ['POST', '/api/v1/reporter/results'],
  // Runs.
  ['GET', '/api/v1/runs'],
  ['POST', '/api/v1/runs'],
  ['GET', '/api/v1/runs/:runId'],
  ['GET', '/api/v1/runs/:runId/events'],
  ['POST', '/api/v1/runs/:runId/cancel'],
  ['POST', '/api/v1/runs/:runId/retry'],
  ['GET', '/api/v1/runs/:runId/gate'],
  ['GET', '/api/v1/runs/:runId/artifacts'],
  ['GET', '/api/v1/runs/:runId/artifacts/:artifactId'],
  // Releases and policies.
  ['GET', '/api/v1/releases/:releaseId/readiness'],
  ['GET', '/api/v1/quality-policies'],
  ['POST', '/api/v1/quality-policies'],
  ['GET', '/api/v1/integrations/maturity'],
  // Runners and jobs.
  ['POST', '/api/v1/runners/register'],
  ['POST', '/api/v1/runners/:runnerId/heartbeat'],
  ['POST', '/api/v1/runners/:runnerId/jobs/claim'],
  ['POST', '/api/v1/jobs/:jobId/events'],
  ['POST', '/api/v1/jobs/:jobId/events/batch'],
  ['POST', '/api/v1/jobs/:jobId/artifacts'],
  ['POST', '/api/v1/jobs/:jobId/complete'],
  // Artifacts.
  ['GET', '/api/v1/artifacts/:artifactId'],
  // Reporting.
  ['GET', '/api/v1/reporting/runs/:runId'],
  ['GET', '/api/v1/reporting/kpis'],
  // Realtime.
  ['GET', '/api/v1/events'],
  // Agents.
  ['GET', '/api/v1/agents'],
  ['GET', '/api/v1/agents/:domain'],
  ['POST', '/api/v1/agents/:domain/:action'],
  // Dashboard.
  ['GET', '/api/v1/dashboard/runs/:id'],
  ['PATCH', '/api/v1/dashboard/runs/:id/status'],
  ['GET', '/api/v1/dashboard/tests'],
  ['GET', '/api/v1/dashboard/suites'],
  ['GET', '/api/v1/dashboard/runs/:runId/tests'],
  ['GET', '/api/v1/dashboard/analytics/summary'],
  ['GET', '/api/v1/dashboard/quarantine'],
  ['POST', '/api/v1/dashboard/quarantine'],
  ['PATCH', '/api/v1/dashboard/quarantine/:id'],
  ['DELETE', '/api/v1/dashboard/quarantine/:id'],
  ['GET', '/api/v1/dashboard/quality-gates'],
  ['POST', '/api/v1/dashboard/quality-gates'],
  ['GET', '/api/v1/dashboard/quality-gates/:id'],
  // Legacy process-local control plane.
  ['POST', '/api/v1/runner/v1/enroll'],
  ['POST', '/api/v1/runner/v1/sync'],
  ['POST', '/api/v1/runner/v1/jobs/:jobId/events/batch'],
  ['GET', '/api/v1/automations'],
  ['POST', '/api/v1/automations'],
  ['GET', '/api/v1/schedules'],
  ['POST', '/api/v1/schedules'],
  ['GET', '/api/v1/jobs'],
  ['POST', '/api/v1/automations/:id/jobs'],
  ['POST', '/api/v1/jobs/:id/cancel'],
];

describe('the mounted route set', () => {
  it('serves every canonical API route', async () => {
    const routes = (await registeredRoutes(mountedApp())).filter(isEndpoint);
    const served = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const missing = CANONICAL_API_ROUTES.filter(
      ([method, path]) => !served.has(`${method} ${path}`),
    );
    expect(missing).toEqual([]);
  });

  it('registers no route the manifest does not claim as canonical', async () => {
    const routes = (await registeredRoutes(mountedApp())).filter(isEndpoint);
    const canonical = new Set(CANONICAL_API_ROUTES.map(([method, path]) => `${method} ${path}`));
    // An unlisted route is a route nobody has reviewed, claimed, or tested. The
    // eight that were missing from this list when the manifest was first extended
    // are the reason the check exists.
    const unlisted = [
      ...new Set(
        routes.map((route) => `${route.method} ${route.path}`).filter((key) => !canonical.has(key)),
      ),
    ].sort();
    expect(unlisted).toEqual([]);
  });

  it('registers each method+path exactly once', async () => {
    const routes = (await registeredRoutes(mountedApp())).filter(isEndpoint);
    const seen = new Map<string, number>();
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    // A duplicate is not an error in Hono — the first registration wins and the
    // second is unreachable. That is exactly how a dead route file survives, and
    // it is only detectable from the union of every module, not from one.
    const duplicates = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `${key} (${String(count)} times)`);
    expect(duplicates).toEqual([]);
  });

  it('registers the two wildcard guards, and no others', async () => {
    const middleware = (await registeredRoutes(mountedApp())).filter((route) => !isEndpoint(route));
    // Stated rather than skipped: a third wildcard guard, or a wildcard left over
    // from a deleted module, is exactly the kind of thing that silently changes
    // which handler wins.
    const guards = [...new Set(middleware.map((route) => `${route.method} ${route.path}`))].sort();
    expect(guards).toEqual(['ALL /*', 'ALL /api/v1/reporter/*']);
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

  it('keeps the dashboard runs route from answering the execution list path', async () => {
    // The cross-module shape of the same defect: the dashboard module has its own
    // `runs` sub-router, and its detail path shares a prefix with the execution
    // `/api/v1/runs/:runId`. Mounting only the execution routes would never see
    // this.
    const app = mountedApp();
    const execution = await app.request('/api/v1/runs/does-not-exist');
    const dashboard = await app.request('/api/v1/dashboard/runs/does-not-exist');
    expect(execution.status).toBe(404);
    expect(dashboard.status).toBe(404);
    expect(execution.status).not.toBe(200);
  });
});
