import { Hono } from 'hono';
import { createExecutionRoutes } from '../routes/execution.js';
import { createHealthRoutes } from '../routes/health.js';
import { createReporterRoutes } from '../routes/reporter.js';
import { createReporterResultsRoute } from '../routes/reporter-results.js';
import { createReportingRoutes } from '../routes/reporting.js';
import { createRunnerRoutes } from '../routes/runner.js';
import { createOrchestrationRoutes } from '../routes/orchestration.js';
import { createEventsRoutes } from '../routes/events.js';
import { createAgentRoutes } from '../routes/agents.js';
import { createChatRoutes } from '../routes/chat.js';
import { createProjectsRoutes } from '../routes/projects.js';
import { literalView } from '@automate/projects';
import { aiGatewayOrUnconfigured } from '../observability/ai-gateway.js';
import { createAuthRoutes } from '../routes/auth.js';
import { createDashboardModule } from '../modules/dashboard/index.js';
import { createErrorBoundary } from '../errors/boundary.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';
import { RunnerControlService } from '../services/runner-control.js';
import { OrchestrationService } from '../services/orchestration-service.js';

/**
 * One app with **every** route module mounted, in the order `index.ts` mounts them.
 *
 * This is test support and not product, because the product's own composition is
 * `index.ts`'s job and this is a harness that stands in for it: an in-memory
 * store, an empty database cast to `{} as never`, an AI gateway that refuses. It
 * lives under `test-support/` so the boundary rule in
 * `scripts/lib/test-support-boundary.test.mjs` keeps product code from importing
 * it — a second app wired the way a fixture is would be a second answer to
 * "which routes does this product serve".
 *
 * ## Why it was moved out of `route-manifest.test.ts`
 *
 * Two tests now need the same app: the manifest test, which asks what is
 * registered, and the authz matrix test, which asks what each route answers. A
 * second copy of the mounting order is a second authority, and the two would
 * drift — the manifest would assert a route set this harness no longer produces,
 * or the matrix would record a class for a route mounted somewhere else. Hono
 * resolves a collision by registration order, so "mounted in the same order as
 * `index.ts`" is a *property* the mounting code has to keep, not a comment.
 *
 * ## What mounting every module buys
 *
 * `routes/runs.ts` used to define a second `GET /api/v1/runs`, and its own test
 * passed — because it built an app from `createRunsRoutes` alone, with none of
 * the execution routes that already owned that path mounted. The duplication was
 * invisible from either side: the dead test proved the dead handler worked, and
 * nothing proved which one the server actually served.
 *
 * The class of bug is *cross-module*: if `modules/dashboard/runs.ts` and
 * `routes/reporter.ts` both answer `GET /api/v1/runs`, a manifest built from one
 * module alone reports a clean set. A collision is only detectable from the
 * union, so the union is what is mounted.
 */
export function mountedApp(): Hono {
  // The error boundary, because since finding C-3 a handler refuses by `throw`ing a
  // `DomainError` and this is what renders it. Without it the one case below that asks
  // for a missing run would answer Hono's default 500, and the assertion would be
  // measuring the harness rather than the routes.
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const app = new Hono().onError(onError);
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
  // A gateway that refuses, because this suite is about the route set and a real
  // one would need a provider. The route is the same either way — which gateway is
  // the composition root's choice, not the route's — and the shared helper is used
  // rather than a second unconfigured stub that could differ from it.
  app.route(
    '/',
    createChatRoutes({
      gateway: aiGatewayOrUnconfigured({
        kind: 'none',
        reason: 'no provider in the manifest test',
      }),
    }),
  );
  /**
   * The project registry, mounted at the position `index.ts` mounts it.
   *
   * **It was missing, and the two assertions below are why that mattered.** The
   * fourteen project endpoints were live in the real app and absent from this
   * harness, so the manifest could not see them: a duplicated path there, or a
   * path colliding with the legacy control plane, would have been invisible. The
   * suite is about the route *set*, so it mounts the routes and never calls one —
   * which is why the registry service takes a `{} as never` for the database (the
   * same cast `index.ts` gives the real one) and a literal empty view, the seam
   * the detector's file reads exist to be injected through.
   */
  app.route(
    '/',
    createProjectsRoutes({
      db: {} as never,
      workspaceId: 'workspace-routes',
      viewFor: () => literalView({}),
      startRun: async (input) => ({
        runId: input.commandId,
        jobId: input.commandId,
        phase: 'queued',
      }),
    }),
  );
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
export async function registeredRoutes(
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
 * asserted separately in the middleware case in `route-manifest.test.ts` rather
 * than dropped.
 */
export function isEndpoint(route: { method: string; path: string }): boolean {
  return route.method !== 'ALL' && !route.path.includes('*');
}
