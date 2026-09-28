/**
 * runners.routes.ts — enrolment, heartbeat, and job claiming.
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
import { parseBody, registrationAuthorized } from './shared.js';
import { ClaimSchema, HeartbeatSchema, RegistrationSchema } from './schemas.js';
import { createRunnerToken, hashRunnerToken } from '../../execution/in-memory-execution-store.js';
import { randomUUID } from 'node:crypto';
import { authenticate } from './shared.js';
export function registerRunnerRoutes(app: Hono, context: ExecutionRouteContext): void {
  const { options, ws } = context;
  app.post('/api/v1/runners/register', async (c) => {
    if (
      !registrationAuthorized(c, options.runnerRegistrationSecret ?? options.registrationSecret)
    ) {
      throw new DomainError(
        'RUNNER_REGISTRATION_UNAUTHORIZED',
        'Runner registration secret is invalid',
      );
    }
    const parsed = await parseBody(c, RegistrationSchema);
    if (!parsed) throw new DomainError('INVALID_RUNNER_MANIFEST', 'Runner manifest is invalid');
    const manifest = (parsed.manifest ?? parsed) as {
      id?: string;
      name?: string;
      version?: string;
      os?: string;
      arch?: string;
      capabilities?: string[];
      labels?: string[];
      slots?: number;
    };
    const runnerId = parsed.runnerId ?? manifest.id ?? randomUUID();
    // Re-registering an existing id used to silently rotate that runner's
    // token, so anyone holding the registration secret could impersonate any
    // runner. Rotation now requires the current token as proof of possession.
    const existing = await options.store.getRunner(runnerId);
    if (existing) {
      if (parsed.rotationToken === undefined)
        throw new DomainError(
          'RUNNER_ID_TAKEN',
          'Runner id is already registered; supply rotationToken to rotate its credential',
        );
      const presented = await options.store.authenticateRunner(parsed.rotationToken);
      if (!presented || presented.id !== runnerId)
        throw new DomainError(
          'RUNNER_ROTATION_UNAUTHORIZED',
          'rotationToken does not authenticate the runner being rotated',
        );
    }
    const token = createRunnerToken();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const capabilitiesInput = manifest.capabilities ?? parsed.capabilities;
    const capabilities =
      capabilitiesInput && capabilitiesInput.length > 0 ? capabilitiesInput : ['generic'];
    const runner = await options.store.registerRunner(
      {
        id: runnerId,
        name: manifest.name ?? 'runner',
        version: manifest.version ?? 'unknown',
        os: manifest.os ?? process.platform,
        arch: manifest.arch ?? process.arch,
        capabilities,
        labels: manifest.labels ?? parsed.labels,
        slots: manifest.slots ?? parsed.slots,
      },
      hashRunnerToken(token),
      expiresAt,
      ws,
    );
    return c.json(
      {
        runnerId: runner.id,
        token,
        expiresAt,
        manifest: {
          id: runner.id,
          name: runner.name,
          version: runner.version,
          os: runner.os,
          arch: runner.arch,
          capabilities: runner.capabilities,
          labels: runner.labels,
          slots: runner.slots,
        },
      },
      201,
    );
  });

  app.post('/api/v1/runners/:runnerId/heartbeat', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner || runner.id !== c.req.param('runnerId'))
      throw new DomainError('RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, HeartbeatSchema);
    if (!parsed) throw new DomainError('INVALID_HEARTBEAT', 'Runner heartbeat is invalid');
    const heartbeat = await options.store.heartbeatRunner(
      runner.id,
      parsed.activeJobIds ?? parsed.activeJobs ?? [],
      parsed.health,
    );
    if (!heartbeat) throw new DomainError('RUNNER_NOT_FOUND', 'Runner not found');
    return c.json(heartbeat);
  });

  app.post('/api/v1/runners/:runnerId/jobs/claim', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner || runner.id !== c.req.param('runnerId'))
      throw new DomainError('RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, ClaimSchema);
    if (!parsed) throw new DomainError('INVALID_CLAIM', 'Runner claim is invalid');
    const job = await options.store.claimJob(
      runner.id,
      parsed.capabilities ?? parsed.requiredCapabilities,
      parsed.labels,
      undefined,
      ws,
    );
    if (!job) return c.body(null, 204);
    return c.json(job);
  });
}
