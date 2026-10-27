import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod/v4';
import {
  CopilotQuestionSchema,
  GitRepositoryUrlSchema,
  RunStartBodySchema,
  RunStopBodySchema,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { qaScore, stopRun } from '../services/qa-score-service.js';
import { answer } from '../services/copilot-service.js';
import {
  createRepoScanner,
  resolveCommand,
  type RepoScanner,
  type ResolvedCommand,
} from '../services/repo-scan-service.js';
import { diffScores } from '@automate/projects';
import { evaluateReadiness } from '@automate/reporting';
import type { ProjectHistory } from '@automate/shared-contracts';
import { DEFAULT_QUALITY_POLICY } from '../execution/quality-gate.js';
import { belongsTo } from '../execution/insights.js';
import { readSince, startOfDay } from '../execution/trend.js';
import type { ExecutionRun, ExecutionStore } from '../execution/types.js';
import {
  hasSnapshotFor,
  meanCoverage,
  passRateThreshold,
  readHistory,
  recordSnapshot,
} from '../services/scan-history-service.js';
import {
  ensureWorkspace,
  getProject,
  listCommands,
  listProjects,
  refreshProject,
  registerGitProject,
  registerProject,
  type ProjectRegistryServiceOptions,
} from '../services/project-registry-service.js';
import { storeGitToken } from '../services/git-credential-service.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import type { SecureCookies } from '../http/secure-cookies.js';
import { createAccessRoutes } from './access.js';
import { createAuditRoutes } from './audit.js';
import { createMembersRoutes } from './members.js';
import { createScimRoutes } from './scim.js';
import { defaultClientKey } from './auth.js';
import { createPairingRoutes } from './pairing.js';
import { createNotificationRoutes } from './notifications.js';
import { audit, authenticateToken } from '../services/access-service.js';
import { qaTestsReading } from '../services/repo-health-service.js';
import { ingestHealthReport, ingestParsedReport } from '../services/repo-health-service.js';
import type { AiGateway } from '@automate/automation';
import { agentRuntimeReading } from '../services/genai-span-service.js';
import { evalGateReading } from '../services/eval-service.js';
import { scanLocalAgentConfig, type AgentConfigOptions } from '../services/agent-config-service.js';
import { createAgentQualityRoutes } from './agent-quality.js';
import { deliveryReading } from '../services/delivery-service.js';
import {
  aiCodeReading,
  aiGovernanceCheck,
  recordGateFindings,
} from '../services/ai-code-service.js';
import { createAiCodeRoutes } from './ai-code.js';
import { createScorecardRoutes } from './scorecards.js';
import { createMcpRoutes } from './mcp.js';
import { uploaderGuard } from '../http/uploader.js';
import { createDeliveryRoutes } from './delivery.js';
import { createGitHubWebhookRoutes } from './github-webhook.js';
import { createIssueTrackingRoutes } from './issue-tracking.js';
import { createTestProposalRoutes } from './test-proposals.js';
import { createTestReportRoutes, type TestReportSink } from './test-reports.js';
import { createShardPlanRoutes } from './shard-plan.js';
import type { RunRepository } from '../repositories/run-repository.js';
import {
  createProjectQuarantineRoutes,
  type ProjectQuarantineSource,
} from './project-quarantine.js';
import { createTriageLabelRoutes } from './triage-labels.js';
import type { IssueAdapters } from '../services/issue-tracker-service.js';
import { createRepoHealthRoutes, type RepoHealthRouteOptions } from './repo-health.js';

/**
 * The project registry and the derived QA score, as one route group.
 *
 * ## Nothing here accepts an executable
 *
 * `POST /projects/:id/run.start` takes a **command id**, resolved server-side
 * against the stored profile. There is deliberately no body field for an argv: a
 * body that could carry one would make the typed command registry advisory, because
 * a caller could send any executable and the registry would be consulted only to be
 * overridden. Correcting a detected command is a *profile edit* — `automate.config.json`
 * or `PATCH /projects/:id` — which is reviewable, version-controlled, and says why.
 *
 * ## Every number is served with its limiter
 *
 * `GET /qa/score` returns `cappedBy` and `cappingValue` as required fields. A total
 * from a weighted geometric mean cannot be diluted by a zero, and for exactly that
 * reason it cannot be diagnosed either; a client rendering the total without the term
 * that limited it is showing an arithmetic score's worth of information from a
 * geometric formula, and the reader has no reason to distrust it.
 */
export interface ProjectsRouteOptions extends ProjectRegistryServiceOptions {
  /** Who is calling. Absent: access is open, and access tokens are read from this database. */
  access?: CallerResolver;
  /** Whether the sign-in cookie is Secure: fixed, or decided per request. */
  secureCookies?: SecureCookies;
  /** Whether `X-Forwarded-For` was written by our proxy. See {@link defaultClientKey}. */
  trustProxy?: boolean;
  /** Device pairing: the code pepper and where a pairing link points. Absent: refused. */
  pairing?: { pepper: string; publicAppUrl: string };
  /** Scheduled reports: the link a report carries, and a send-now for test sends. */
  notifications?: { link: string | null; dispatchNow?: () => Promise<unknown> };
  /** Seals a git token on registration. Absent: tokens are refused. */
  vaultSecret?: string | undefined;
  /**
   * Starts a run. Injected so the routes have no database and no queue in them.
   *
   * `command` is the argv **this route** resolved from the profile or the scan. The
   * caller wires it into the job's configuration as-is: resolving it a second time
   * further down would be a second place an executable could enter the system.
   */
  startRun: (input: {
    projectId: string;
    commandId: string;
    command: ResolvedCommand;
    idempotencyKey: string;
    timeoutMs?: number;
  }) => Promise<{ runId: string; jobId: string; phase: string }>;
  /** The repository scan. Defaults to one over `viewFor`. */
  scanner?: RepoScanner;
  /**
   * What the readiness card reads beyond the registry: the run history and the count of
   * quarantined tests awaiting a decision. Absent, the readiness route is not mounted —
   * an install with no run store has no readiness to report.
   */
  reliability?: {
    store: ExecutionStore;
    openQuarantine: () => Promise<number>;
    now?: () => Date;
  };
  /** The health upload credential: the reporter secret, and whether one is required. */
  health?: Partial<Omit<RepoHealthRouteOptions, 'db' | 'workspaceId' | 'access'>>;
  /**
   * Delivery performance. `lanMode` and `webhookSecret` together turn the GitHub webhook
   * receiver on; `syncNow` runs queued syncs at once after a request queues one.
   */
  delivery?: { lanMode?: boolean; webhookSecret?: string; syncNow?: () => Promise<unknown> };
  /** The role a person provisioned over SCIM starts with: `OIDC_DEFAULT_ROLE`, or viewer. */
  scimDefaultRole?: 'viewer' | 'operator' | 'admin';
  /**
   * The built-in eval runner's model access: the configured gateway (`null` when no provider
   * is configured, and runs are refused `NOT_CONFIGURED`) and its provider name.
   */
  agents?: {
    gateway: AiGateway | null;
    provider: string | null;
    onRunFailure?: (error: unknown) => void;
  };
  /** The connectors an issue from a finding or a failure cluster is created through. */
  issues?: IssueAdapters;
  /**
   * The gateway a test proposal asks: the composition root's **instrumented** one, so each
   * proposal is a GenAI span. `null` when no provider is configured: proposals are refused.
   */
  testProposals?: { gateway: AiGateway | null; provider: string | null };
  /**
   * Where a CI job's test report is recorded and what quarantine it is judged against.
   * Absent: `POST /api/v1/projects/:id/tests/reports` is not mounted.
   */
  testReports?: TestReportSink;
  /**
   * The run history a shard plan reads its durations from. Absent:
   * `POST /api/v1/projects/:id/shards/plan` answers NOT_CONFIGURED.
   */
  shardHistory?: Pick<RunRepository, 'fileDurations'>;
  /**
   * The quarantine store and the run history a project's quarantine view and its
   * auto-quarantine policy read. Absent: the view answers NOT_CONFIGURED.
   */
  quarantine?: ProjectQuarantineSource;
}

const DAY_MS = 86_400_000;
const WINDOWS = [7, 14, 30, 90] as const;

function windowDays(value: string | undefined, fallback: number): number {
  const requested = Number(value ?? String(fallback));
  return (WINDOWS as readonly number[]).includes(requested) ? requested : fallback;
}

/** A percentage of runs with a verdict, so a cancelled run neither passes nor fails. */
function verdictRate(runs: readonly ExecutionRun[]): number | null {
  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  return passed + failed === 0 ? null : Math.round((passed / (passed + failed)) * 1000) / 10;
}

const RegisterProjectBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(1)
      .max(64)
      // A slug becomes a directory name in some installs and a URL segment in others.
      // Restricting it here means no caller has to sanitise it downstream, and a slug
      // that could carry `..` or a shell metacharacter is one more thing to defend
      // against at every use.
      .regex(/^[a-z0-9][a-z0-9._-]*$/u),
    /** Absolute path on the runner host. The runner spawns in it. */
    repoPath: z.string().min(1).optional(),
    /** Or a repository a runner clones for each scan. Never both. */
    gitUrl: GitRepositoryUrlSchema.optional(),
    defaultBranch: z.string().trim().min(1).max(255).optional(),
    /**
     * An access token for a private repository. Sealed in the vault on arrival and never
     * returned, stored on the row, or written into a job.
     */
    token: z.string().min(1).max(4000).optional(),
  })
  .refine((body) => (body.repoPath === undefined) !== (body.gitUrl === undefined), {
    message: 'a project is registered by exactly one of repoPath and gitUrl',
    path: ['repoPath'],
  })
  // `'token' in body`, not a comparison: whether a credential was sent is a question about
  // the key, and nothing about its value is compared here.
  .refine((body) => !('token' in body) || body.gitUrl !== undefined, {
    message: 'a token is only accepted with a gitUrl',
    path: ['token'],
  });

/**
 * A JSON body, or `null` when it is not one.
 *
 * `context.req.json()` **rejects** on a malformed body, and a route that only
 * throws a `DomainError` would surface that rejection to the app's error handler as
 * a 500 — telling an operator that their request was our fault when they sent one
 * byte of punctuation short of JSON. Returning `null` instead lets the Zod parse
 * fail and answer 400, which is what a malformed request is.
 *
 * The alternative — a `try`/`catch` per handler — was what this file had before, and
 * it was the reason this bug survived: four handlers, four `catch`es, and the one
 * that mattered was in a handler nobody had exercised.
 */
async function readJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

/** A parsed body spread into an object literal, so `null` does not throw. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The workspace's run history since a moment, or undefined when there is no run store. */
function historyReader(
  options: ProjectsRouteOptions,
): ((since: Date) => Promise<ExecutionRun[]>) | undefined {
  const store = options.reliability?.store;
  if (store === undefined) return undefined;
  return async (since) => (await readSince(store, options.workspaceId, since.getTime())).runs;
}

export function createProjectsRoutes(options: ProjectsRouteOptions): Hono {
  const app = new Hono();
  const scanner = options.scanner ?? createRepoScanner({ viewFor: options.viewFor });
  const access: CallerResolver = options.access ?? {
    mode: 'open',
    authenticateToken: (token) => authenticateToken(options, token),
    hasSession: async () => false,
  };
  const viewer = requireRole('viewer', access);
  const operator = requireRole('operator', access);
  /** Whether the project is registered in this workspace. */
  const projectExists = async (projectId: string): Promise<boolean> =>
    getProject(options, projectId).then(
      () => true,
      (error: unknown) => {
        if (error instanceof DomainError && error.code === ErrorCode.NOT_FOUND) return false;
        throw error;
      },
    );
  app.route(
    '/',
    createAccessRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      access,
      ...(options.secureCookies === undefined ? {} : { secureCookies: options.secureCookies }),
      ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
    }),
  );
  // The audit trail, its export and its chain (ADR-014, enterprise). Admin only.
  app.route('/', createAuditRoutes({ db: options.db, workspaceId: options.workspaceId, access }));
  // The people who signed in with single sign-on, and their roles here. Admin only.
  app.route('/', createMembersRoutes({ db: options.db, workspaceId: options.workspaceId, access }));
  // SCIM provisioning (ADR-014, enterprise): scoped to each SCIM token's own workspace.
  app.route(
    '/',
    createScimRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      access,
      ...(options.scimDefaultRole === undefined ? {} : { defaultRole: options.scimDefaultRole }),
    }),
  );
  // Pairing mints access tokens, so it lives where they do: beside the access routes.
  app.route(
    '/',
    createPairingRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      access,
      pepper: options.pairing?.pepper,
      publicAppUrl: options.pairing?.publicAppUrl ?? 'http://localhost:8080',
      clientKey: (context) => defaultClientKey(context, options.trustProxy ?? false),
      ...(options.secureCookies === undefined ? {} : { secureCookies: options.secureCookies }),
    }),
  );
  // Scheduled reports. The channel credentials are vault entries, so this needs the vault.
  app.route(
    '/',
    createNotificationRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      vaultSecret: options.vaultSecret,
      access,
      link: options.notifications?.link ?? null,
      ...(options.notifications?.dispatchNow === undefined
        ? {}
        : { dispatchNow: options.notifications.dispatchNow }),
    }),
  );
  // Repository health is part of the registry: every health route is about a registered project.
  const store = { db: options.db, workspaceId: options.workspaceId };
  // The run history the test-effectiveness card and the MCP tools read; absent without a store.
  const history = historyReader(options);
  const ingestParsed: AgentConfigOptions['ingestParsed'] = (input, parsed) =>
    ingestParsedReport(healthOptions, input, parsed);
  const healthOptions: RepoHealthRouteOptions = {
    ...store,
    access,
    testsReading: (projectId) => qaTestsReading(options, projectId, new Date()),
    deliveryReading: (projectId) => deliveryReading(options, projectId),
    aiCodeReading: (projectId) => aiCodeReading(options, projectId),
    aiGovernance: (projectId, pullRequest, facts) =>
      aiGovernanceCheck(options, projectId, pullRequest, facts),
    onGateReport: (projectId, report) => recordGateFindings(options, projectId, report),
    agentRuntimeReading: (projectId) => agentRuntimeReading(store, projectId),
    evalGateReading: (projectId, branch, commit) =>
      evalGateReading(store, projectId, branch, commit),
    agentConfigScan: (projectId) => scanLocalAgentConfig({ ...store, ingestParsed }, projectId),
    ...options.health,
  };
  app.route('/', createRepoHealthRoutes(healthOptions));
  // The read-only MCP server: the same health options, so a tool and a route cannot disagree.
  app.route(
    '/',
    createMcpRoutes({
      access,
      health: healthOptions,
      history,
    }),
  );
  // Agent quality: evals, OTLP traces, runtime, the MCP inventory and the built-in eval runner.
  app.route(
    '/',
    createAgentQualityRoutes({
      ...store,
      access,
      uploader: uploaderGuard({
        access,
        reporterSecret: options.health?.reporterSecret,
        requireReporterSecret: options.health?.requireReporterSecret,
      }),
      otlpUploader: uploaderGuard({
        access,
        reporterSecret: options.health?.reporterSecret,
        requireReporterSecret: true,
      }),
      ingest: (input) => ingestHealthReport(healthOptions, input),
      ingestParsed,
      gateway: options.agents?.gateway ?? null,
      provider: options.agents?.provider ?? null,
      ...(options.agents?.onRunFailure === undefined
        ? {}
        : { onRunFailure: options.agents.onRunFailure }),
    }),
  );
  // AI-written code: read-only scorecards over what the delivery sync attributed.
  app.route('/', createAiCodeRoutes({ db: options.db, workspaceId: options.workspaceId, access }));
  // A CI job's test report and the quarantine verdict `automate test` acts on. Mounted
  // always, so the authz matrix lists it; without its stores it answers NOT_CONFIGURED.
  app.route(
    '/',
    createProjectQuarantineRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      viewer,
      admin: requireRole('admin', access),
      actorOf: async (context) => (await callerOf(context, access)).actor,
      source: options.quarantine,
    }),
  );
  app.route(
    '/',
    createTriageLabelRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      viewer,
      operator,
      actorOf: async (context) => (await callerOf(context, access)).actor,
    }),
  );
  app.route(
    '/',
    createTestReportRoutes({
      sink: options.testReports,
      workspaceId: options.workspaceId,
      uploader: uploaderGuard({
        access,
        reporterSecret: options.health?.reporterSecret,
        requireReporterSecret: options.health?.requireReporterSecret,
      }),
      projectExists,
    }),
  );
  // Which files each CI shard runs: the same CI credential, one step before the report.
  app.route(
    '/',
    createShardPlanRoutes({
      repository: options.shardHistory,
      uploader: uploaderGuard({
        access,
        reporterSecret: options.health?.reporterSecret,
        requireReporterSecret: options.health?.requireReporterSecret,
      }),
      projectExists,
    }),
  );
  // Supply chain and test effectiveness, and the heatmap of every project. Read-only.
  app.route(
    '/',
    createScorecardRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      access,
      history,
    }),
  );
  // Delivery performance: the push door takes the health upload's own guard.
  app.route(
    '/',
    createDeliveryRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      access,
      uploader: uploaderGuard({
        access,
        reporterSecret: options.health?.reporterSecret,
        requireReporterSecret: options.health?.requireReporterSecret,
      }),
      ...(options.delivery?.syncNow === undefined ? {} : { syncNow: options.delivery.syncNow }),
    }),
  );
  // The GitHub webhook: off unless LAN mode and a webhook secret are both configured.
  app.route(
    '/',
    createGitHubWebhookRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      lanMode: options.delivery?.lanMode,
      secret: options.delivery?.webhookSecret,
      clientKey: (context) => defaultClientKey(context, options.trustProxy ?? false),
      ...(options.delivery?.syncNow === undefined ? {} : { syncNow: options.delivery.syncNow }),
    }),
  );
  // Issues from findings and failure clusters: the tracker's token is a vault entry.
  app.route(
    '/',
    createIssueTrackingRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      vaultSecret: options.vaultSecret,
      access,
      adapters: options.issues ?? {},
    }),
  );
  // AI test proposals: stored, listed, never applied.
  app.route(
    '/',
    createTestProposalRoutes({
      db: options.db,
      workspaceId: options.workspaceId,
      access,
      gateway: options.testProposals?.gateway ?? null,
      provider: options.testProposals?.provider ?? null,
    }),
  );

  app.post('/api/v1/projects', operator, async (context) => {
    const parsed = RegisterProjectBodySchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'Invalid project',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    await ensureWorkspace(options);
    const { gitUrl, repoPath, token, defaultBranch, name, slug } = parsed.data;
    if (token !== undefined && options.vaultSecret === undefined) {
      throw new DomainError(
        ErrorCode.NOT_CONFIGURED,
        'A git token can only be stored once VAULT_SECRET is configured.',
      );
    }
    const project =
      gitUrl === undefined
        ? await registerProject(options, { name, slug, repoPath: repoPath as string })
        : await registerGitProject(options, { name, slug, gitUrl, defaultBranch });
    if (token !== undefined) await storeGitToken(options, project.id, token);
    await audit(options, {
      actor: (await callerOf(context, access)).actor,
      action: 'project.register',
      resourceType: 'project',
      resourceId: project.id,
      details: { slug, source: gitUrl === undefined ? 'local' : 'git', token: token !== undefined },
    });
    // `201` with a `Location`: the runnable commands come from the same response so
    // a client does not need a second round trip to learn what it just registered.
    return context.json({ project, commands: project.profile.commands }, 201);
  });

  app.get('/api/v1/projects', viewer, async (context) => {
    return context.json({ projects: await listProjects(options) });
  });

  app.get('/api/v1/projects/:id', viewer, async (context) => {
    const project = await getProject(options, context.req.param('id'));
    return context.json({ project, commands: await listCommands(options, project.id) });
  });

  /**
   * Re-runs detection against the repository on disk.
   *
   * A stored profile is a **proposal from whenever the detector last ran**, and a
   * profile written by an older detector must never be read under newer rules. So
   * this re-reads the manifests and rewrites the proposal rather than echoing the
   * stored one back — which is also what makes a changed `package.json` show up
   * without anyone re-registering the project.
   */
  app.post('/api/v1/projects/:id/detect', operator, async (context) => {
    // `refreshProject`, not `registerProject`: re-registering with the project's own
    // slug collides with the row it is meant to update, so the endpoint answered 422
    // for every project, always — and this is the button a reader presses after
    // changing their `package.json`.
    const refreshed = await refreshProject(options, context.req.param('id'));
    return context.json(refreshed);
  });

  app.get('/api/v1/projects/:id/commands', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    return context.json({ commands: await listCommands(options, projectId) });
  });

  app.post('/api/v1/projects/:id/run.start', operator, async (context) => {
    const projectId = context.req.param('id');
    const project = await getProject(options, projectId);
    const parsed = RunStartBodySchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'Invalid run request',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    // Resolved server-side, and a refusal is a 404 rather than a fallback: an
    // unknown command id means the client is out of date with the profile, and
    // guessing at a nearby command would run a suite the operator did not ask for.
    // The repository is only walked when the id is not a profile command, so the
    // common case — a detected test suite — costs no scan.
    const commands = await listCommands(options, projectId);
    const inProfile = commands.some((candidate) => candidate.id === parsed.data.commandId);
    const command = resolveCommand(
      parsed.data.commandId,
      commands,
      inProfile ? null : await scanner.scan(projectId, project.repoPath),
    );
    if (project.repoPath !== null) command.repository = project.repoPath;
    const started = await options.startRun({
      projectId,
      commandId: command.id,
      command,
      idempotencyKey: parsed.data.idempotencyKey,
      timeoutMs: parsed.data.timeoutMs ?? command.timeoutMs,
    });
    await audit(options, {
      actor: (await callerOf(context, access)).actor,
      action: 'project.run.start',
      resourceType: 'project',
      resourceId: projectId,
      details: { commandId: command.id, runId: started.runId },
    });
    return context.json(started, 202);
  });

  /**
   * Everything the repository says about its own QA: every tool, every report on disk,
   * which capabilities it covers, and what the toolbox recommends.
   *
   * `?fresh=1` skips the short cache, which is what the "rescan" button sends after an
   * operator has changed a manifest.
   */
  app.get('/api/v1/projects/:id/scan', viewer, async (context) => {
    const project = await getProject(options, context.req.param('id'));
    const fresh = context.req.query('fresh') === '1';
    const scan = await scanner.scan(project.id, project.repoPath, { fresh });
    // One reading an hour for the history lines. Checked first, because the health score
    // is a derivation over the run history and the scan is the dashboard's first request.
    const now = options.reliability?.now?.() ?? new Date();
    if (!(await hasSnapshotFor(options, project.id, now))) {
      const score_ = await qaScore(options, project.id, now.toISOString());
      await recordSnapshot(
        options,
        project.id,
        {
          coverage: meanCoverage(scan),
          healthScore: Math.round(score_.total * 10) / 10,
          maturity: scan.maturity,
          flakyTests: new Set(score_.cells.flatMap((cell) => cell.inputs.flakyFingerprints)).size,
        },
        now,
      );
    }
    return context.json(scan);
  });

  /**
   * Coverage, health score, maturity and flaky tests over time, one point per recorded hour.
   *
   * `collectingSince` is the first reading ever taken, so a two-day-old install can say
   * "collecting since Tuesday" instead of drawing a line from one point.
   */
  app.get('/api/v1/projects/:id/history', viewer, async (context) => {
    const project = await getProject(options, context.req.param('id'));
    const days = windowDays(context.req.query('days'), 30);
    const now = options.reliability?.now?.() ?? new Date();
    const since = new Date(startOfDay(now).getTime() - (days - 1) * DAY_MS);
    const history = await readHistory(options, project.id, since);
    const body: ProjectHistory = { projectId: project.id, days, ...history };
    return context.json(body);
  });

  if (options.reliability !== undefined) {
    const reliability = options.reliability;
    /**
     * Release readiness: go, caution or no-go, with every reason and its evidence.
     *
     * The route gathers; `evaluateReadiness` in `@automate/reporting` decides. The flaky
     * allowance is the gate policy's own `maxFlakyRate` and the pass-rate threshold is the
     * project's gate row, so the card can never disagree with the gate about a number.
     */
    app.get('/api/v1/projects/:id/readiness', viewer, async (context) => {
      const project = await getProject(options, context.req.param('id'));
      const days = windowDays(context.req.query('days'), 7);
      const now = reliability.now?.() ?? new Date();
      const since = startOfDay(now).getTime() - (days - 1) * DAY_MS;
      const { runs } = await readSince(reliability.store, options.workspaceId, since);
      const mine = runs.filter((run) => belongsTo(run, project.id));
      const gated = mine.find((run) => run.policyEvaluation !== null);
      const tests = mine.reduce((sum, run) => sum + run.summary.total, 0);
      const flaky = mine.reduce((sum, run) => sum + run.summary.flaky, 0);
      const history = await readHistory(options, project.id, new Date(since));
      const readings = history.points
        .map((point) => point.coverage)
        .filter((value): value is number => value !== null);
      const latest = readings.at(-1) ?? null;
      const first = readings[0];
      return context.json(
        evaluateReadiness({
          projectId: project.id,
          evaluatedAt: now.toISOString(),
          runs: mine.length,
          gate:
            gated?.policyEvaluation === null || gated === undefined
              ? null
              : { status: gated.policyEvaluation.status, runId: gated.id },
          passRate: verdictRate(mine),
          passRateThreshold: await passRateThreshold(options, project.id),
          flakyRate: tests === 0 ? null : Math.round((flaky / tests) * 1000) / 10,
          maxFlakyRate: DEFAULT_QUALITY_POLICY.maxFlakyRate,
          coverage: {
            current: latest,
            delta:
              latest === null || first === undefined || readings.length < 2
                ? null
                : Math.round((latest - first) * 10) / 10,
          },
          openQuarantine: await reliability.openQuarantine(),
        }),
      );
    });
  }

  app.post('/api/v1/runs/:runId/stop', operator, async (context) => {
    const parsed = RunStopBodySchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'A stop needs a reason',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    return context.json(
      await stopRun(
        options.db,
        options.workspaceId,
        context.req.param('runId'),
        parsed.data.reason,
      ),
    );
  });

  app.get('/api/v1/projects/:id/qa/score', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const at = context.req.query('at') ?? new Date().toISOString();
    return context.json(await qaScore(options, projectId, at));
  });

  /**
   * The gap queue, ranked.
   *
   * A separate endpoint rather than a query on the score because the two are read
   * for different decisions: the score answers "how are we", the queue answers "what
   * do I do next", and a client that has to fetch the whole matrix to render a list
   * will eventually cache the matrix and serve a stale queue.
   */
  app.get('/api/v1/projects/:id/qa/gaps', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({ gaps: score_.gaps, cappedBy: score_.cappedBy });
  });

  /** Hollow tests: green, and contributing nothing. */
  app.get('/api/v1/projects/:id/qa/hollow', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({
      cells: score_.cells
        .filter((cell) => cell.inputs.hollowFingerprints.length > 0)
        .map((cell) => ({
          cell: cell.key,
          hollowFingerprints: cell.inputs.hollowFingerprints,
          signal: cell.signal,
        })),
    });
  });

  /**
   * Flaky tests, split into the two kinds the score distinguishes.
   *
   * **Strong** is the same fingerprint on the same commit with a different outcome —
   * unambiguous. **Weak** is three or more flips across the last ten runs regardless
   * of commit — weaker evidence, and never enough to quarantine a test on its own,
   * because "this test flips" and "this test is wrong" are different claims.
   */
  app.get('/api/v1/projects/:id/qa/flaky', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({
      cells: score_.cells
        .filter((cell) => cell.inputs.flakyFingerprints.length > 0)
        .map((cell) => ({
          cell: cell.key,
          flakyFingerprints: cell.inputs.flakyFingerprints,
          flakeRate: cell.inputs.flakeRate,
          stability: cell.stability,
        })),
    });
  });

  /** The structural findings, which are reported and never scored. */
  app.get('/api/v1/projects/:id/qa/structure', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({ findings: score_.findings });
  });

  /**
   * The provenance diff, between two readings of the same project.
   *
   * ## `since` is an **instant**, and it is a real filter
   *
   * There is no stored score to diff against, and that is deliberate — `score()` is a
   * pure derivation and a `health_scores` table would be a fourth blocking number
   * that has to agree with the coverage floor, the performance threshold and the gate
   * tier. So the caller passes the instant to recompute the earlier reading from, and
   * the **current** reading is always recomputed.
   *
   * `readScoreInputs` cuts both reads at that instant (`startedAt <= at`), so the two
   * ends are two windows rather than one window counted twice. It used to do not: the
   * read had no time parameter at all, `at` was a label, and this endpoint subtracted
   * a number from itself on every request. The comment that made that survive review
   * — "two readings of the same instant would produce an empty diff, which is a true
   * answer rather than an error" — was **the claim, and it was wrong twice**: the two
   * readings were never of the same instant, and an empty diff over a row set compared
   * with itself is not an answer about the code.
   *
   * `diffScores` now refuses that case, and the refusal is surfaced as a 400 rather
   * than swallowed. A client that asks for a window the repository has no rows in gets
   * told to pick a different `since`; it does not get a well-formed `ScoreDelta` whose
   * every contribution cites evidence for a change that never happened.
   */
  app.get('/api/v1/projects/:id/qa/score/diff', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const since = context.req.query('since');
    if (since === undefined || Number.isNaN(new Date(since).getTime())) {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        'since must be an ISO instant, e.g. ?since=2026-10-01T00:00:00.000Z',
      );
    }
    const now = new Date().toISOString();
    const before = await qaScore(options, projectId, since);
    const after = await qaScore(options, projectId, now);
    try {
      return context.json(diffScores(before, after));
    } catch (failure) {
      // **A schema failure is not a refusal.** `diffScores` parses its own output
      // through `ScoreDeltaSchema`, so a `ZodError` here means the product computed
      // something the contract does not allow — a server fault, and reporting it as
      // `400 INVALID_REQUEST` would tell the caller their request was wrong when the
      // server is. It goes to the boundary untouched.
      if (failure instanceof ZodError) throw failure;
      // Everything else `diffScores` throws is one of its three refusals: a
      // cross-project diff, a backwards one, or a `since` that selects the same rows.
      // All three are the caller's mistake, so all three are 4xx carrying the
      // function's own sentence rather than a paraphrase of it.
      throw new DomainError(
        ErrorCode.INVALID_REQUEST,
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  });

  /**
   * The copilot.
   *
   * **A derivation over the score, not a model.** Every suggestion is arithmetic on a
   * cell — `presence === 0`, `depth === 0`, a hollow fingerprint, a strong flake — so
   * the same question has the same answer every time and each one cites the row it came
   * from. `CopilotAnswerSchema` refuses a suggestion with no evidence at the boundary,
   * which is the plan's hard rule enforced where it cannot be forgotten.
   */
  app.post('/api/v1/projects/:id/copilot/answer', viewer, async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const parsed = CopilotQuestionSchema.safeParse({
      projectId,
      ...asRecord(await readJson(context)),
    });
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid copilot question', {
        details: { issues: parsed.error.issues },
      });
    }
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json(answer(parsed.data, score_));
  });

  return app;
}
