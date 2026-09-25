import type { FastifyInstance } from 'fastify';
import { getFeatureFlags } from '../services/feature-flags.js';

export async function featuresRoutes(app: FastifyInstance) {
  app.get('/api/features', async () => {
    return getFeatureFlags();
  });
}
