import { requestContext, requireRequestId } from './observability/request-context.js';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createErrorBoundary } from './errors/boundary.js';
import { withClassifiedErrors } from './errors/db-errors.js';
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
import {
  NO_INSTALLATION_KEY,
  bootstrapDisplayPrefix,
  mayDeriveInstallationKey,
} from './bootstrap-display-prefix.js';
import { RunnerControlService } from './services/runner-control.js';
import { OrchestrationService } from './services/orchestration-service.js';
import { createEventsRoutes } from './routes/events.js';
import { createExecutionRoutes } from './routes/execution.js';
import { createAgentRoutes } from './routes/agents.js';
import { createChatRoutes } from './routes/chat.js';
import { aiGatewayOrUnconfigured, resolveAiGateway } from './observability/ai-gateway.js';
import { InMemoryExecutionStore } from './execution/in-memory-execution-store.js';
import { DrizzleExecutionStore } from './execution/drizzle-execution-store.js';
import type { ExecutionStore } from './execution/types.js';
// Development/test repository — replaced by DrizzleRunRepository when DATABASE_URL is set.
// Production deployments require DATABASE_URL per startup policy.
// Post-MVP: Remove InMemoryRunRepository fallback entirely (issue #TBD).
import { InMemoryRunRepository } from './repositories/in-memory-run-repository.js';
import { DrizzleRunRepository } from './repositories/drizzle-run-repository.js';
import { createDbResources, DrizzleInstallationKeyStore, DrizzleSessionStore } from '@automate/db';
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
import { createRequestDeadline } from './middleware/request-deadline.js';
import { createSecurityHeaders } from './middleware/security-headers.js';
import { getConfig } from './config.js';
import { createSentryErrorReporter } from './observability/sentry.js';
import { createLogger } from './observability/logger.js';
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
/**
 * Session lifetimes, in milliseconds, read from configuration.
 *
 * Both were literal `24 * 60 * 60 * 1000` in this file while
 * `packages/config` declared `SESSION_TTL_HOURS` and `SESSION_RETENTION_DAYS` and
 * mapped them onto this config. So the literals and the settings agreed only because
 * the defaults happened to be the same number — an operator who set
 * `SESSION_TTL_HOURS=8` got eight hours in nothing. The fallbacks below are the
 * schema's own defaults, so the value is unchanged for a default deployment and
 * *does* follow the setting when there is one.
 */
const sessionTtlMs = (runtimeConfig.sessionTtlHours ?? 24) * 60 * 60 * 1000;
const sessionRetentionMs = (runtimeConfig.sessionRetentionDays ?? 30) * 24 * 60 * 60 * 1000;
// Production policy is validated before any composition: no database client, no
// in-memory fallback, and no secret literal is constructed before this point.
checkProductionPolicy(runtimeConfig);
const { cookieSecret: authCookieSecret, installationKey: installationKey } =
  resolveAuthSecrets(runtimeConfig);

const installationId = '00000000-0000-4000-8000-000000000001';
const databaseUrl = runtimeConfig.databaseUrl;
/**
 * One pool for the process. Every repository, store, feed and health probe
 * below shares `databaseResources.db`. Constructing a client per component
 * created five `pg.Pool` instances — 40–50 sockets for a single
 * `DATABASE_URL` — and exhausting them was a matter of traffic, not scale.
 */
const databaseResources = databaseUrl ? createDbResources(databaseUrl) : undefined;

function createRunRepository(): RunRepository {
  if (databaseResources) {
    return new DrizzleRunRepository(databaseResources.db);
  }
  // Development/test fallback — startup policy enforces DATABASE_URL in production.
  assertInMemoryAllowed(runtimeConfig, 'InMemoryRunRepository');
  return new InMemoryRunRepository();
}

function createDashboardStores(): {
  quarantineStore?: DrizzleQuarantineStore;
  qualityGateStore?: DrizzleQualityGateStore;
} {
  if (!databaseResources) {
    assertInMemoryAllowed(runtimeConfig, 'dashboard stores');
    return {};
  }
  return {
    quarantineStore: new DrizzleQuarantineStore(databaseResources.db),
    qualityGateStore: new DrizzleQualityGateStore(databaseResources.db),
  };
}

const app = new Hono();

/**
 * The process's one log sink.
 *
 * Created here, at the composition root, and injected downward. Anywhere else it
 * would be a second sink — and two sinks means two formats, so a deployment
 * reading the log has to know which of them produced the line it is looking at.
 */
const logger = createLogger({ service: 'automate-api' });

/**
 * The one model provider decision, made here because this is the only place that
 * knows which providers exist.
 *
 * Unconfigured is a gateway that refuses with a coded 503, not a missing one: an
 * optional feature that is switched off should not be a deployment that will not
 * start, and a client deserves a claim it can act on rather than a `null` the
 * route has to guess about.
 */
const gatewayResolution = resolveAiGateway();
const aiGateway = aiGatewayOrUnconfigured(gatewayResolution);
if (gatewayResolution.kind === 'none') {
  // Named at startup, because "chat 404s with a permission error" is a much longer
  // diagnosis than "no model provider is configured".
  logger.warn('chat is unconfigured and will refuse requests', {
    reason: gatewayResolution.reason,
  });
} else {
  logger.info('chat provider selected', { provider: gatewayResolution.kind });
}

/**
 * One error boundary for the whole app.
 *
 * Without it, Hono's default handler produced a bare 500 for anything a handler
 * threw, so a Postgres CHECK violation — a state transition the schema rejects —
 * was indistinguishable from a defect, and a serialization failure (which is
 * retryable) was indistinguishable from either. Every response now carries a
 * stable `code`; see `apps/api/src/errors/`.
 */
const errorBoundary = createErrorBoundary({
  // From the request context, not from the header: six sites re-derived this
  // independently with different fallbacks — some generated a UUID, one stored
  // `null`, one stored `'unknown'` — so one execution could not be traced by one id
  // from the log line to the event row. See `observability/request-context.ts`
  // (ledger O-1b).
  requestId: () => requireRequestId(),
  // The boundary is the only place that knows whether a throw was a defect or a
  // refusal, so it is also the only place that decides what gets reported.
  reportError: createSentryErrorReporter(),
  // The seam was declared, documented as injectable, and passed by nothing —
  // so every failure in the API reached a `console.error(message, context)`:
  // a message string and a loose object side by side, unparseable and
  // unqueryable. Nothing could have caught it, because every test supplies its
  // own collector and the test path was therefore always populated while the
  // production path never was. `observability/logger.ts` is the one sink.
  log: logger.error,
});
app.onError(errorBoundary.onError);
app.notFound(errorBoundary.notFound);

// Shared run repository — lives for the lifetime of the process.
// createRunRepository() selects DrizzleRunRepository when DATABASE_URL is set,
// falling back to InMemoryRunRepository for development/test.
//
// Wrapped in `withClassifiedErrors` so no store method can leak a raw `pg` error:
// a CHECK, unique or FK violation arrives as a `DomainError` with a code and a
// mapped status, for the HTTP route and for the worker's reaper alike. Wrapping
// method by method is what misses the ones nobody remembers, and a missed one
// surfaces as a bare 500 that a caller then retries forever.
const runRepository = withClassifiedErrors(createRunRepository());
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
  if (databaseResources) {
    return new DrizzleExecutionStore({
      db: databaseResources.db,
      workspaceId: runtimeConfig.workspaceId,
      artifactBytes: artifactBytesStore,
    });
  }
  assertInMemoryAllowed(runtimeConfig, 'InMemoryExecutionStore');
  return new InMemoryExecutionStore();
}

const executionStore = withClassifiedErrors(createExecutionStore());
const dashboardStores = createDashboardStores();

function mountReportingRoutes(): void {
  const reporterStore = databaseResources
    ? new DrizzleReporterIngestionService(
        databaseResources.db,
        runtimeConfig.workspaceId ?? 'default-workspace',
      )
    : new ReporterIngestionService(runtimeConfig.workspaceId ?? 'default-workspace');
  app.route(
    '/',
    createReporterResultsRoute(reporterStore, {
      reporterSecret: runtimeConfig.reporterSecret,
      requireReporterSecret: runtimeConfig.nodeEnv === 'production',
    }),
  );
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
// Declared rather than inferred from the branches. It infers
// `DrizzleAuthSessionBackend | undefined` today, which is why `noImplicitAny`
// passes — but a `let` with no annotation is one refactor away from being one, and
// `undefined` is the meaningful half of that union, not an afterthought.
let sessionBackend: DrizzleAuthSessionBackend | undefined;
if (databaseResources) {
  sessionBackend = new DrizzleAuthSessionBackend(
    new DrizzleSessionStore(databaseResources.db),
    authCookieSecret,
    sessionTtlMs,
    // The retention window, which was parsed and mapped and read by nothing until
    // the sweep had something to sweep with. It is longer than the TTL on purpose:
    // a row outlives its validity so that "was this ever valid" still has an answer.
    sessionRetentionMs,
  );
} else {
  // createAuthRoutes falls back to a process-local session store without this.
  assertInMemoryAllowed(runtimeConfig, 'in-memory auth sessions');
}
// Production never derives one. See `mayDeriveInstallationKey` for why the two
// readings of P-72 were separate rows: renaming the label on a bootstrapped key was
// cosmetic, deriving that key in production is not.
if (
  databaseResources &&
  !mayDeriveInstallationKey(runtimeConfig) &&
  !process.env['AUTOMATE_INSTALLATION_KEY']
) {
  throw new Error(NO_INSTALLATION_KEY);
}

const installationKeyHash = databaseResources
  ? await new DrizzleInstallationKeyStore(databaseResources.db).ensureBootstrap({
      installationId,
      keyHash: hashCredential(authCookieSecret, installationKey),
      displayPrefix: bootstrapDisplayPrefix(runtimeConfig),
    })
  : hashCredential(authCookieSecret, installationKey);
/**
 * Cookie `secure` is derived from how the request actually arrived, not from
 * a configured public URL. A deployment behind a TLS-terminating proxy that
 * forgets to set `PUBLIC_APP_URL` to an `https://` value would otherwise emit
 * a session cookie without `Secure`. An explicit `COOKIE_SECURE` still wins.
 */
function resolveSecureCookies(): boolean {
  const explicit = process.env['COOKIE_SECURE']?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') return true;
  if (explicit === 'false' || explicit === '0' || explicit === 'no') return false;
  return (runtimeConfig.publicAppUrl ?? 'http://localhost:5173').startsWith('https://');
}

const authRoutes = createAuthRoutes({
  cookieSecret: authCookieSecret,
  installationId,
  installationKeyHash,
  sessionTtlMs: 24 * 60 * 60 * 1000,
  secureCookies: resolveSecureCookies(),
  sessionBackend,
});

/**
 * Origins allowed to make credentialed cross-origin requests.
 *
 * `PUBLIC_APP_URL` is the web client, which is where almost every install puts
 * its only browser origin. `CORS_ALLOWED_ORIGINS` adds more, for the split
 * deployment where the client is served from a different host.
 *
 * Default-deny rather than a wildcard, because the session cookie is the
 * credential: `*` would be rejected by the browser for a credentialed request
 * anyway, and the workarounds people reach for instead — reflecting the request's
 * origin, or allowing `null` — hand the session to any site the user visits.
 * A same-origin client sends no `Origin` at all and is unaffected.
 */
function resolveAllowedOrigins(): string[] {
  const origins = new Set<string>();
  const publicAppUrl = runtimeConfig.publicAppUrl?.trim();
  if (publicAppUrl !== undefined && publicAppUrl !== '' && publicAppUrl !== 'null') {
    origins.add(new URL(publicAppUrl).origin);
  }
  for (const extra of (process.env['CORS_ALLOWED_ORIGINS'] ?? '').split(',')) {
    const trimmed = extra.trim();
    if (trimmed === '') continue;
    // Normalised through `URL` so `https://a.test:443/` and `https://a.test` are
    // one origin. An unparseable value is dropped rather than passed through: a
    // string that never matches an `Origin` header is a typo that would otherwise
    // look like a working configuration.
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      console.error(`CORS_ALLOWED_ORIGINS: ignoring "${trimmed}", which is not an origin.`);
    }
  }
  return [...origins];
}

// First, so every later middleware and every handler — and every error the
// boundary reports — runs with a request id already in scope. A context
// established after the first thing that can fail is a context the first thing
// that can fail does not have (ledger O-1b).
app.use(requestContext);
app.use('*', createSecurityHeaders({ allowedOrigins: resolveAllowedOrigins() }));

/**
 * A server-side deadline on every request that is not a long-lived stream.
 *
 * `GET /api/v1/events` is an SSE stream: refusing it halfway through would close a
 * working subscription, which is a different failure from a slow request. It is
 * the one exemption, and it is here rather than inside the middleware so the
 * decision of what to exempt is made where the routes are known.
 */
app.use(
  '*',
  createRequestDeadline({
    budgetMs: Number(process.env['REQUEST_DEADLINE_MS'] ?? 30_000),
    exemptPaths: [
      '/api/v1/events',
      // A streaming completion outlives the handler that started it — the deadline
      // disarms when the handler returns, while the body is still being consumed —
      // so the middleware budget cannot reach the provider. The route carries its
      // own, from `CHAT_TIMEOUT_MS`. Listed here so the exemption is a recorded
      // decision rather than a gap nobody noticed.
      '/api/v1/chat/completions',
    ],
    onTimeout: ({ path, method, budgetMs }) =>
      console.error(`request exceeded its ${String(budgetMs)}ms deadline: ${method} ${path}`),
  }),
);

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
app.route('/', createChatRoutes({ gateway: aiGateway }));
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
  serve({ fetch: app.fetch, port: runtimeConfig.port, hostname: runtimeConfig.host }, (info) => {
    console.info(`automate-api listening on http://${runtimeConfig.host}:${info.port}`);
  });
}
