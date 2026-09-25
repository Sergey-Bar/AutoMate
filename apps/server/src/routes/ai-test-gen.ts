import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requireFeature } from '../services/feature-flags.js';
import { generateTestsFromSource } from '../services/ai-test-gen.js';
import { createModelForProvider } from '../agent/providers.js';
import { validateOrReply } from '../lib/validate-or-reply.js';

const GenerateTestBody = z.object({
  sourceCode: z.string().min(1, 'sourceCode is required'),
  filePath: z.string().min(1, 'filePath is required'),
});

export async function aiTestGenRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/ai/generate-test',
    {
      preHandler: requireFeature('ai-test-gen'),
    },
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(GenerateTestBody, req, reply);
      if (!body) return;

      const endpoint = process.env['AUTOMATE_ENDPOINT'] ?? 'http://localhost:11434';
      const modelName = process.env['AUTOMATE_MODEL'] ?? 'llama3.1';
      const model = createModelForProvider({
        provider: 'ollama',
        model: modelName,
        endpoint,
      }) as Parameters<typeof generateTestsFromSource>[2];

      try {
        const result = await generateTestsFromSource(body.sourceCode, body.filePath, model);
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message });
      }
    },
  );
}
