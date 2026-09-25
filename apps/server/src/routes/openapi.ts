import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requireFeature } from '../services/feature-flags.js';
import { parseOpenApiSpec } from '../services/openapi-parser.js';
import type { ParsedSpec } from '../services/openapi-parser.js';
import { validateOrReply } from '../lib/validate-or-reply.js';
import { generateContractTests } from '../services/contract-test-gen.js';
import { createModelForProvider } from '../agent/providers.js';

const ParseRequestBody = z.object({
  spec: z.string().min(1, 'spec is required'),
});

const GenerateTestsRequestBody = z.object({
  spec: z.string().min(1, 'spec is required'),
});

export async function openApiRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/openapi/parse',
    {
      preHandler: requireFeature('openapi-parsing'),
    },
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(ParseRequestBody, req, reply);
      if (!body) return;

      try {
        const parsed = await parseOpenApiSpec(body.spec);
        return reply.send(parsed);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/api/openapi/generate-tests',
    {
      preHandler: requireFeature('contract-test-gen'),
    },
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(GenerateTestsRequestBody, req, reply);
      if (!body) return;

      let parsedSpec: ParsedSpec;
      try {
        parsedSpec = await parseOpenApiSpec(body.spec);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }

      const endpoint = process.env['AUTOMATE_ENDPOINT'] ?? 'http://localhost:11434';
      const modelName = process.env['AUTOMATE_MODEL'] ?? 'llama3.1';
      const model = createModelForProvider({
        provider: 'ollama',
        model: modelName,
        endpoint,
      }) as Parameters<typeof generateContractTests>[1];

      try {
        const result = await generateContractTests(parsedSpec, model);
        return reply.send(result);
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message });
      }
    },
  );
}
