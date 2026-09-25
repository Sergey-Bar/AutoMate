import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { modelConfig } from '../db/schema.js';
import { db } from '../db/client.js';
import { SUPPORTED_PROVIDERS, isSupportedProvider } from '../agent/providers.js';
import { validateOrReply } from '../lib/validate-or-reply.js';

export const ModelConfigUpdateSchema = z
  .object({
    provider: z.string().refine((provider) => isSupportedProvider(provider), {
      message: `Unsupported provider. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
    }),
    model: z.string(),
    endpoint: z.string().url(),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
  })
  .partial();

/**
 * Masks an API key for safe display.
 * Shows first 4 and last 4 chars, masks the middle with asterisks.
 * Returns "****" for keys shorter than 8 characters.
 */
export function maskApiKey(key: string): string {
  if (key.length < 8) return '****';
  const first = key.slice(0, 4);
  const last = key.slice(-4);
  const masked = '*'.repeat(key.length - 8);
  return `${first}${masked}${last}`;
}

export async function modelConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/model-config', async (): Promise<unknown> => {
    const rows = await db.select().from(modelConfig).where(eq(modelConfig.id, 'default'));
    const row = rows[0];
    if (!row) {
      return {
        provider: 'ollama',
        model: 'llama3.1',
        endpoint: 'http://localhost:11434',
        temperature: 0.7,
        maxTokens: 4096,
      };
    }
    return {
      provider: row.provider,
      model: row.model,
      endpoint: row.endpoint,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
    };
  });

  app.put('/api/model-config', async (request, reply): Promise<void> => {
    const body = await validateOrReply(ModelConfigUpdateSchema, request, reply);
    if (!body) return;

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.provider !== undefined) updates.provider = body.provider;
    if (body.model !== undefined) updates.model = body.model;
    if (body.endpoint !== undefined) updates.endpoint = body.endpoint;
    if (body.temperature !== undefined) updates.temperature = body.temperature;
    if (body.maxTokens !== undefined) updates.maxTokens = body.maxTokens;

    try {
      await db.update(modelConfig).set(updates).where(eq(modelConfig.id, 'default'));
      reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error({ err, updates }, 'Failed to update model config');
      return reply.code(500).send({ error: 'Failed to update configuration' });
    }
  });
}
