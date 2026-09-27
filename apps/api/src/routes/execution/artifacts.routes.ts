/**
 * artifacts.routes.ts — listing a run's artifacts and reading one by id.
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
import type { ExecutionRouteContext } from './shared.js';
import type {} from './schemas.js';
import { error, safeName } from './shared.js';
import { missingArtifact } from './shared.js';
export function registerArtifactRoutes(app: Hono, context: ExecutionRouteContext): void {
  const { options, ws } = context;
  app.get('/api/v1/runs/:runId/artifacts', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (!run) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
    return c.json(await options.store.listArtifacts(ws, runId));
  });

  app.get('/api/v1/artifacts/:artifactId', async (c) => {
    const artifactId = c.req.param('artifactId');
    const artifact = await options.store.getArtifact(artifactId, ws);
    if (!artifact) return missingArtifact(c, options.store, artifactId, undefined, ws);
    const headers: Record<string, string> = {
      'content-type': artifact.contentType,
      'content-length': String(artifact.sizeBytes),
      'x-artifact-checksum': artifact.checksum,
      'content-disposition': `attachment; filename="${safeName(artifact.name)}"`,
    };
    return new Response(Buffer.from(artifact.bytes), { status: 200, headers });
  });

  app.get('/api/v1/runs/:runId/artifacts/:artifactId', async (c) => {
    const runId = c.req.param('runId');
    const artifactId = c.req.param('artifactId');
    const artifact = await options.store.getArtifact(artifactId);
    if (!artifact) return missingArtifact(c, options.store, artifactId, runId);
    if (artifact.runId !== runId) return error(c, 404, 'ARTIFACT_NOT_FOUND', 'Artifact not found');
    return new Response(Buffer.from(artifact.bytes), {
      headers: {
        'content-type': artifact.contentType,
        'content-length': String(artifact.bytes.byteLength),
        'content-disposition': `attachment; filename="${safeName(artifact.name)}"`,
        'x-content-sha256': artifact.checksum,
      },
    });
  });
}
