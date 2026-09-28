/**
 * policies.routes.ts — quality policies and integration maturity.
 *
 * One of the five route groups, extracted from a single 1139-line module. The
 * handler bodies are moved verbatim; only this wrapper and the imports are new.
 *
 * What that buys is not tidiness. It is that the registration order is now written
 * down once, in `createExecutionRoutes`, instead of being an accident of where a
 * handler sat in a long file — and that the helpers and request bodies those handlers
 * use are decided in one file each, so a response shape cannot drift between two
 * routes that each had their own copy.
 *
 * `route-manifest.test.ts` asserts the resulting route set, that no method+path is
 * registered twice, and that the order matches the mounted app.
 */

import { Hono } from 'hono';
import { DomainError } from '../../errors/domain-error.js';
import type { ExecutionRouteContext } from './shared.js';
import type {} from './schemas.js';
import { parseBody } from './shared.js';
import { PolicySchema } from './schemas.js';
import { type ArtifactKind, type DomainName } from '../../execution/types.js';
import { listIntegrationMaturity } from '../../execution/maturity.js';
import { ensurePolicy } from './shared.js';
export function registerPolicyRoutes(app: Hono, context: ExecutionRouteContext): void {
  const { options, ws } = context;
  app.get('/api/v1/quality-policies', async (c) => {
    const policies = await options.store.listPolicies(ws);
    if (policies.length === 0) return c.json([await ensurePolicy(options.store, ws)]);
    return c.json(policies);
  });

  app.post('/api/v1/quality-policies', async (c) => {
    const parsed = await parseBody(c, PolicySchema);
    if (!parsed) throw new DomainError('INVALID_POLICY', 'Quality policy is invalid');
    const input = {
      workspaceId: ws,
      name: parsed.name,
      version: parsed.version,
      requiredDomains: parsed.requiredDomains,
      browserPassRateThreshold: parsed.browserPassRateThreshold,
      maxFlakyRate: parsed.maxFlakyRate,
      maxDurationMs: parsed.maxDurationMs,
      rules: parsed.rules as Array<{
        domain: DomainName;
        required: boolean;
        minimumPassRate?: number;
        requiredArtifactKinds: ArtifactKind[];
      }>,
    };
    const policy = await options.store.createPolicy(input);
    return c.json(policy, 201);
  });

  app.get('/api/v1/integrations/maturity', (c) =>
    c.json({ registryVersion: '1', integrations: listIntegrationMaturity() }),
  );
}
