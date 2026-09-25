import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requireFeature } from '../services/feature-flags.js';
import { parsePostmanCollection } from '../services/postman-parser.js';
import { validateOrReply } from '../lib/validate-or-reply.js';

const ImportRequestBody = z.object({
  collection: z.string().min(1, 'collection is required'),
});

export async function postmanRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/postman/import',
    {
      preHandler: requireFeature('postman-import'),
    },
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(ImportRequestBody, req, reply);
      if (!body) return;

      try {
        const parsed = parsePostmanCollection(body.collection);
        return reply.send(parsed);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    },
  );
}
