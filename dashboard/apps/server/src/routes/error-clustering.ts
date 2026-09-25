/**
 * apps/server/src/routes/error-clustering.ts
 *
 * Expose error-clustering service via REST API.
 *
 * GET /api/error-clusters?runId=<runId>  → cluster errors for a given run
 */
import type { FastifyInstance } from 'fastify';
import { clusterErrors } from '../services/error-clustering.js';
import { requireFeature } from '../services/feature-flags.js';

export async function errorClusteringRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { runId?: string } }>(
    '/api/error-clusters',
    { preHandler: requireFeature('error-clustering') },
    async (req, reply) => {
      const { runId } = req.query;
      if (!runId) {
        return reply.status(400).send({ error: 'Missing required query parameter: runId' });
      }
      const clusters = await clusterErrors(runId);
      return reply.send(clusters);
    },
  );
}
