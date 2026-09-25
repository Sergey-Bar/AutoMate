/**
 * service-trigger.ts — External test triggering route
 *
 * POST /api/service/trigger-run
 *   - Feature-gated behind `external-trigger` flag
 *   - Protected by service auth (fail-closed): if AUTOMATE_SERVICE_SECRET is not set,
 *     returns 503. Never allows unauthenticated access when service feature is enabled.
 *   - Accepts spec code, spawns Playwright in sandbox, returns runId immediately (202)
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireFeature } from '../services/feature-flags.js';
import { requireServiceAuth } from '../services/service-auth.js';
import { testRunner } from '../services/test-runner.js';

export interface ServiceTriggerOptions {
  serviceSecret?: string;
}

export async function serviceTriggerRoutes(
  app: FastifyInstance,
  _options: ServiceTriggerOptions,
): Promise<void> {
  app.post('/api/service/trigger-run', {
    preHandler: [
      requireFeature('external-trigger'),
      requireServiceAuth,
    ],
  }, async (request, reply) => {
    const body = request.body as {
      specCode?: string;
      specFileName?: string;
      baseUrl?: string;
      browser?: 'chromium' | 'firefox' | 'webkit';
      metadata?: Record<string, string>;
    } | null | undefined;

    // Validate required fields
    if (!body?.specCode || !body?.specFileName) {
      return reply.code(400).send({ error: 'specCode and specFileName are required' });
    }

    // Generate a unique runId
    const runId = randomUUID();

    // Queue async execution (return immediately)
    // Fire and forget — test-runner handles execution
    testRunner
      .executeTestRun({
        runId,
        specCode: body.specCode,
        specFileName: body.specFileName,
        baseUrl: body.baseUrl,
        browser: body.browser,
        metadata: body.metadata,
      })
      .catch((err) => {
        app.log.error({ err, runId }, 'Test run execution failed');
      });

    return reply.code(202).send({ runId, status: 'queued' });
  });
}
