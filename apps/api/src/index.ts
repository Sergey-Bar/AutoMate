import { Hono } from 'hono';
import { healthRoutes } from './routes/health.js';
import { createReporterRoutes } from './routes/reporter.js';
import { createAuthRoutes } from './routes/auth.js';
import { hashCredential } from '@automate/auth';
import { createReporterResultsRoute } from './routes/reporter-results.js';
import { createReportingRoutes } from './routes/reporting.js';
import { createRunnerRoutes } from './routes/runner.js';
import { createOrchestrationRoutes } from './routes/orchestration.js';
import { ReporterIngestionService } from './services/reporter-ingestion.js';
import { DrizzleAuthSessionBackend } from './infrastructure/session-backend.js';
import { RunnerControlService } from './services/runner-control.js';
import { OrchestrationService } from './services/orchestration-service.js';
import { createRunsRoutes } from './routes/runs.js';
import { createEventsRoutes } from './routes/events.js';
// Development/test repository — replaced by DrizzleRunRepository when DATABASE_URL is set.
// Production deployments require DATABASE_URL per startup policy.
// Post-MVP: Remove InMemoryRunRepository fallback entirely (issue #TBD).
import { InMemoryRunRepository } from './repositories/in-memory-run-repository.js';
import { DrizzleRunRepository } from './repositories/drizzle-run-repository.js';
import {
  createDbClient,
  createDbResources,
  DrizzleInstallationKeyStore,
  DrizzleSessionStore,
} from '@automate/db';
import type { RunRepository } from './repositories/run-repository.js';
// In-memory realtime bus for local development.
// Production: Use @automate/realtime SSE bus for multi-instance deployments.
// Post-MVP: Add WebSocket transport for bidirectional updates (issue #TBD).
import { InMemoryRealtimeBus } from './realtime/realtime-bus.js';
// T18: dashboard module — runs detail, tests listing, analytics, quarantine, quality gates
import { createDashboardModule } from './modules/dashboard/index.js';
import {
  DrizzleQuarantineStore,
  DrizzleQualityGateStore,
} from './modules/dashboard/drizzle-stores.js';
// Auth middleware — guards all non-public routes with AUTOMATE_API_KEY
import { createAuthMiddleware } from './middleware/auth.js';
import { getConfig } from './config.js';

const runtimeConfig = getConfig();

function createRunRepository(): RunRepository {
  const databaseUrl = runtimeConfig.databaseUrl;
  if (databaseUrl) {
    return new DrizzleRunRepository(createDbClient(databaseUrl));
  }
  // Development/test fallback — startup policy enforces DATABASE_URL in production.
  return new InMemoryRunRepository();
}

function createDashboardStores(): {
  quarantineStore?: DrizzleQuarantineStore;
  qualityGateStore?: DrizzleQualityGateStore;
} {
  const databaseUrl = runtimeConfig.databaseUrl;
  if (!databaseUrl) {
    return {};
  }
  const db = createDbClient(databaseUrl);
  return {
    quarantineStore: new DrizzleQuarantineStore(db),
    qualityGateStore: new DrizzleQualityGateStore(db),
  };
}

const app = new Hono();

// Shared run repository — lives for the lifetime of the process.
// createRunRepository() selects DrizzleRunRepository when DATABASE_URL is set,
// falling back to InMemoryRunRepository for development/test.
const runRepository = createRunRepository();
const dashboardStores = createDashboardStores();

// Shared realtime bus — collects run:updated events in process memory.
// T15 vertical slice: events are published but not yet forwarded to WebSocket clients.
// T17: events are now forwarded to SSE clients via GET /api/v1/events.
const realtimeBus = new InMemoryRealtimeBus();
const runnerControl = new RunnerControlService();
const orchestrationService = new OrchestrationService();
const reporterIngestion = new ReporterIngestionService(
  runtimeConfig.workspaceId ?? 'default-workspace',
);
const authCookieSecret = runtimeConfig.cookieSecret ?? 'development-only-cookie-secret-32-chars';
const installationId = '00000000-0000-4000-8000-000000000001';
const databaseUrl = runtimeConfig.databaseUrl;
const databaseResources = databaseUrl ? createDbResources(databaseUrl) : undefined;
const sessionBackend = databaseResources
  ? new DrizzleAuthSessionBackend(
      new DrizzleSessionStore(databaseResources.db),
      authCookieSecret,
      24 * 60 * 60 * 1000,
    )
  : undefined;
const installationKeyHash = databaseResources
  ? await new DrizzleInstallationKeyStore(databaseResources.db).ensureBootstrap({
      installationId,
      keyHash: hashCredential(
        authCookieSecret,
        runtimeConfig.installationApiKey ?? 'development-installation-key',
      ),
      displayPrefix: 'dev',
    })
  : hashCredential(
      authCookieSecret,
      runtimeConfig.installationApiKey ?? 'development-installation-key',
    );
const authRoutes = createAuthRoutes({
  cookieSecret: authCookieSecret,
  installationId,
  installationKeyHash,
  sessionTtlMs: 24 * 60 * 60 * 1000,
  secureCookies: (runtimeConfig.publicAppUrl ?? 'http://localhost:5173').startsWith('https://'),
  sessionBackend,
});

// Apply auth middleware globally. Auth, health, and feature routes are public by policy.
// The default getter reads the typed runtime configuration at request time.
app.use(
  '/*',
  createAuthMiddleware(
    () => getConfig().installationApiKey,
    (token) => authRoutes.sessions.validate(token),
    databaseResources ? installationKeyHash : undefined,
    authCookieSecret,
  ),
);

app.route('/', healthRoutes);
app.route('/', authRoutes.app);
app.route(
  '/',
  createReporterRoutes(runtimeConfig.reporterSecret, {
    repository: runRepository,
    bus: realtimeBus,
    allowQueryToken: false,
  }),
);
app.route('/', createReporterResultsRoute(reporterIngestion));
app.route('/', createReportingRoutes(reporterIngestion));
app.route('/', createRunnerRoutes(runnerControl));
app.route('/', createOrchestrationRoutes(orchestrationService));
// T17: expose run list and SSE event stream
app.route('/', createRunsRoutes({ repository: runRepository }));
app.route('/', createEventsRoutes({ bus: realtimeBus }));
// T18: dashboard module — /api/v1/dashboard/* routes
app.route(
  '/',
  createDashboardModule({
    repository: runRepository,
    quarantineStore: dashboardStores.quarantineStore,
    qualityGateStore: dashboardStores.qualityGateStore,
  }),
);

export { app };

if (runtimeConfig.nodeEnv !== 'test') {
  const { serve } = await import('@hono/node-server');
  const { getConfig } = await import('./config.js');
  const { checkProductionPolicy } = await import('./startup-policy.js');

  const config = getConfig();
  checkProductionPolicy(config);

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.info(`automate-api listening on http://${config.host}:${info.port}`);
  });
}
