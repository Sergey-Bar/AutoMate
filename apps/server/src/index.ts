import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { chatRoutes, type ChatDeps } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { connectorRoutes } from './routes/connectors.js';
import { featureRoutes } from './routes/features.js';
import { openApiRoutes } from './routes/openapi.js';
import { postmanRoutes } from './routes/postman.js';
import { aiTestGenRoutes } from './routes/ai-test-gen.js';
import { testGenerationRoutes } from './routes/test-generation.js';
import { healthUnifiedRoutes } from './routes/health-unified.js';
import { modelConfigRoutes } from './routes/model-config.js';
import { vaultRoutes } from './routes/vault.js';
import { wsRoutes } from './routes/ws.js';
import { runCallbackRoutes } from './routes/run-callback.js';
import { ConnectorRegistry } from './connectors/registry.js';
import { EventHub } from './services/event-hub.js';
import { githubManifest } from '@automate/connector-github';
import { jiraManifest } from '@automate/connector-jira';
import { slackManifest } from '@automate/connector-slack';
import { dashboardManifest } from '@automate/connector-dashboard';
import { createVaultService } from './vault/service.js';
import { migrateDb, runDrizzleMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { db, closeDb } from './db/client.js';
import { flowTemplates, modelConfig } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { createDrizzleMemory } from './agent/memory-drizzle.js';
import { isEnabled } from './services/feature-flags.js';
import {
  buildDashboardMcpConnectorManifest,
  getDashboardMcpContractValidationState,
} from './connectors/mcp-connector.js';
import { gateOrchestratorManifest } from './connectors/gate-orchestrator.js';
import { traceabilityManifest } from './connectors/traceability.js';
import { buildMcpContractHealthEvent } from './services/connector-health.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { registerServiceAuthPlugin } from './plugins/service-auth.js';
import { registerSwaggerPlugin } from './plugins/swagger.js';
import { registerCookieIntrospectionPlugin } from './plugins/cookie-introspection.js';
import { cookieAuthPreHandler } from './plugins/cookie-auth-prehandler.js';

export interface ServerOptions {
  logger?: boolean;
  vaultDbPath?: string;
  vaultPassword?: string;
  rateLimitMax?: number;
  rateLimitWindow?: string;
  apiKey?: string;
}

export async function buildServer(options?: ServerOptions) {
  const app = Fastify({
    logger: options?.logger ?? false,
    bodyLimit: 102400, // 100KB request size limit for JSON/text payloads
  });

  // Initialize database - create tables and seed defaults.
  // AUTO_MIGRATE=true: use Drizzle Kit migrations (production-safe, tracked in git).
  // Default: fast CREATE TABLE IF NOT EXISTS path (dev / test compatible).
  if (process.env.AUTO_MIGRATE === 'true') {
    console.log('[db] Running Drizzle migrations...');
    await runDrizzleMigrations();
    console.log('[db] Drizzle migrations applied');
  } else {
    await migrateDb();
  }
  await seed();

  // Create Drizzle-backed memory repository
  const memory = createDrizzleMemory(db);

  // Initialize connector registry
  const registry = new ConnectorRegistry();
  registry.registerManifest(githubManifest);
  registry.registerManifest(jiraManifest);
  registry.registerManifest(slackManifest);

  // Create EventHub for real-time event broadcasting
  const eventHub = new EventHub(app.log);

  if (isEnabled('mcp-client')) {
    try {
      const mcpManifest = await buildDashboardMcpConnectorManifest(undefined, app.log);
      registry.registerManifest(mcpManifest);
      const validationState = getDashboardMcpContractValidationState();

      eventHub.broadcast(buildMcpContractHealthEvent(
        validationState.contractVersion,
        validationState.validationStatus,
        validationState.lastValidationTimestamp,
        validationState.diagnostics,
      ));

      if (mcpManifest.tools.length === 0) {
        app.log.warn({ connector: mcpManifest.name }, mcpManifest.description);
      }
    } catch (error) {
      app.log.error({ err: error }, 'Failed to register dashboard MCP connector');
    }
  }

  if (isEnabled('dashboard-connector')) {
    registry.registerManifest(dashboardManifest);
    app.log.info({ connector: dashboardManifest.name }, '[dashboard] Dashboard connector registered');
  }

  if (isEnabled('quality-gate-orchestration')) {
    registry.registerManifest(gateOrchestratorManifest);
    app.log.info({ connector: gateOrchestratorManifest.name }, '[gate_orchestrator] Quality gate orchestration connector registered');
  }

  registry.registerManifest(traceabilityManifest);

  // Register CORS — restrictive by default, configurable via CORS_ORIGIN env var.
  // In development defaults to the Vite dev server; in production requires explicit config.
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  await app.register(cors, {
    origin: corsOrigin === '*' ? true : corsOrigin,
    credentials: true,
  });
  // Register WebSocket plugin
  await app.register(websocket);
  // Register security headers
  await registerSecurityHeaders(app);
  // Register auth plugin (no-op when AUTOMATE_API_KEY is not set)
  await registerAuthPlugin(app, { apiKey: options?.apiKey });
  await registerServiceAuthPlugin(app, { serviceSecret: process.env.AUTOMATE_SERVICE_SECRET });
  await app.register(runCallbackRoutes, {
    serviceSecret: process.env.AUTOMATE_SERVICE_SECRET,
    ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    model: process.env.AUTOMATE_MODEL ?? 'llama3.1',
    dashboardApiUrl: process.env.DASHBOARD_API_URL,
  });

  // Unified auth gateway: introspect Dashboard session cookies when enabled
  if (isEnabled('unified-auth')) {
    await registerCookieIntrospectionPlugin(app, {
      dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:4000',
      serviceSecret: process.env.AUTOMATE_SERVICE_SECRET ?? '',
    });
  }
  // Add cookie auth preHandler globally (no-ops when unified-auth flag is off)
  app.addHook('preHandler', cookieAuthPreHandler);
  // Register rate limiting (global: false means we control per-route)
  await app.register(rateLimit, {
    global: false,
    max: options?.rateLimitMax ?? 100,
    timeWindow: options?.rateLimitWindow ?? '1 minute',
  });

  // Register Swagger / OpenAPI documentation
  await registerSwaggerPlugin(app);

  // Health endpoint - no rate limiting
  app.get('/health', {
    config: { rateLimit: false },
  }, async () => {
    let ollamaStatus = 'unknown';
    try {
      const res = await fetch(
        `${process.env.OLLAMA_HOST ?? 'http://localhost:11434'}/api/tags`,
        { signal: AbortSignal.timeout(3000) },
      );
      ollamaStatus = res.ok ? 'connected' : 'error';
    } catch {
      ollamaStatus = 'disconnected';
    }

    return {
      status: 'ok',
      version: '1.0.0',
      db: 'connected',
      ollama: ollamaStatus,
      uptime: process.uptime(),
    };
  });

  await app.register(healthUnifiedRoutes, {
    dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:4000',
  });

  // Configure vault service — always create if dbPath given (legacy opt-in), optionally auto-unlock
  let vaultService: ReturnType<typeof createVaultService> | null = null;
  if (options?.vaultDbPath) {
    vaultService = createVaultService();
    if (options?.vaultPassword) {
      await vaultService.unlock(options.vaultPassword);
    }
  }

  // Register onClose hook to clean up DB connections on shutdown
  app.addHook('onClose', async () => {
    if (vaultService) vaultService.close();
    await closeDb();
  });

  // Rate limit config for chat endpoint
  const chatRateLimitConfig = {
    rateLimit: {
      max: options?.rateLimitMax ?? 100,
      timeWindow: options?.rateLimitWindow ?? '1 minute',
    },
  };

  // Chat dependencies using new ChatDeps interface
  const chatDeps: ChatDeps = {
    memory,
    registry,
    getModelConfig: async () => {
      const rows = await db.select().from(modelConfig).where(eq(modelConfig.id, 'default'));
      const row = rows[0];
      return {
        provider: row?.provider ?? 'ollama',
        model: row?.model ?? (process.env.AUTOMATE_MODEL ?? 'llama3.1'),
        endpoint: row?.endpoint ?? (process.env.AUTOMATE_ENDPOINT ?? 'http://localhost:11434'),
        temperature: row?.temperature ?? Number(process.env.AUTOMATE_TEMPERATURE ?? 0.7),
        maxTokens: row?.maxTokens ?? Number(process.env.AUTOMATE_MAX_TOKENS ?? 4096),
      };
    },
    getCredentials: async () => {
      if (!vaultService) return {};
      const manifests = registry.listManifests();
      const results = await Promise.all(
        manifests.map(async (manifest) => {
          const raw = await vaultService!.getCredential(manifest.name);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null) {
              const filtered: Record<string, string> = {};
              for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === 'string') filtered[k] = v;
              }
              return { name: manifest.name, creds: filtered };
            }
          } catch {
            // Skip malformed credentials
          }
          return null;
        })
      );
      const creds: Record<string, Record<string, string>> = {};
      for (const result of results) {
        if (result) creds[result.name] = result.creds;
      }
      return creds;
    },
    getSystemPrompt: () => `You are Automate, an AI assistant for QA automation.

Like my namesake, I lead with wisdom, protect your workflows, and transform chaos into order.
I am the last line of defense against bugs, regressions, and flaky tests.
Till all tests pass.

I can help with:
- Creating GitHub issues and PR comments
- Managing Jira tickets
- Sending Slack notifications
- Analyzing test results
- Orchestrating test automation workflows

I operate entirely on-premise \u2014 your data never leaves your network.`,
    getFlowTemplate: async (id: string) => {
      const rows = await db.select().from(flowTemplates).where(eq(flowTemplates.id, id)).limit(1);
      return rows[0];
    },
    rateLimitConfig: chatRateLimitConfig,
    eventHub,
  };

  await app.register((instance, _opts, done) => {
    chatRoutes(instance, chatDeps).then(() => done()).catch(done);
  });
  await app.register(conversationRoutes, { memory });
  await app.register((instance, _opts, done) => {
    connectorRoutes(instance, { registry }).then(() => done()).catch(done);
  });
  await app.register((instance, _opts, done) => {
    featureRoutes(instance).then(() => done()).catch(done);
  });
  await app.register((instance, _opts, done) => {
    modelConfigRoutes(instance).then(() => done()).catch(done);
  });
  if (vaultService) {
    await app.register((instance, _opts, done) => {
      vaultRoutes(instance, {
        vaultService: vaultService!,
        expectedPassword: options?.vaultPassword,
      }).then(() => done()).catch(done);
    });
  }
  await app.register((instance, _opts, done) => {
    wsRoutes(instance, { eventHub }).then(() => done()).catch(done);
  });
  await app.register((instance, _opts, done) => {
    openApiRoutes(instance).then(() => done()).catch(done);
  });
  await app.register((instance, _opts, done) => {
    postmanRoutes(instance).then(() => done()).catch(done);
  });
  await app.register((instance, _opts, done) => {
    aiTestGenRoutes(instance).then(() => done()).catch(done);
  });
  await app.register((instance, _opts, done) => {
    testGenerationRoutes(instance).then(() => done()).catch(done);
  });

  return app;
}

// Start server when run directly (not imported for testing)
const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isDirectRun) {
  // ── Global error handlers (production only — not in test environment) ──────
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });

  const app = await buildServer({
    logger: true,
    vaultDbPath: process.env.VAULT_DB_PATH ?? path.join(process.cwd(), '.automate-vault.db'),
    vaultPassword: process.env.VAULT_PASSWORD,
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    apiKey: process.env.AUTOMATE_API_KEY,
  });
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
