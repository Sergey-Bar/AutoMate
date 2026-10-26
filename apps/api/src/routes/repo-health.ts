import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import {
  FINDING_SEVERITIES,
  FINDING_STATES,
  HEALTH_DIMENSIONS,
  HealthReportFormatSchema,
  isUploadReportFormat,
  SupplyChainPolicySchema,
  TriageFindingBodySchema,
} from '@automate/shared-contracts';
import { MAX_HEALTH_REPORT_BYTES } from '@automate/reporter';
import type { ConnectorAdapter } from '@automate/connectors-sdk';
import {
  AlertSettingsSchema,
  githubRepository,
  isAllowedWebhook,
  reportToGitHub,
} from '../services/health-integrations.js';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { invalidRequest } from '../http/invalid-request.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { uploaderActor, uploaderGuard } from '../http/uploader.js';
import { audit, authenticateToken } from '../services/access-service.js';
import {
  healthHistory,
  ingestHealthReport,
  listFindings,
  portfolio,
  getHealthSettings,
  healthGate,
  projectHealth,
  projectSource,
  setAlertSettings,
  setCodeowners,
  setHealthSchedule,
  startHealthScan,
  setSupplyChainPolicy,
  triageFinding,
  type HealthScanOptions,
} from '../services/repo-health-service.js';
import {
  listComponents,
  searchPortfolioComponents,
  supplyChainPolicyRecord,
} from '../services/supply-chain-service.js';
import { diffCoverageStatus } from '../services/diff-coverage-service.js';
import type { CommitTests } from '../services/commit-tests.js';

/**
 * The repository health API.
 *
 * Reads are what the dashboard renders; `POST …/health/reports` is the door every scanner
 * report comes through — a CI job's upload and a scan this install ran alike — so there is
 * one ingestion path, not one per source.
 */
export interface RepoHealthRouteOptions extends HealthScanOptions {
  /** Who is calling. Absent: access is open and tokens are read from this database. */
  access?: CallerResolver;
  /** The credential an uploader presents. Unset outside production: uploads are open. */
  reporterSecret?: string | undefined;
  /** Refuse uploads when no secret is configured, rather than accepting them openly. */
  requireReporterSecret?: boolean;
  /** Posts the gate to GitHub. Absent, or no token for the project: the gate is only returned. */
  github?: { adapter: ConnectorAdapter; tokenFor: (projectId: string) => Promise<string | null> };
  /** The dashboard URL for a project, linked from a status, a comment and an alert. */
  detailsUrl?: (projectId: string) => string;
  /**
   * The commit's test run and the quarantine verdict on it, for the comment's "Tests"
   * section. Absent, or no run for the commit: the section is left out.
   */
  commitTests?: (projectId: string, commit: string) => Promise<CommitTests | null>;
}

const UploadQuerySchema = z.object({
  // Every format but the built-in scanners' own, which only this product writes.
  format: HealthReportFormatSchema.refine(isUploadReportFormat, {
    message: 'This format is written by a built-in scanner and is not accepted as an upload',
  }),
  branch: z.string().trim().min(1).max(255).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/iu)
    .optional(),
  sourceRoot: z.string().min(1).max(1000).optional(),
  /** The artifact a slsa-provenance upload must describe. */
  digest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/iu)
    .optional(),
});

const Commit = z.string().regex(/^[0-9a-f]{7,64}$/iu);

const GateQuerySchema = z.object({
  branch: z.string().trim().min(1).max(255),
  commit: Commit.optional(),
  /** Names the pull request, so the AI-governance rules are read here as on the gate report. */
  pullRequest: z.coerce.number().int().min(1).optional(),
});

const ComponentsQuerySchema = z.object({
  branch: z.string().trim().min(1).max(255).optional(),
  type: z.string().trim().min(1).max(100).optional(),
  licence: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const PortfolioComponentsQuerySchema = z.object({
  // pkg: and at least a type: a shorter prefix is every component in the workspace.
  purl: z.string().trim().min(5).max(500).startsWith('pkg:'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const DiffCoverageQuerySchema = z.object({ commit: Commit });

const GateReportBodySchema = z.object({
  branch: z.string().trim().min(1).max(255),
  commit: z.string().regex(/^[0-9a-f]{7,64}$/iu),
  pullRequest: z.number().int().min(1).optional(),
});

const ScheduleBodySchema = z.object({ cadence: z.enum(['daily', 'weekly']).nullable() });

const FindingsQuerySchema = z.object({
  branch: z.string().trim().min(1).max(255).optional(),
  dimension: z.enum(HEALTH_DIMENSIONS).optional(),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  state: z.enum(FINDING_STATES).optional(),
  tool: z.string().min(1).max(100).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const HistoryQuerySchema = z.object({
  branch: z.string().trim().min(1).max(255).optional(),
  days: z.coerce.number().int().min(1).max(365).default(90),
});

export function createRepoHealthRoutes(options: RepoHealthRouteOptions): Hono {
  const app = new Hono();

  const access: CallerResolver = options.access ?? {
    mode: 'open',
    authenticateToken: (token) => authenticateToken(options, token),
    hasSession: async () => false,
  };
  const viewer = requireRole('viewer', access);
  const operator = requireRole('operator', access);
  const admin = requireRole('admin', access);

  /**
   * An upload is accepted with the reporter secret, or with an access token: an uploader
   * token pinned to this project, or an operator's. The guard is shared with the delivery
   * push door (`http/uploader.ts`).
   */
  const uploader: MiddlewareHandler = uploaderGuard({
    access,
    reporterSecret: options.reporterSecret,
    requireReporterSecret: options.requireReporterSecret,
  });

  app.get('/api/v1/portfolio', viewer, async (context) => context.json(await portfolio(options)));

  app.get('/api/v1/projects/:id/health', viewer, async (context) =>
    context.json(
      await projectHealth(options, context.req.param('id'), context.req.query('branch')),
    ),
  );

  app.get('/api/v1/projects/:id/health/findings', viewer, async (context) => {
    const parsed = FindingsQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid findings query', parsed.error.issues);
    return context.json(await listFindings(options, context.req.param('id'), parsed.data));
  });

  app.get('/api/v1/projects/:id/health/history', viewer, async (context) => {
    const parsed = HistoryQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid history query', parsed.error.issues);
    return context.json(
      await healthHistory(options, context.req.param('id'), parsed.data.branch, parsed.data.days),
    );
  });

  app.post(
    '/api/v1/projects/:id/health/reports',
    uploader,
    bodyLimit({
      maxSize: MAX_HEALTH_REPORT_BYTES,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError(ErrorCode.PAYLOAD_TOO_LARGE, 'Report larger than the upload limit'),
        ),
    }),
    async (context) => {
      const parsed = UploadQuerySchema.safeParse(context.req.query());
      if (!parsed.success)
        return invalidRequest(context, 'Invalid upload query', parsed.error.issues);
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'The report body is empty');
      }
      const result = await ingestHealthReport(options, {
        projectId: context.req.param('id'),
        format: parsed.data.format,
        bytes,
        branch: parsed.data.branch,
        commitSha: parsed.data.commit,
        sourceRoot: parsed.data.sourceRoot,
        digest: parsed.data.digest,
        source: 'ci',
      });
      await audit(options, {
        actor: await uploaderActor(context, access),
        action: 'health.report.upload',
        resourceType: 'health_report',
        resourceId: result.reportId,
        details: { format: parsed.data.format, branch: result.branch, findings: result.findings },
      });
      return context.json(result, 201);
    },
  );

  app.get('/api/v1/projects/:id/health/gate', viewer, async (context) => {
    const parsed = GateQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return invalidRequest(context, 'Name the branch to gate', parsed.error.issues);
    }
    const result = await healthGate(
      options,
      context.req.param('id'),
      parsed.data.branch,
      parsed.data.commit,
      parsed.data.pullRequest,
    );
    return context.json({
      branch: result.branch,
      ...result.verdict,
      grade: result.grade,
      added: result.added,
      diffCoverage: result.diffCoverage,
      aiGovernance: result.aiGovernance,
    });
  });

  /**
   * The CI job's last call: evaluate the gate for its branch, post it to GitHub when the
   * project is a github.com repository with a token, and return the verdict so the job can
   * fail on it. Accepts the same credentials as an upload.
   */
  app.post('/api/v1/projects/:id/health/gate/report', uploader, async (context) => {
    const parsed = GateReportBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalidRequest(context, 'Invalid gate report', parsed.error.issues);
    const projectId = context.req.param('id');
    const { branch, commit, pullRequest } = parsed.data;
    const result = await healthGate(options, projectId, branch, commit, pullRequest);
    const tests = (await options.commitTests?.(projectId, commit)) ?? null;
    if (pullRequest !== undefined) {
      await options.onGateReport?.(projectId, {
        pullRequest,
        commit,
        newHigh: result.verdict.newFindings.high,
        newCritical: result.verdict.newFindings.critical,
      });
    }
    const detailsUrl = options.detailsUrl?.(projectId) ?? null;
    const source = await projectSource(options, projectId);
    const repository = githubRepository(source.repositoryUrl);
    const token =
      repository === null ? null : ((await options.github?.tokenFor(projectId)) ?? null);
    const github =
      repository === null || token === null || options.github === undefined
        ? null
        : await reportToGitHub(
            options.github.adapter,
            token,
            { ...repository, sha: commit, pullRequest },
            {
              verdict: result.verdict,
              grade: result.grade,
              added: result.added,
              branch: result.branch,
              detailsUrl,
              diffCoverage: result.diffCoverage,
              delivery: result.delivery,
              aiGovernance: result.aiGovernance,
              evals: result.evals,
              tests,
            },
          );
    await audit(options, {
      actor: await uploaderActor(context, access),
      action: 'health.gate.report',
      resourceType: 'project',
      resourceId: projectId,
      details: {
        branch: result.branch,
        commit,
        pullRequest: pullRequest ?? null,
        verdict: result.verdict.verdict,
        aiGovernance: result.aiGovernance?.verdict.verdict ?? null,
        evals: result.evals?.suites.length ?? 0,
        github,
      },
    });
    return context.json({
      branch: result.branch,
      ...result.verdict,
      grade: result.grade,
      diffCoverage: result.diffCoverage,
      aiGovernance: result.aiGovernance,
      evals: result.evals,
      agentRuntime: result.agentRuntime,
      tests,
      github,
    });
  });

  // ─── Supply chain and diff coverage ────────────────────────────────────────

  app.get('/api/v1/projects/:id/health/supply-chain-policy', viewer, async (context) =>
    context.json(await supplyChainPolicyRecord(options, context.req.param('id'))),
  );

  /** Changing what the licence gate allows and which signatures are trusted is configuration. */
  app.put('/api/v1/projects/:id/health/supply-chain-policy', admin, async (context) => {
    const parsed = SupplyChainPolicySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return invalidRequest(context, 'Invalid supply-chain policy', parsed.error.issues);
    }
    const actor = (await callerOf(context, access)).actor;
    const saved = await setSupplyChainPolicy(options, context.req.param('id'), parsed.data, actor);
    await audit(options, {
      actor,
      action: 'health.supply-chain-policy.set',
      resourceType: 'project',
      resourceId: saved.record.projectId,
      details: {
        allow: parsed.data.licences.allow?.length ?? null,
        deny: parsed.data.licences.deny?.length ?? 0,
        failOnUnknown: parsed.data.licences.failOnUnknown,
        // Counts, never the PEM material itself.
        trustedKeys: parsed.data.provenance.trustedKeysPem.length,
        trustedRoots: parsed.data.provenance.trustedRootsPem.length,
        allowedBuilders: parsed.data.provenance.allowedBuilders?.length ?? null,
        branches: saved.branches,
        findingsChanged: saved.changed,
      },
    });
    return context.json(saved.record);
  });

  app.get('/api/v1/projects/:id/health/components', viewer, async (context) => {
    const parsed = ComponentsQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid components query', parsed.error.issues);
    return context.json(await listComponents(options, context.req.param('id'), parsed.data));
  });

  app.get('/api/v1/portfolio/components', viewer, async (context) => {
    const parsed = PortfolioComponentsQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return invalidRequest(context, 'Name a purl prefix to search for', parsed.error.issues);
    }
    return context.json(
      await searchPortfolioComponents(options, parsed.data.purl, {
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      }),
    );
  });

  app.get('/api/v1/projects/:id/health/diff-coverage', viewer, async (context) => {
    const parsed = DiffCoverageQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalidRequest(context, 'Name the commit', parsed.error.issues);
    return context.json(
      await diffCoverageStatus(options, context.req.param('id'), parsed.data.commit.toLowerCase()),
    );
  });

  /** CODEOWNERS for a project with no checkout here, sent by its CI as plain text. */
  app.put(
    '/api/v1/projects/:id/health/codeowners',
    uploader,
    bodyLimit({
      maxSize: 200_000,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError(ErrorCode.PAYLOAD_TOO_LARGE, 'CODEOWNERS larger than 200 kB'),
        ),
    }),
    async (context) => {
      const text = await context.req.text();
      return context.json(await setCodeowners(options, context.req.param('id'), text));
    },
  );

  app.get('/api/v1/projects/:id/health/settings', viewer, async (context) =>
    context.json(await getHealthSettings(options, context.req.param('id'))),
  );

  app.put('/api/v1/projects/:id/health/alerts', operator, async (context) => {
    const parsed = AlertSettingsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return invalidRequest(context, 'Invalid alert settings', parsed.error.issues);
    if (parsed.data.webhookUrl != null && !isAllowedWebhook(parsed.data.webhookUrl)) {
      return invalidRequest(
        context,
        'A webhook must be an https URL that is not a loopback or private address',
        [{ path: ['webhookUrl'], message: 'not allowed' }],
      );
    }
    const alerts = await setAlertSettings(options, context.req.param('id'), parsed.data);
    await audit(options, {
      actor: (await callerOf(context, access)).actor,
      action: 'health.alerts.set',
      resourceType: 'project',
      resourceId: context.req.param('id'),
      details: {
        webhook: parsed.data.webhookUrl != null,
        slackChannel: parsed.data.slackChannel ?? null,
      },
    });
    return context.json({ alerts });
  });

  app.put('/api/v1/projects/:id/health/schedule', operator, async (context) => {
    const parsed = ScheduleBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalidRequest(context, 'Invalid schedule', parsed.error.issues);
    const result = await setHealthSchedule(options, context.req.param('id'), parsed.data.cadence);
    await audit(options, {
      actor: (await callerOf(context, access)).actor,
      action: 'health.schedule.set',
      resourceType: 'project',
      resourceId: context.req.param('id'),
      details: result,
    });
    return context.json(result);
  });

  /** Runs the repository's scanners. The body carries nothing: which scanners run is the server's call. */
  app.post('/api/v1/projects/:id/health/scan', operator, async (context) => {
    const started = await startHealthScan(options, context.req.param('id'));
    await audit(options, {
      actor: (await callerOf(context, access)).actor,
      action: 'health.scan.start',
      resourceType: 'project',
      resourceId: context.req.param('id'),
      details: { scanners: started.scanners, notConfigured: started.notConfigured },
    });
    return context.json(started, 202);
  });

  app.post('/api/v1/projects/:id/health/findings/:findingId/triage', operator, async (context) => {
    const parsed = TriageFindingBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return invalidRequest(context, 'Invalid triage decision', parsed.error.issues);
    const actor = (await callerOf(context, access)).actor;
    const finding = await triageFinding(
      options,
      context.req.param('id'),
      context.req.param('findingId'),
      parsed.data,
      actor,
    );
    await audit(options, {
      actor,
      action: 'health.finding.triage',
      resourceType: 'health_finding',
      resourceId: finding.id,
      details: {
        state: parsed.data.state,
        reason: parsed.data.reason ?? null,
        expiresAt: parsed.data.expiresAt ?? null,
      },
    });
    return context.json(finding);
  });

  return app;
}
