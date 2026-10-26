/**
 * A project's quarantine: the policy (`off`, `suggest`, `auto`) and the entries, each with an
 * owner, a cost and a release streak.
 *
 * - `GET /api/v1/projects/:id/quarantine` — viewer.
 * - `GET /api/v1/projects/:id/quarantine/policy` — viewer.
 * - `PUT /api/v1/projects/:id/quarantine/policy` — admin, audited: turning `auto` on lets this
 *   install excuse a project's failures on its own, which is configuration, not operation.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import { QuarantinePolicySchema } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ExecutionRun } from '../execution/types.js';
import type { QuarantineStore } from '../modules/dashboard/quarantine.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import {
  projectQuarantine,
  readQuarantinePolicy,
  writeQuarantinePolicy,
} from '../services/quarantine-policy-service.js';

export interface ProjectQuarantineSource {
  store: QuarantineStore;
  /** The workspace's runs since a moment, oldest first. */
  history: (since: Date) => Promise<readonly ExecutionRun[]>;
}

export function createProjectQuarantineRoutes(
  options: Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & {
    viewer: MiddlewareHandler;
    admin: MiddlewareHandler;
    actorOf: (context: Parameters<MiddlewareHandler>[0]) => Promise<string>;
    /** Absent: the entries route answers NOT_CONFIGURED; the policy routes still work. */
    source: ProjectQuarantineSource | undefined;
  },
): Hono {
  const app = new Hono();

  app.get('/api/v1/projects/:id/quarantine', options.viewer, async (context) => {
    if (options.source === undefined) {
      throw new DomainError(ErrorCode.NOT_CONFIGURED, 'The quarantine store is not configured', {
        callerSafe: true,
      });
    }
    return context.json(
      await projectQuarantine(
        { db: options.db, workspaceId: options.workspaceId, ...options.source },
        context.req.param('id'),
      ),
    );
  });

  app.get('/api/v1/projects/:id/quarantine/policy', options.viewer, async (context) =>
    context.json(await readQuarantinePolicy(options, context.req.param('id'))),
  );

  app.put('/api/v1/projects/:id/quarantine/policy', options.admin, async (context) => {
    const parsed = QuarantinePolicySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid quarantine policy', {
        details: { issues: parsed.error.issues },
      });
    }
    const projectId = context.req.param('id');
    const before = await readQuarantinePolicy(options, projectId);
    const saved = await writeQuarantinePolicy(options, projectId, parsed.data);
    await audit(options, {
      actor: await options.actorOf(context),
      action: 'quarantine.policy.set',
      resourceType: 'project',
      resourceId: projectId,
      details: { from: before, to: saved },
    });
    return context.json(saved);
  });

  return app;
}
