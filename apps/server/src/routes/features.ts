import type { FastifyInstance } from 'fastify';
import { getFeatureFlags } from '../services/feature-flags.js';

export async function featureRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/features', async (_req, reply): Promise<void> => {
    return reply.send(getFeatureFlags());
  });
}
