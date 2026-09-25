import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requireFeature } from '../services/feature-flags.js';
import { generateTestsFromDiff, generateTestsFromRequirement } from '../services/ai-test-gen.js';
import { createModelForProvider } from '../agent/providers.js';
import { validateOrReply } from '../lib/validate-or-reply.js';
const FromDiffBody = z.object({
  diff: z.string().min(1, 'diff is required'),
  filePath: z.string().optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
});

const FromRequirementBody = z.object({
  requirement: z.string().min(1, 'requirement is required'),
  language: z.string().optional(),
  framework: z.string().optional(),
});

export async function testGenerationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/test-generation/from-diff',
    {
      preHandler: requireFeature('ai-test-gen-v2'),
    },
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(FromDiffBody, req, reply);
      if (!body) return;

      const endpoint = process.env['AUTOMATE_ENDPOINT'] ?? 'http://localhost:11434';
      const modelName = process.env['AUTOMATE_MODEL'] ?? 'llama3.1';
      const model = createModelForProvider({
        provider: 'ollama',
        model: modelName,
        endpoint,
      }) as Parameters<typeof generateTestsFromDiff>[1];

      try {
        const result = await generateTestsFromDiff(
          {
            diff: body.diff,
            filePath: body.filePath,
            language: body.language,
            framework: body.framework,
          },
          model,
        );
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/api/test-generation/from-requirement',
    {
      preHandler: requireFeature('ai-test-gen-v2'),
    },
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(FromRequirementBody, req, reply);
      if (!body) return;

      const endpoint = process.env['AUTOMATE_ENDPOINT'] ?? 'http://localhost:11434';
      const modelName = process.env['AUTOMATE_MODEL'] ?? 'llama3.1';
      const model = createModelForProvider({
        provider: 'ollama',
        model: modelName,
        endpoint,
      }) as Parameters<typeof generateTestsFromRequirement>[1];

      try {
        const result = await generateTestsFromRequirement(
          {
            requirement: body.requirement,
            language: body.language,
            framework: body.framework,
          },
          model,
        );
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message });
      }
    },
  );
}
