import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import {
  DeliverySourceBodySchema,
  PushDeploymentBodySchema,
  PushIncidentBodySchema,
} from '@automate/shared-contracts';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { invalidRequest } from '../http/invalid-request.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { uploaderActor } from '../http/uploader.js';
import { audit } from '../services/access-service.js';
import {
  deliveryReport,
  getDeliverySource,
  portfolioDelivery,
  pushDeployment,
  pushIncident,
  requestDeliverySync,
  setDeliverySource,
  type DeliveryOptions,
} from '../services/delivery-service.js';

/**
 * Delivery performance: the source a project syncs from, the push door CI reports
 * deployments and incidents through, and the DORA and flow scorecards.
 *
 * The push door takes **the** uploader guard — the one the health upload takes, passed in —
 * so a CI job that can upload a SARIF can report a deployment, and no other credential can.
 */
export interface DeliveryRouteOptions extends DeliveryOptions {
  access: CallerResolver;
  /** The health upload's guard (`http/uploader.ts`), shared rather than rebuilt. */
  uploader: MiddlewareHandler;
  /** Runs queued syncs now, after `POST …/sync`, rather than at the next interval. */
  syncNow?: () => Promise<unknown>;
}

/** One deployment or incident is a few hundred bytes; 64 kB leaves room for a long `shas`. */
export const DELIVERY_PUSH_MAX_BYTES = 64 * 1024;

const DaysSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

const pushLimit = bodyLimit({
  maxSize: DELIVERY_PUSH_MAX_BYTES,
  onError: (context) =>
    domainErrorResponse(
      context,
      new DomainError(ErrorCode.PAYLOAD_TOO_LARGE, 'Body larger than the 64 kB push limit'),
    ),
});

export function createDeliveryRoutes(options: DeliveryRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const operator = requireRole('operator', options.access);

  app.get('/api/v1/projects/:id/delivery/source', viewer, async (context) =>
    context.json(await getDeliverySource(options, context.req.param('id'))),
  );

  app.put('/api/v1/projects/:id/delivery/source', operator, async (context) => {
    const parsed = DeliverySourceBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return invalidRequest(context, 'Invalid delivery source', parsed.error.issues);
    const saved = await setDeliverySource(options, context.req.param('id'), parsed.data);
    await audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action: 'delivery.source.set',
      resourceType: 'project',
      resourceId: saved.projectId,
      details: {
        enabled: saved.enabled,
        cadence: saved.cadence,
        productionEnvironments: saved.productionEnvironments,
        deployWorkflows: saved.deployWorkflows.length,
      },
    });
    return context.json(saved);
  });

  app.post('/api/v1/projects/:id/delivery/sync', operator, async (context) => {
    const queued = await requestDeliverySync(options, context.req.param('id'));
    await audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action: 'delivery.sync.request',
      resourceType: 'delivery_sync',
      resourceId: queued.syncId,
      details: { projectId: context.req.param('id'), duplicate: queued.duplicate },
    });
    // Not awaited: the answer is "queued", and the sync reports through the source.
    void options.syncNow?.().catch(() => undefined);
    return context.json(queued, 202);
  });

  app.post(
    '/api/v1/projects/:id/delivery/deployments',
    options.uploader,
    pushLimit,
    async (context) => {
      const parsed = PushDeploymentBodySchema.safeParse(await context.req.json().catch(() => null));
      if (!parsed.success)
        return invalidRequest(context, 'Invalid deployment', parsed.error.issues);
      const result = await pushDeployment(options, context.req.param('id'), parsed.data);
      await audit(options, {
        actor: await uploaderActor(context, options.access),
        action: 'delivery.deployment.push',
        resourceType: 'deployment',
        resourceId: result.id,
        details: {
          externalId: parsed.data.externalId,
          environment: parsed.data.environment,
          status: parsed.data.status,
          created: result.created,
        },
      });
      return context.json(result, result.created ? 201 : 200);
    },
  );

  app.post(
    '/api/v1/projects/:id/delivery/incidents',
    options.uploader,
    pushLimit,
    async (context) => {
      const parsed = PushIncidentBodySchema.safeParse(await context.req.json().catch(() => null));
      if (!parsed.success) return invalidRequest(context, 'Invalid incident', parsed.error.issues);
      const result = await pushIncident(options, context.req.param('id'), parsed.data);
      await audit(options, {
        actor: await uploaderActor(context, options.access),
        action: 'delivery.incident.push',
        resourceType: 'incident',
        resourceId: result.id,
        details: {
          externalId: parsed.data.externalId,
          source: parsed.data.source,
          resolved: parsed.data.resolvedAt !== undefined && parsed.data.resolvedAt !== null,
          created: result.created,
        },
      });
      return context.json(result, result.created ? 201 : 200);
    },
  );

  app.get('/api/v1/projects/:id/delivery', viewer, async (context) => {
    const parsed = DaysSchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid delivery window', parsed.error.issues);
    return context.json(await deliveryReport(options, context.req.param('id'), parsed.data.days));
  });

  app.get('/api/v1/portfolio/delivery', viewer, async (context) => {
    const parsed = DaysSchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid delivery window', parsed.error.issues);
    return context.json(await portfolioDelivery(options, parsed.data.days));
  });

  return app;
}
