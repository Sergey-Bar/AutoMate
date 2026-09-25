/**
 * apps/server/src/index.ts — Automate server entry point
 *
 * Ports:
 *   4000 — REST API + static artifacts + browser WebSocket (/ws)
 *   4001 — Reporter WebSocket (/reporter)  ← ws-reporter.ts connects here
 */
// Sentry must be initialized before all other imports (ERR-02)
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  enabled: !!process.env.SENTRY_DSN,  // no-op when DSN not set
});

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as path from 'path';
import * as http from 'http';
import { WebSocketServer } from 'ws';

import { ReporterBridge } from './services/reporter-bridge.js';
import { startWatcher } from './services/watcher.js';
import { poolConnection } from './db/client.js';
import { backfillTrends } from './services/trend-backfill.js';
import { scheduler } from './services/scheduler.js';
import { createRetentionRunner } from './services/retention-runner.js';
import { runsRoutes } from './routes/runs.js';
import { testsRoutes } from './routes/tests.js';
import { configRoutes } from './routes/config.js';
import { analyticsRoutes } from './routes/analytics.js';
import { quarantineRoutes } from './routes/quarantine.js';
import { knownFailureRoutes } from './routes/known-failures.js';
import { schedulesRoutes } from './routes/schedules.js';
import { baselinesRoutes } from './routes/baselines.js';
import { codegenRoutes } from './routes/codegen.js';
import { testGenerationRoutes } from './routes/test-generation.js';
import { locatorSuggestionsRoutes } from './routes/locator-suggestions.js';
import { workspacesRoutes } from './routes/workspaces.js';
import { integrationsRoutes } from './routes/integrations.js';
import { gateRoutes } from './routes/gate.js';
import { categoriesRoutes } from './routes/categories.js';
import multipart from '@fastify/multipart';
import { ingestRoutes } from './routes/ingest.js';
import { badgeRoutes } from './routes/badges.js';
import { metricsRoutes } from './routes/metrics.js';
import { aiRoutes } from './services/ai-explain.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { nlQueryRoutes } from './routes/nl-query.js';
import { prIntegrationRoutes } from './routes/pr-integration.js';
import { errorClusteringRoutes } from './routes/error-clustering.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { registerRbacPlugin } from './plugins/rbac.js';
import { registerSamlPlugin } from './plugins/saml.js';
import { registerMcpAuthDecorators } from './mcp/auth.js';
import { registerMcpServer } from './mcp/server.js';
import { registerSwaggerPlugin } from './plugins/swagger.js';
import { registerRateLimitPlugin } from './plugins/rate-limit.js';
import { registerRequestLogger } from './plugins/request-logger.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { authRoutes } from './routes/auth.js';
import { getCookieSecret } from './services/auth.js';
import { registerServiceAuthPlugin } from './plugins/service-auth.js';
import { enforceStartupPolicy } from './services/startup-policy.js';
import { featuresRoutes } from './routes/features.js';
import { healthRoutes } from './routes/health.js';
import { sanitizeError } from './utils/sanitize-error.js';
import { runDrizzleMigrations } from './db/migrate.js';
import { auditRoutes } from './routes/admin/audit.js';
import { ciGateRoutes } from './routes/ci-gate.js';
import { serviceTriggerRoutes } from './routes/service-trigger.js';
import { sessionValidateRoutes } from './routes/session-validate.js';
import { registerCsrfPlugin } from './plugins/csrf.js';

const HOST = process.env.HOST ?? '0.0.0.0';
const API_PORT = Number(process.env.PORT ?? 4000);
const REPORTER_PORT = Number(process.env.REPORTER_PORT ?? 4001);
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), 'test-results');
const CLIENT_DIST = path.resolve(process.cwd(), '../client/dist');

// ── Fail-fast: enforce production startup policy ──────────────────────────────
// Checks COOKIE_SECRET, AUTOMATE_DASHBOARD_API_KEY, CORS_ORIGIN, REPORTER_SECRET.
// Exits on fatal violations; logs warnings for non-critical issues.
// (Previously this block only checked AUTOMATE_DASHBOARD_API_KEY inline.)

async function bootstrap() {
  // ── Shared bridge ──────────────────────────────────────────────────────
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 102400, // 100KB request size limit for JSON/text payloads
  });

  // Enforce startup policy before any plugin/route registration.
  // Exits immediately on fatal violations (insecure secrets, missing API key).
  enforceStartupPolicy(app.log);

  // Run Drizzle Kit migrations when AUTO_MIGRATE=true.
  // Idempotent: only unapplied migrations are executed.
  // For Docker deployments, set AUTO_MIGRATE=true in your environment.
  // For manual production deploys: run `pnpm db:migrate` before starting.
  if (process.env.AUTO_MIGRATE === 'true') {
    app.log.info('[db] Running Drizzle migrations...');
    try {
      runDrizzleMigrations();
      app.log.info('[db] Drizzle migrations applied successfully');
    } catch (err) {
      app.log.error({ err }, '[db] Migration failed — aborting startup');
      process.exit(1);
    }
  }

  const bridge = new ReporterBridge(app.log);

  // Attach Sentry error handler BEFORE routes (ERR-02)
  Sentry.setupFastifyErrorHandler(app);

  // ── Plugins ────────────────────────────────────────────────────────────
  // CORS hardening: reject wildcard origin when credentials are enabled.
  // In production, CORS_ORIGIN must be explicitly set to a specific origin.
  // Note: startup-policy also checks CORS_ORIGIN and logs a warning at startup.
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  if (process.env.NODE_ENV === 'production' && (corsOrigin === '*' || !process.env.CORS_ORIGIN)) {
    app.log.warn(
      'CORS_ORIGIN is not set or set to "*" in production. ' +
        'Falling back to restrictive same-origin policy. ' +
        'Set CORS_ORIGIN to your dashboard URL (e.g. https://dashboard.example.com).',
    );
  }
  await app.register(cors, {
    origin:
      process.env.NODE_ENV === 'production' && (corsOrigin === '*' || !process.env.CORS_ORIGIN)
        ? false // `origin: false` omits CORS headers → browsers block cross-origin requests (same-origin only)
        : corsOrigin,
    credentials: true,
  });
  await app.register(cookie, {
    secret: getCookieSecret(),
  });

  // CSRF protection for cookie-auth mutation routes
  await registerCsrfPlugin(app);

  await app.register(fastifyStatic, {
    root: ARTIFACTS_DIR,
    prefix: '/artifacts/',
    decorateReply: true,
  });

  await app.register(fastifyWebsocket);
  await registerRateLimitPlugin(app);
  await registerRequestLogger(app);
  await registerSecurityHeaders(app);
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await registerSwaggerPlugin(app);
  await registerAuthPlugin(app);
  await registerServiceAuthPlugin(app, { serviceSecret: process.env.AUTOMATE_SERVICE_SECRET });
  await registerRbacPlugin(app);
  await registerSamlPlugin(app);
  registerMcpAuthDecorators(app);
  await registerMcpServer(app);

  // ── Browser WebSocket (/ws) ────────────────────────────────────────────
  app.register(async (ws) => {
    ws.get<{ Querystring: { runId?: string } }>(
      '/ws',
      { websocket: true },
      (socket, req) => {
        bridge.addClient(socket as unknown as import('ws').WebSocket, req.query.runId);
        socket.send(JSON.stringify({ type: 'connected', payload: {} }));

        // Respond to client heartbeat pings (RELY-03)
        socket.on('message', (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString()) as { type?: string };
            if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
          } catch { /* ignore malformed messages */ }
        });
      },
    );
  });

  // ── REST routes ────────────────────────────────────────────────────────
  await authRoutes(app);
  await runsRoutes(app, { bridge });
  await testsRoutes(app);
  await configRoutes(app);
  await analyticsRoutes(app);
  await quarantineRoutes(app);
  await knownFailureRoutes(app);
  await schedulesRoutes(app);
  await baselinesRoutes(app);
  await codegenRoutes(app);
  await testGenerationRoutes(app);
  await locatorSuggestionsRoutes(app);
  await workspacesRoutes(app);
  await integrationsRoutes(app);
  await app.register(gateRoutes);
  await app.register(categoriesRoutes);
  await app.register(ingestRoutes);
  await badgeRoutes(app);
  await metricsRoutes(app);
  await aiRoutes(app);
  await registerSettingsRoutes(app);
  await nlQueryRoutes(app);
  await prIntegrationRoutes(app);
  await featuresRoutes(app);
  await errorClusteringRoutes(app);
  await auditRoutes(app);
  await ciGateRoutes(app);
  await app.register(serviceTriggerRoutes, { serviceSecret: process.env.AUTOMATE_SERVICE_SECRET });
  await sessionValidateRoutes(app, { serviceSecret: process.env.AUTOMATE_SERVICE_SECRET });

  // Health endpoints (liveness, readiness, startup probes + legacy alias)
  const SERVER_VERSION = process.env.npm_package_version ?? '2.0.0';
  await healthRoutes(app, { sqlite: poolConnection, version: SERVER_VERSION });

  // ── Serve built client SPA (production) ───────────────────────────────
  try {
    await app.register(fastifyStatic, {
      root: CLIENT_DIST,
      prefix: '/',
      decorateReply: false,
    });
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html', CLIENT_DIST);
    });
  } catch {
    app.log.info('Client dist not found — run `pnpm --filter client build` for production mode');
  }

  // ── Start API server ───────────────────────────────────────────────────
  await app.listen({ host: HOST, port: API_PORT });
  app.log.info(`API server listening on http://${HOST}:${API_PORT}`);

  // ── Reporter WebSocket server (separate port) ──────────────────────────
  const reporterServer = http.createServer();
  const reporterSecret = process.env.REPORTER_SECRET;
  const reporterWss = new WebSocketServer({
    server: reporterServer,
    path: '/reporter',
    verifyClient: (info, cb) => {
      if (!reporterSecret) {
        // No secret configured — allow all connections (backward compatible)
        cb(true);
        return;
      }
      const url = new URL(info.req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token') ?? info.req.headers['x-reporter-token'] as string;
      if (token === reporterSecret) {
        cb(true);
      } else {
        app.log.warn('[reporter] Rejected connection — invalid or missing token');
        cb(false, 401, 'Unauthorized');
      }
    },
  });

  reporterWss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url ?? '', 'http://localhost');
    const versionStr = reqUrl.searchParams.get('protocolVersion');
    const SUPPORTED_VERSION = 1;

    if (versionStr === null) {
      app.log.warn('[reporter] ws-reporter connected without protocolVersion (old reporter — treating as version 0)');
    } else {
      const version = parseInt(versionStr, 10);
      if (version > SUPPORTED_VERSION) {
        app.log.warn(`[reporter] ws-reporter rejected — unsupported protocol version ${version} (max: ${SUPPORTED_VERSION})`);
        ws.close(4400, 'Unsupported protocol version');
        return;
      }
      app.log.info(`[reporter] ws-reporter connected, protocol version: ${version}`);
    }

    ws.on('message', (raw) => bridge.handleReporterEvent(raw.toString()));
    ws.on('error', (err) => app.log.warn({ err }, '[reporter] WebSocket error'));
    ws.on('close', () => app.log.info('[reporter] ws-reporter disconnected'));
  });

  reporterServer.listen(REPORTER_PORT, HOST, () => {
    app.log.info(`Reporter WS listening on ws://${HOST}:${REPORTER_PORT}/reporter`);
  });

  // ── Artifact watcher ──────────────────────────────────────────────────
  const watcher = startWatcher(ARTIFACTS_DIR, bridge);
  app.log.info(`Watching artifacts: ${ARTIFACTS_DIR}`);

  // ── Trend backfill (tracked for graceful shutdown) ────────────────────
  const backfillPromise = backfillTrends(90)
    .then(() => app.log.info('Trend backfill complete'))
    .catch((err) => app.log.error({ err }, 'Trend backfill failed'));

  // ── Retention cleanup runner ──────────────────────────────────────────
  const retentionRunner = createRetentionRunner({ logger: app.log });
  retentionRunner.start();

  // ── Graceful shutdown (RELY-06) ────────────────────────────────────────
  async function shutdown(signal: string) {
    app.log.info(`[shutdown] ${signal} received — beginning graceful shutdown`);
    try {
      if (watcher) await watcher.close();   // close chokidar watcher
      scheduler.stop();                   // stop all cron timers
      retentionRunner.stop();             // stop retention cleanup runner
      await app.close();                  // drain Fastify in-flight requests

      // Wait for in-flight backfill to finish (with 5s timeout)
      await Promise.race([
        backfillPromise,
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);

      // Close reporter WS server + HTTP server (promisified)
      reporterWss.close();
      await new Promise<void>((resolve, reject) =>
        reporterServer.close((err) => (err ? reject(err) : resolve())),
      );

      await poolConnection.end();                 // close Postgres connection pool
      app.log.info('[shutdown] clean exit (0)');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, '[shutdown] error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// ── Global error handlers ────────────────────────────────────────────────────
// Intentionally non-fatal: log and report, but keep the server running.
// Node.js may make unhandled rejections fatal in a future major version.
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', sanitizeError(reason));
  Sentry.captureException(reason);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', sanitizeError(err));
  Sentry.captureException(err);
  process.exit(1);
});

bootstrap().catch((err) => {
  process.stderr.write(`[FATAL] Bootstrap failed: ${(err as Error).message ?? String(err)}\n`);
  process.exit(1);
});
