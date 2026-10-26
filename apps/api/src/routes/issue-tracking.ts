import { Hono, type Context } from 'hono';
import {
  ClusterIssueBodySchema,
  FindingIssueBodySchema,
  IssueTrackerBodySchema,
  type IssueLink,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import {
  createClusterIssue,
  createFindingIssue,
  deleteIssueTracker,
  getIssueTracker,
  setIssueTracker,
  type IssueAdapters,
  type IssueTrackerOptions,
} from '../services/issue-tracker-service.js';

/**
 * Issue trackers, and issues from findings and failure clusters. Who may do what:
 *
 *  - viewer: see whether a project has a tracker (never its token);
 *  - operator: create an issue from a finding or a cluster — a side effect in another
 *    system, made by a person who is on the hook for it, and audited;
 *  - admin: configure and remove a tracker — it holds a credential.
 */
export interface IssueTrackingRouteOptions extends IssueTrackerOptions {
  access: CallerResolver;
  adapters: IssueAdapters;
}

function invalid(issues: unknown): DomainError {
  return new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid request', {
    details: { issues },
  });
}

async function body(context: Context): Promise<unknown> {
  return context.req.json().catch(() => null);
}

export function createIssueTrackingRoutes(options: IssueTrackingRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const operator = requireRole('operator', options.access);
  const admin = requireRole('admin', options.access);
  const actor = async (context: Context) => (await callerOf(context, options.access)).actor;

  const recordIssue = async (context: Context, link: IssueLink) => {
    await audit(options, {
      actor: await actor(context),
      action: link.created ? 'issue.create' : 'issue.create.existing',
      resourceType: link.sourceKind === 'finding' ? 'health_finding' : 'failure_cluster',
      resourceId: link.sourceKey,
      details: { projectId: link.projectId, target: link.target, key: link.key, url: link.url },
    });
    return context.json(link, link.created ? 201 : 200);
  };

  app.get('/api/v1/projects/:id/issue-tracker', viewer, async (context) =>
    context.json({ tracker: await getIssueTracker(options, context.req.param('id')) }),
  );

  app.put('/api/v1/projects/:id/issue-tracker', admin, async (context) => {
    const parsed = IssueTrackerBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues);
    const who = await actor(context);
    const saved = await setIssueTracker(options, context.req.param('id'), parsed.data, who);
    await audit(options, {
      actor: who,
      action: saved.created ? 'issue-tracker.create' : 'issue-tracker.update',
      resourceType: 'project',
      resourceId: saved.tracker.projectId,
      // The host and key, never the token.
      details: {
        kind: saved.tracker.kind,
        host: new URL(saved.tracker.baseUrl).host,
        projectKey: saved.tracker.projectKey,
        issueType: saved.tracker.issueType,
        tokenChanged: saved.tokenChanged,
      },
    });
    return context.json({ tracker: saved.tracker }, saved.created ? 201 : 200);
  });

  app.delete('/api/v1/projects/:id/issue-tracker', admin, async (context) => {
    const projectId = context.req.param('id');
    const removed = await deleteIssueTracker(options, projectId, await actor(context));
    if (removed) {
      await audit(options, {
        actor: await actor(context),
        action: 'issue-tracker.delete',
        resourceType: 'project',
        resourceId: projectId,
      });
    }
    return context.json({ ok: true, removed });
  });

  app.post('/api/v1/projects/:id/health/findings/:findingId/issue', operator, async (context) => {
    const parsed = FindingIssueBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues);
    const link = await createFindingIssue(
      options,
      options.adapters,
      {
        projectId: context.req.param('id'),
        findingId: context.req.param('findingId'),
        target: parsed.data.target,
      },
      await actor(context),
    );
    return recordIssue(context, link);
  });

  app.post('/api/v1/dashboard/failure-clusters/issue', operator, async (context) => {
    const parsed = ClusterIssueBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues);
    const link = await createClusterIssue(
      options,
      options.adapters,
      parsed.data,
      await actor(context),
    );
    return recordIssue(context, link);
  });

  return app;
}
