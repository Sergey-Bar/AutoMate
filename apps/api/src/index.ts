import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createHealthRoutes } from './routes/health.js';
import { createReporterRoutes } from './routes/reporter.js';
import { createAuthRoutes } from './routes/auth.js';
import { hashCredential } from '@automate/auth';
import { createReporterResultsRoute } from './routes/reporter-results.js';
import { createReportingRoutes } from './routes/reporting.js';
import { createRunnerRoutes } from './routes/runner.js';
import { createOrchestrationRoutes } from './routes/orchestration.js';
import { ReporterIngestionService } from './services/reporter-ingestion.js';
import { DrizzleReporterIngestionService } from './services/drizzle-reporter-ingestion.js';
import { DrizzleAuthSessionBackend } from './infrastructure/session-backend.js';
import { RunnerControlService } from './services/runner-control.js';
import { OrchestrationService } from './services/orchestration-service.js';
import { createRunsRoutes } from './routes/runs.js';
import { createEventsRoutes } from './routes/events.js';
import { createExecutionRoutes } from './routes/execution.js';
import { createAgentRoutes } from './routes/agents.js';
import { InMemoryExecutionStore } from './execution/in-memory-execution-store.js';
import { DrizzleExecutionStore } from './execution/drizzle-execution-store.js';
import type { ExecutionStore } from './execution/types.js';
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
// Realtime transport: durable outbox-backed bus in production, in-memory for
// development/test. Post-MVP: Add WebSocket transport (issue #TBD).
import { InMemoryRealtimeBus } from './realtime/realtime-bus.js';
import type { RealtimeBus } from './realtime/realtime-bus.js';
import { DurableRealtimeBus } from './realtime/durable-realtime-bus.js';
import { DrizzleRealtimeFeed } from './infrastructure/drizzle-realtime-feed.js';
import { startOutboxRetentionSweep } from './infrastructure/outbox-retention.js';
// T18: dashboard module — runs detail, tests listing, analytics, quarantine, quality gates
import { createDashboardModule } from './modules/dashboard/index.js';
import {
  DrizzleQuarantineStore,
  DrizzleQualityGateStore,
} from './modules/dashboard/drizzle-stores.js';
// Auth middleware — guards all non-public routes with AUTOMATE_API_KEY
import { createAuthMiddleware } from './middleware/auth.js';
import { getConfig } from './config.js';
import {
  assertInMemoryAllowed,
  checkProductionPolicy,
  resolveAuthSecrets,
} from './startup-policy.js';
import {
  FallbackArtifactBytesStore,
  LocalArtifactBytesStore,
  LocalArtifactStore,
} from './infrastructure/artifact-store.js';
import { S3ArtifactBytesStore } from './infrastructure/s3-artifact-bytes.js';
import type { ArtifactBytesStore } from './execution/drizzle-execution-store.js';

const runtimeConfig = getConfig();
// Production policy is validated before any composition: no database client, no
// in-memory fallback, and no secret literal is constructed before this point.
checkProductionPolicy(runtimeConfig);
const { cookieSecret: authCookieSecret, installationKey: installationKey } =
  resolveAuthSecrets(runtimeConfig);

function createRunRepository(): RunRepository {
  const databaseUrl = runtimeConfig.databaseUrl;
  if (databaseUrl) {
    return new DrizzleRunRepository(createDbClient(databaseUrl));
  }
  // Development/test fallback — startup policy enforces DATABASE_URL in production.
  assertInMemoryAllowed(runtimeConfig, 'InMemoryRunRepository');
  return new InMemoryRunRepository();
}

function createDashboardStores(): {
  quarantineStore?: DrizzleQuarantineStore;
  qualityGateStore?: DrizzleQualityGateStore;
} {
  const databaseUrl = runtimeConfig.databaseUrl;
  if (!databaseUrl) {
    assertInMemoryAllowed(runtimeConfig, 'dashboard stores');
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
const artifactStore = new LocalArtifactStore(
  runtimeConfig.artifactRoot ?? process.env['ARTIFACT_ROOT'] ?? '.artifacts',
);

// Artifact bytes go to the configured S3-compatible object store whenever one is
// configured, which production policy requires. The local filesystem store stays
// the development/test convenience; assertInMemoryAllowed keeps a bypassed
// policy gate from silently composing process-local evidence in production.
function createArtifactBytesStore(): ArtifactBytesStore {
  if (runtimeConfig.objectStore) {
    const primary = new S3ArtifactBytesStore(runtimeConfig.objectStore);
    const fallbackRoot = runtimeConfig.artifactReadFallbackRoot;
    if (!fallbackRoot) return primary;
    return new FallbackArtifactBytesStore(
      primary,
      new LocalArtifactBytesStore(new LocalArtifactStore(fallbackRoot)),
    );
  }
  assertInMemoryAllowed(runtimeConfig, 'LocalArtifactBytesStore');
  return new LocalArtifactBytesStore(artifactStore);
}

const artifactBytesStore = createArtifactBytesStore();

function createExecutionStore(): ExecutionStore {
  if (runtimeConfig.databaseUrl) {
    return new DrizzleExecutionStore({
      db: createDbClient(runtimeConfig.databaseUrl),
      workspaceId: runtimeConfig.workspaceId,
      artifactBytes: artifactBytesStore,
    });
  }
  assertInMemoryAllowed(runtimeConfig, 'InMemoryExecutionStore');
  return new InMemoryExecutionStore();
}

const executionStore = createExecutionStore();
const dashboardStores = createDashboardStores();

function mountReportingRoutes(): void {
  const reporterStore = databaseResources
    ? new DrizzleReporterIngestionService(
        databaseResources.db,
        runtimeConfig.workspaceId ?? 'default-workspace',
      )
    : new ReporterIngestionService(runtimeConfig.workspaceId ?? 'default-workspace');
  app.route('/', createReporterResultsRoute(reporterStore));
  app.route('/', createReportingRoutes(reporterStore));
}

function mountLegacyProcessLocalRoutes(): void {
  if (runtimeConfig.nodeEnv === 'production') {
    const disabled = new Hono();
    const body = {
      status: 'unavailable',
      implemented: false,
      code: 'PROCESS_LOCAL_CONTROL_DISABLED',
      message: 'Legacy process-local control routes are disabled in production',
    };
    disabled.all('/runner/v1', (context) => context.json(body, 503));
    disabled.all('/runner/v1/*', (context) => context.json(body, 503));
    for (const path of [
      '/api/v1/automations',
      '/api/v1/automations/*',
      '/api/v1/schedules',
      '/api/v1/jobs',
      '/api/v1/jobs/*',
    ]) {
      disabled.all(path, (context) => context.json(body, 503));
    }
    app.route('/', disabled);
    return;
  }
  app.route('/', createRunnerRoutes(new RunnerControlService()));
  app.route('/', createOrchestrationRoutes(new OrchestrationService()));
}
const installationId = '00000000-0000-4000-8000-000000000001';
const databaseUrl = runtimeConfig.databaseUrl;
const databaseResources = databaseUrl ? createDbResources(databaseUrl) : undefined;
// Durable outbox-backed realtime in production; process-local events otherwise.
const realtimeWorkspaceId = runtimeConfig.workspaceId ?? 'default-workspace';
const realtimeFeed = databaseResources ? new DrizzleRealtimeFeed(databaseResources.db) : undefined;
if (realtimeFeed) startOutboxRetentionSweep(realtimeFeed);
let realtimeBus: RealtimeBus;
if (realtimeFeed) {
  realtimeBus = new DurableRealtimeBus(
    realtimeFeed,
    realtimeWorkspaceId,
    runtimeConfig.sseReplayRetentionHours,
  );
} else {
  assertInMemoryAllowed(runtimeConfig, 'InMemoryRealtimeBus');
  realtimeBus = new InMemoryRealtimeBus();
}
let sessionBackend;
if (databaseResources) {
  sessionBackend = new DrizzleAuthSessionBackend(
    new DrizzleSessionStore(databaseResources.db),
    authCookieSecret,
    24 * 60 * 60 * 1000,
  );
} else {
  // createAuthRoutes falls back to a process-local session store without this.
  assertInMemoryAllowed(runtimeConfig, 'in-memory auth sessions');
}
const installationKeyHash = databaseResources
  ? await new DrizzleInstallationKeyStore(databaseResources.db).ensureBootstrap({
      installationId,
      keyHash: hashCredential(authCookieSecret, installationKey),
      displayPrefix: 'dev',
    })
  : hashCredential(authCookieSecret, installationKey);
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

app.route(
  '/',
  createHealthRoutes({
    databaseUrl: runtimeConfig.databaseUrl,
    checkDatabase: databaseResources
      ? async () => {
          await databaseResources.db.execute(sql`SELECT 1`);
        }
      : undefined,
  }),
);
app.route('/', authRoutes.app);
app.route(
  '/',
  createReporterRoutes(runtimeConfig.reporterSecret, {
    repository: runRepository,
    bus: realtimeBus,
    artifactStore: { putAt: (key, bytes) => artifactBytesStore.put(key, bytes) },
    allowQueryToken: false,
  }),
);
app.route(
  '/',
  createExecutionRoutes({
    store: executionStore,
    legacyRepository: runRepository,
    workspaceId: runtimeConfig.workspaceId ?? 'default-workspace',
    runnerRegistrationSecret: runtimeConfig.runnerRegistrationSecret,
    bus: realtimeBus,
  }),
);
app.route('/', createAgentRoutes());
// T17: expose run list and SSE event stream
app.route('/', createRunsRoutes({ repository: runRepository }));
app.route(
  '/',
  createEventsRoutes({
    bus: realtimeBus,
    feed: realtimeFeed,
    workspaceId: realtimeWorkspaceId,
  }),
);
// T18: dashboard module — /api/v1/dashboard/* routes
app.route(
  '/',
  createDashboardModule({
    repository: runRepository,
    quarantineStore: dashboardStores.quarantineStore,
    qualityGateStore: dashboardStores.qualityGateStore,
  }),
);
mountReportingRoutes();
mountLegacyProcessLocalRoutes();

export { app, executionStore };

if (runtimeConfig.nodeEnv !== 'test') {
  const { serve } = await import('@hono/node-server');
  // Startup policy already ran above, before any composition; the server only
  // starts once that gate has passed.
  serve(
    { fetch: app.fetch, port: runtimeConfig.port, hostname: runtimeConfig.host },
    (info) => {
      console.info(`automate-api listening on http://${runtimeConfig.host}:${info.port}`);
    },
  );
}
