import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_MAX_ARTIFACT_BYTES } from '../infrastructure/s3-artifact-bytes.js';
import type { ExecutionRoutesOptions } from './execution/schemas.js';
import { MAX_EXECUTION_BODY_BYTES, requestId, workspace } from './execution/shared.js';
import type { ExecutionRouteContext } from './execution/shared.js';
import { registerArtifactRoutes } from './execution/artifacts.routes.js';
import { registerJobRoutes } from './execution/jobs.routes.js';
import { registerPolicyRoutes } from './execution/policies.routes.js';
import { registerRunRoutes } from './execution/runs.routes.js';
import { registerRunnerRoutes } from './execution/runners.routes.js';

/**
 * execution.ts — the execution API, composed from five route groups.
 *
 * This was a single 1 139-line module: nine Zod request bodies, eighteen helpers and
 * twenty-four route handlers, in one file, in the order they happened to be typed.
 * It is now four concerns plus this one:
 *
 * - `execution/schemas.ts` — the request bodies and the options type. A body shape is
 *   a contract the reporter, the runner and the dashboard all send, and it was
 *   readable only by opening a route module full of handlers it has nothing to do with.
 * - `execution/shared.ts` — the helpers. Four groups had no way to reach one another's
 *   copy of "the effective workspace" or "an error body in the standard shape", which
 *   is how one path answers 401 and the next answers 400.
 * - `execution/{runs,artifacts,policies,runners,jobs}.routes.ts` — the handlers, with
 *   their bodies moved verbatim.
 * - this file — the body limit, the shared closure state, and **the registration
 *   order, written down once**.
 *
 * The order is the part that matters. Hono resolves an overlapping `method+path` by
 * registration order, so before this split the order was a property of the file's
 * layout: inserting a handler in the wrong place would have silently changed which one
 * answered. `route-manifest.test.ts` mounts these in the same order and asserts the
 * canonical route set, so the order is now a stated fact with a test on it rather than
 * an accident of line numbers.
 *
 * Nothing else changed. The handler bodies were moved byte for byte, which is why the
 * 148 route tests passed on the first run of each extraction step.
 */
export function createExecutionRoutes(options: ExecutionRoutesOptions): Hono {
  const app = new Hono();
  const context: ExecutionRouteContext = {
    options,
    ws: workspace(options),
    eventSequences: new Map<string, number>(),
    maxArtifactBytes: options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
  };

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_EXECUTION_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Request body exceeds the configured limit',
              requestId: requestId(c),
              details: { maxBytes: MAX_EXECUTION_BODY_BYTES },
            },
          },
          413,
        ),
    }),
  );

  // In the order they have always been registered. `route-manifest.test.ts` asserts
  // the resulting route set against the mounted app, so this list and the app cannot
  // drift apart without a test failing.
  registerRunRoutes(app, context);
  registerArtifactRoutes(app, context);
  registerPolicyRoutes(app, context);
  registerRunnerRoutes(app, context);
  registerJobRoutes(app, context);

  return app;
}

export const createExecutionApiRoutes = createExecutionRoutes;
export const createRunnerApiRoutes = createExecutionRoutes;
