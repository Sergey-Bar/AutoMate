import type { FastifyInstance } from 'fastify';
import * as path from 'path';
import * as fs from 'fs';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), 'test-results');

export async function artifactsRoutes(app: FastifyInstance) {
  // GET /artifacts/* — serve any file from the artifacts directory
  app.get<{ Params: { '*': string } }>('/artifacts/*', async (req, reply) => {
    const relativePath = req.params['*'];
    // Security: prevent path traversal
    const resolved = path.resolve(ARTIFACTS_DIR, relativePath);
    const normalizedArtifacts = path.resolve(ARTIFACTS_DIR);
    if (!resolved.startsWith(normalizedArtifacts + path.sep) && resolved !== normalizedArtifacts) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!fs.existsSync(resolved)) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }
    return reply.sendFile(path.relative(ARTIFACTS_DIR, resolved));
  });
}
