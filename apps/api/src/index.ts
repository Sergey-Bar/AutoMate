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
import type { ReporterResultStore } from './services/reporter-ingestion.js';
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
import { fileSystemView } from '@automate/projects';
import { createProjectsRoutes } from './routes/projects.js';
import { DrizzleDecisionStore } from './execution/drizzle-decision-store.js';
import { DrizzleScorePointStore } from './services/drizzle-derived-score-points.js';
import { compileGlob, type DeclaredCoverageGlob } from './services/coverage-ingestion.js';
import type { CoverageFormat } from '@automate/reporter';
import {
  discoverProjectAtBoot,
  type ProjectRegistryServiceOptions,
} from './services/project-registry-service.js';
import { DEFAULT_WORKSPACE_ID, type RunRepository } from './repositories/run-repository.js';
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
// No auth middleware: the install is open. See the note where it used to be mounted,
// and ADR-006 for the posture. The session and key routes stay mounted — they mint
// nothing anybody is required to hold.
import { createRequestDeadline } from './middleware/request-deadline.js';
import { createSecurityHeaders } from './middleware/security-headers.js';
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

import { getConfig } from './bootstrap/index.js';

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

/**
 * The decision store, or `null` when this install cannot keep one.
 *
 * The shape is the same as `createExecutionStore` above: a Drizzle store over
 * the configured database, `null` otherwise. Nothing is constructed in-memory,
 * because a verdict that disappears on restart is worse than a verdict that was
 * never taken — the console would report "you accepted this" about a decision
 * that is already gone.
 */
function createDecisionStore(): DrizzleDecisionStore | null {
  const resources = databaseResources;
  if (resources === null || resources === undefined) return null;
  return new DrizzleDecisionStore(
    resources.db as unknown as ConstructorParameters<typeof DrizzleDecisionStore>[0],
  );
}

/**
 * The score's photographs, and the same "no database, no durable record" rule the
 * decision store follows.
 *
 * An install without a database computes every score from the runs exactly as it
 * did before migration 0027 — the photographs buy a trend long enough to chart,
 * and a chart is not worth inventing a durability story for. `qaScore` treats an
 * absent store as "two points" rather than as a failure, so this returns null and
 * the route options simply omit the key.
 */
function createScorePointStore(): DrizzleScorePointStore | null {
  const resources = databaseResources;
  if (resources === null || resources === undefined) return null;
  return new DrizzleScorePointStore(
    resources.db as unknown as ConstructorParameters<typeof DrizzleScorePointStore>[0],
  );
}

/**
 * The coverage reader, wired from the stores this install already has.
 *
 * **This is the wire that was missing.** `apps/api/src/services/qa-score-service.ts`
 * has accepted a coverage-documents parameter since the score was written, and
 * every caller passed `[]` — so the score's `depth` component was `unknown` on
 * every cell of every screen, a fifth of the total answering "no idea" beside a
 * printed number. The bytes were never the problem: the runner uploads artifacts
 * into the store this function closes over, and `packages/reporter/parseCoverage`
 * has parsed six formats since before the score existed. Nobody had joined them.
 *
 * The join is: list the run's uploaded artifacts, match each against the
 * profile's declared `coverageGlobs`, read the bytes, hand back one document per
 * glob with the format that glob declared. **No format is guessed** — a lcov and
 * a cobertura can share an extension, and a guessed format is a misread number,
 * which is the one thing this product cannot afford.
 *
 * The composition root is the only place this can live: it is where the artifact
 * store and the workspace id both exist, and a service that reached for object
 * storage directly could not be tested against a literal map.
 */
const readCoverageDocuments = async (
  runId: string,
  globs: readonly DeclaredCoverageGlob[],
): Promise<ReadonlyArray<{ format: CoverageFormat; bytes: Uint8Array }>> => {
  const rows = await executionStore.listArtifacts(
    runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
    runId,
  );
  const documents: Array<{ format: CoverageFormat; bytes: Uint8Array }> = [];
  for (const glob of globs) {
    const matcher = compileGlob(glob.glob);
    for (const row of rows) {
      // A glob names the run's **own filenames**, which is what `metadata.path`
      // records: the storage key is an opaque store address, and matching a glob
      // against it would compare a repository path against a bucket path.
      const name = typeof row.metadata['path'] === 'string' ? row.metadata['path'] : row.name;
      if (!matcher(name)) continue;
      // The digest the row recorded, supplied so the store hands back what is
      // actually there: evidence is a claim about bytes, and a read without its
      // checksum would accept a truncated object as a passing artifact.
      const bytes = await artifactBytesStore.get(row.storageKey, row.checksum);
      if (bytes === null) continue;
      documents.push({ format: glob.format, bytes });
      break;
    }
  }
  return documents;
};

const executionStore = withClassifiedErrors(createExecutionStore());
const dashboardStores = createDashboardStores();

/**
 * The store a verdict about a derived finding is recorded in — the loop's spine.
 *
 * **Created beside the execution store, for the same reason, and with the same
 * fallback.** A verdict is the most tenant-private thing this product holds: it
 * names what one team accepted about their own suite. So it is durable when
 * PostgreSQL is configured, and absent — `null`, which the route turns into
 * `NOT_CONFIGURED` — when it is not. An in-memory fallback here would record
 * verdicts that vanish on restart while reporting them as recorded, which is the
 * one lie this product cannot afford.
 */
const decisionStore = createDecisionStore();

/** `null` when this install has no database; see `createScorePointStore`. */
const scorePointStore = createScorePointStore();

/**
 * The one canonical store both reporting and the reporter doors resolve.
 *
 * **Two instances would be two ingestion systems again.** `mountReportingRoutes` used to
 * build its own, and the reporter routes had none — so an upload could land in the
 * installation and `/api/v1/reporting/kpis` answered `proofCeiling: 'unknown'` about a
 * system with a year of test history (ledger row P-73). The store is now built here, once,
 * and handed to both.
 */
let reporterStore: ReporterResultStore | undefined;

function resolveReporterStore(): ReporterResultStore {
  if (reporterStore) return reporterStore;
  reporterStore = databaseResources
    ? new DrizzleReporterIngestionService(
        databaseResources.db,
        runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
      )
    : new ReporterIngestionService(runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID);
  return reporterStore;
}

function mountReportingRoutes(): void {
  const store = resolveReporterStore();
  app.route(
    '/',
    createReporterResultsRoute(store, {
      reporterSecret: runtimeConfig.reporterSecret,
      requireReporterSecret: runtimeConfig.nodeEnv === 'production',
    }),
  );
  app.route('/', createReportingRoutes(store));
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
/** The durable bus, when one was constructed — the readiness probe needs its own view. */
let durableRealtimeBus: DurableRealtimeBus | undefined;
if (realtimeFeed) {
  durableRealtimeBus = new DurableRealtimeBus(
    realtimeFeed,
    realtimeWorkspaceId,
    runtimeConfig.sseReplayRetentionHours,
  );
  realtimeBus = durableRealtimeBus;
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

/**
 * **No authentication middleware.** The install is open.
 *
 * Removed rather than bypassed, on 2026-09-30. A self-hosted, single-tenant install
 * has one operator and no second party to authenticate *to*: `WORKSPACE_ID` is the
 * only tenancy boundary the product has, and ADR-006 puts multi-tenant isolation
 * out of scope for v1.0.0. A credential in front of it would be an obstacle with
 * nothing behind it — and one that had already produced three defects of its own:
 * two files holding the key and disagreeing (E2E-1), a runner secret the lane never
 * had (E2E-1's sibling), and a "this route is not public" check that was itself
 * authenticated and proved nothing.
 *
 * **What this means, stated plainly rather than left to be discovered.** Anything
 * that can reach the API can read every run, download every artifact, and cancel
 * runs. That is the correct posture for a box on an operator's own network, and it
 * is the wrong posture for the same box on a public interface. The boundary is the
 * network, so **bind the API to loopback** — `HOST=127.0.0.1`, which is already the
 * default — and put a reverse proxy in front of it if it must be reachable from
 * anywhere else.
 *
 * The session and key routes are still mounted: they mint nothing and are no longer
 * required, and a client that happens to send a credential is not refused for it.
 */

/**
 * The readiness probe's view of the durable bus, or nothing when there is none.
 *
 * Built once rather than inline at the call site: a `let` captured in a closure
 * loses its narrowing, so an inline `durableRealtimeBus === undefined ? … : …` is
 * checked against the `undefined` branch and the handler is typed as reporting
 * nothing — which is the opposite of what it does.
 */
const degradedRealtimeBus: (() => Record<string, string>) | undefined = (() => {
  if (durableRealtimeBus === undefined) return undefined;
  // The inner return is annotated because inference widens the empty `{}` to
  // `{ realtimeBus?: undefined }`, which is not assignable to
  // `Record<string, string>` — the error then lands on the *outer* assignment,
  // two dozen lines from the line that is actually wrong.
  return (): Record<string, string> => {
    const failure = durableRealtimeBus.lastPublishError();
    if (failure === null) return {};
    return {
      realtimeBus: failure instanceof Error ? failure.message : 'durable publish failed',
    };
  };
})();

app.route(
  '/',
  createHealthRoutes({
    databaseUrl: runtimeConfig.databaseUrl,
    checkDatabase: databaseResources
      ? async () => {
          await databaseResources.db.execute(sql`SELECT 1`);
        }
      : undefined,
    // The bus's own view of itself, ledger O-5b. Without this the readiness
    // endpoint knows only whether the database answers, so an instance whose bus
    // has been failing to publish for an hour reports `ready` — which is the one
    // condition a readiness probe exists to catch.
    degraded: degradedRealtimeBus,
  }),
);
app.route('/', authRoutes.app);
app.route(
  '/',
  createReporterRoutes(runtimeConfig.reporterSecret, {
    repository: runRepository,
    // The same store `GET /api/v1/reporting/kpis` reads. Without it an upload has nowhere
    // canonical to land, and every KPI would report the busiest system in the
    // installation as not knowable.
    canonicalStore: resolveReporterStore(),
    // The same workspace the execution routes resolve for a read. Without it the
    // reporter wrote NULL and every run a producer reported was invisible to
    // `GET /api/v1/runs` — persisted, and absent from the product.
    workspaceId: runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
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

/**
 * The project registry and the derived QA score.
 *
 * Mounted behind the same database handle as everything else, and **only when one
 * exists** — the registry is not useful without persistence, and a process that
 * booted without `DATABASE_URL` would otherwise answer a score request with an
 * empty one rather than with "this install has no registry".
 *
 * `startRun` is the one piece of this group that is not a pure read, and it is
 * injected rather than constructed here: the queue, the runner client and the
 * idempotency store are all assembled elsewhere, and a route group that builds its
 * own would be a second way to start a run.
 */
if (databaseResources !== undefined) {
  const registry: ProjectRegistryServiceOptions = {
    db: databaseResources.db as never,
    workspaceId: runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
    viewFor: (repoPath) => fileSystemView(repoPath),
  };
  app.route(
    '/',
    createProjectsRoutes({
      ...registry,
      // The coverage reader — the wire that was missing. See the function's own
      // doc comment: without it the score's `depth` component is `unknown` on
      // every cell, and a fifth of the total has been answering "no idea".
      readCoverageDocuments,
      // The score's photographs. Optional, so an install with no database omits
      // the key rather than carrying a store that cannot keep a point.
      ...(scorePointStore === null ? {} : { scorePoints: scorePointStore }),
      // The decision store, and it is the same store the API reads everywhere
      // else. The in-memory fallback is the honest one: an install with no
      // database has no durable place to record a verdict, and the route answers
      // `NOT_CONFIGURED` rather than pretending a verdict landed somewhere.
      ...(decisionStore === null ? {} : { decisionStore }),
      // The command's argv is **resolved by the route**, against the stored
      // profile, and travels here as data. An earlier note on this line said
      // resolving it at this depth would be a second place an executable could
      // enter the system; that was backwards. The authority is the profile, the
      // route already read it to validate the id, and a spec carrying only the
      // `commandId` left the runner with nothing to spawn — so every run fell
      // back to the Playwright smoke fixture. The write below carries the same
      // argv the runner needs, and it is still one authority: the profile.
      startRun: async (input) => {
        const created = await executionStore.create(
          {
            projectId: input.projectId,
            timeoutMs: input.timeoutMs,
            configuration: {
              commandId: input.commandId,
              // The shape the runner's `readGenericCommand` parses: an argv, a
              // working directory relative to the repository, the declared
              // artifact globs and the environment variable *names* the runner
              // resolves from its own environment.
              command: {
                argv: input.command.argv,
                workingDirectory: '.',
                artifactGlobs: input.command.artifactGlobs,
                env: input.command.env,
              },
            },
          },
          input.idempotencyKey,
          runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
        );
        return {
          runId: created.run.id,
          jobId: created.job.id,
          phase: created.run.phase,
        };
      },
    }),
  );
  /**
   * The registry points at the folder this install was pointed at, once, at boot.
   *
   * **Not a watcher and not a poll.** "The moment you open the folder" is satisfied
   * by the server starting when you start it, and a file watcher here would be a
   * second thing that decides what the cockpit shows.
   *
   * `discoverProjectAtBoot` owns the whole failure policy: an absent
   * `AUTOMATE_PROJECT_ROOT` logs and returns, and a discovery failure logs and
   * returns, because a dashboard that will not boot over a folder with no
   * `package.json` is worse than a dashboard with nothing in it.
   */
  await discoverProjectAtBoot(registry, runtimeConfig.projectRoot, logger);
}
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
