/**
 * Triage labels on failure causes.
 *
 * - `GET /api/v1/triage-labels` — viewer.
 * - `PUT /api/v1/triage-labels` — operator, audited: labelling a cause is operating the product.
 * - `DELETE /api/v1/triage-labels?signature=` — operator, audited.
 *
 * The signature travels in the body and the query rather than the path: it is a normalised
 * error message and can hold any character.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import { TriageLabelBodySchema } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import {
  deleteTriageLabel,
  listTriageLabels,
  setTriageLabel,
} from '../services/triage-label-service.js';

export function createTriageLabelRoutes(
  options: Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & {
    viewer: MiddlewareHandler;
    operator: MiddlewareHandler;
    actorOf: (context: Parameters<MiddlewareHandler>[0]) => Promise<string>;
  },
): Hono {
  const app = new Hono();

  app.get('/api/v1/triage-labels', options.viewer, async (context) =>
    context.json({ labels: await listTriageLabels(options) }),
  );

  app.put('/api/v1/triage-labels', options.operator, async (context) => {
    const parsed = TriageLabelBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid triage label', {
        details: { issues: parsed.error.issues },
      });
    }
    const actor = await options.actorOf(context);
    const label = await setTriageLabel(options, parsed.data, actor);
    await audit(options, {
      actor,
      action: 'triage-label.set',
      resourceType: 'failure_signature',
      resourceId: label.signature.slice(0, 200),
      details: { category: label.category, issueUrl: label.issueUrl },
    });
    return context.json(label);
  });

  app.delete('/api/v1/triage-labels', options.operator, async (context) => {
    const signature = context.req.query('signature');
    if (signature === undefined || signature === '') {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'signature is required');
    }
    if (!(await deleteTriageLabel(options, signature))) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'No label for that signature');
    }
    await audit(options, {
      actor: await options.actorOf(context),
      action: 'triage-label.removed',
      resourceType: 'failure_signature',
      resourceId: signature.slice(0, 200),
    });
    return context.json({ removed: true });
  });

  return app;
}
