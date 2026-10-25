import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import {
  FINDING_SEVERITIES,
  FINDING_STATES,
  HEALTH_DIMENSIONS,
  HealthReportFormatSchema,
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
import { guard } from '../http/access.js';
import { bearerToken } from '../http/bearer-token.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
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
  triageFinding,
  type HealthScanOptions,
} from '../services/repo-health-service.js';

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
}

const UploadQuerySchema = z.object({
  format: HealthReportFormatSchema,
  branch: z.string().trim().min(1).max(255).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/iu)
    .optional(),
  sourceRoot: z.string().min(1).max(1000).optional(),
});

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

function sameSecret(presented: string, expected: string): boolean {
  // Hashed first so the comparison is constant-time over equal-length buffers.
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function invalid(context: Context, message: string, details: unknown) {
  return context.json({ error: { code: ErrorCode.INVALID_REQUEST, message, details } }, 400);
}

export function createRepoHealthRoutes(options: RepoHealthRouteOptions): Hono {
  const app = new Hono();

  const access: CallerResolver = options.access ?? {
    mode: 'open',
    authenticateToken: (token) => authenticateToken(options, token),
    hasSession: async () => false,
  };
  const viewer = requireRole('viewer', access);
  const operator = requireRole('operator', access);

  /**
   * An upload is accepted with the reporter secret, or with an access token: an uploader
   * token pinned to this project, or an operator's. With no reporter secret configured outside
   * production, an upload is admitted openly, as the reporter routes admit one.
   */
  const uploader: MiddlewareHandler = guard('reporter-secret', async (context, next) => {
    const presented = bearerToken(context.req.header('authorization'));
    if (presented !== undefined && presented.startsWith('amt_')) {
      const caller = await callerOf(context, access);
      const project = context.req.param('id');
      if (caller.uploaderFor === project || caller.role === 'operator' || caller.role === 'admin') {
        await next();
        return;
      }
      throw new DomainError(ErrorCode.FORBIDDEN, 'This token cannot upload to this project');
    }
    const secret = options.reporterSecret;
    if (secret === undefined || secret === '') {
      if (options.requireReporterSecret === true) {
        throw new DomainError(
          ErrorCode.NOT_CONFIGURED,
          'Health uploads are unavailable until REPORTER_SECRET is configured',
        );
      }
      await next();
      return;
    }
    const token = bearerToken(context.req.header('authorization'));
    if (token === undefined) {
      throw new DomainError(
        ErrorCode.MISSING_REPORTER_TOKEN,
        'Missing reporter authentication token',
      );
    }
    if (!sameSecret(token, secret)) {
      throw new DomainError(
        ErrorCode.INVALID_REPORTER_TOKEN,
        'Invalid reporter authentication token',
      );
    }
    await next();
  });

  app.get('/api/v1/portfolio', viewer, async (context) => context.json(await portfolio(options)));

  app.get('/api/v1/projects/:id/health', viewer, async (context) =>
    context.json(
      await projectHealth(options, context.req.param('id'), context.req.query('branch')),
    ),
  );

  app.get('/api/v1/projects/:id/health/findings', viewer, async (context) => {
    const parsed = FindingsQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalid(context, 'Invalid findings query', parsed.error.issues);
    return context.json(await listFindings(options, context.req.param('id'), parsed.data));
  });

  app.get('/api/v1/projects/:id/health/history', viewer, async (context) => {
    const parsed = HistoryQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalid(context, 'Invalid history query', parsed.error.issues);
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
      if (!parsed.success) return invalid(context, 'Invalid upload query', parsed.error.issues);
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
        source: 'ci',
      });
      await audit(options, {
        actor:
          bearerToken(context.req.header('authorization'))?.startsWith('amt_') === true
            ? (await callerOf(context, access)).actor
            : 'reporter',
        action: 'health.report.upload',
        resourceType: 'health_report',
        resourceId: result.reportId,
        details: { format: parsed.data.format, branch: result.branch, findings: result.findings },
      });
      return context.json(result, 201);
    },
  );

  app.get('/api/v1/projects/:id/health/gate', viewer, async (context) => {
    const branch = context.req.query('branch');
    if (branch === undefined || branch.trim() === '') {
      return invalid(context, 'Name the branch to gate', [
        { path: ['branch'], message: 'required' },
      ]);
    }
    const result = await healthGate(options, context.req.param('id'), branch);
    return context.json({
      branch: result.branch,
      ...result.verdict,
      grade: result.grade,
      added: result.added,
    });
  });

  /**
   * The CI job's last call: evaluate the gate for its branch, post it to GitHub when the
   * project is a github.com repository with a token, and return the verdict so the job can
   * fail on it. Accepts the same credentials as an upload.
   */
  app.post('/api/v1/projects/:id/health/gate/report', uploader, async (context) => {
    const parsed = GateReportBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Invalid gate report', parsed.error.issues);
    const projectId = context.req.param('id');
    const result = await healthGate(options, projectId, parsed.data.branch);
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
            { ...repository, sha: parsed.data.commit, pullRequest: parsed.data.pullRequest },
            {
              verdict: result.verdict,
              grade: result.grade,
              added: result.added,
              branch: result.branch,
              detailsUrl,
            },
          );
    await audit(options, {
      actor:
        bearerToken(context.req.header('authorization'))?.startsWith('amt_') === true
          ? (await callerOf(context, access)).actor
          : 'reporter',
      action: 'health.gate.report',
      resourceType: 'project',
      resourceId: projectId,
      details: {
        branch: result.branch,
        commit: parsed.data.commit,
        verdict: result.verdict.verdict,
        github,
      },
    });
    return context.json({ branch: result.branch, ...result.verdict, grade: result.grade, github });
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
    if (!parsed.success) return invalid(context, 'Invalid alert settings', parsed.error.issues);
    if (parsed.data.webhookUrl != null && !isAllowedWebhook(parsed.data.webhookUrl)) {
      return invalid(
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
    if (!parsed.success) return invalid(context, 'Invalid schedule', parsed.error.issues);
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
    if (!parsed.success) return invalid(context, 'Invalid triage decision', parsed.error.issues);
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
