import { Hono } from 'hono';
import { healthRoutes } from './routes/health.js';
import { a11yRoutes } from './routes/a11y.js';
import { createReporterRoutes } from './routes/reporter.js';
import { createRunsRoutes } from './routes/runs.js';
import { createEventsRoutes } from './routes/events.js';
// Development/test repository — replaced by DrizzleRunRepository when DATABASE_URL is set.
// Production deployments require DATABASE_URL per startup policy.
// Post-MVP: Remove InMemoryRunRepository fallback entirely (issue #TBD).
import { InMemoryRunRepository } from './repositories/in-memory-run-repository.js';
import { DrizzleRunRepository } from './repositories/drizzle-run-repository.js';
import { createDbClient } from '@automate/db';
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
// T20: orchestrator module — conversations, model config, chat, test generation
import { createOrchestratorModule } from './modules/orchestrator/index.js';
// T22: connectors module — connector registry, vault credential store
import { createConnectorsModule } from './modules/connectors/index.js';
// T23: agents module — PRD domain contract alignment (browser/api/load/security/mobile)
import { createAgentsModule } from './modules/agents/index.js';
// Auth middleware — guards all non-public routes with AUTOMATE_API_KEY
import { createAuthMiddleware } from './middleware/auth.js';
import { createAuthRoutes } from './routes/auth.js';

function createRunRepository(): RunRepository {
  const databaseUrl = process.env['DATABASE_URL'];
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
  const databaseUrl = process.env['DATABASE_URL'];
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

// Apply auth middleware globally. Public paths and reporter paths are
// excluded inside the middleware itself; reporter has its own REPORTER_SECRET auth.
// The default getter reads process.env['AUTOMATE_API_KEY'] at request time.
app.use('/*', createAuthMiddleware());

app.route('/', healthRoutes);
app.route('/', a11yRoutes);
app.route(
  '/',
  createAuthRoutes({
    getApiKey: () => process.env['AUTOMATE_API_KEY'],
    getCookieSecret: () => process.env['COOKIE_SECRET'] ?? process.env['SESSION_SECRET'],
    isProduction: () => process.env['NODE_ENV'] === 'production',
  }),
);
app.route(
  '/',
  createReporterRoutes(process.env['REPORTER_SECRET'], {
    repository: runRepository,
    bus: realtimeBus,
    allowQueryToken: process.env['REPORTER_QUERY_TOKEN_COMPAT'] === 'true',
  }),
);
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
// T20: orchestrator module — /api/v1/orchestrator/* routes
app.route('/', createOrchestratorModule());
// T22: connectors module — /api/v1/connectors/* and /api/v1/vault/* routes
app.route('/', createConnectorsModule());
// T23: agents module — /api/v1/agents/* routes (browser implemented, others 501)
app.route('/', createAgentsModule());

export { app };

if (process.env['NODE_ENV'] !== 'test') {
  const { serve } = await import('@hono/node-server');
  const { getConfig } = await import('./config.js');
  const { checkProductionPolicy } = await import('./startup-policy.js');

  const config = getConfig();
  checkProductionPolicy(config);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.info(`automate-api listening on http://localhost:${info.port}`);
  });
}
