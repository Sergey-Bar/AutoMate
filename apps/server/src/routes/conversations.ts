import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import type { MemoryRepository } from '../agent/memory.js';
import { validateOrReply } from '../lib/validate-or-reply.js';
import { formatValidationError } from '../lib/validation.js';

export interface ConversationRoutesOptions {
  memory: MemoryRepository;
}

export const CreateConversationSchema = z.object({
  title: z.string().optional(),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export async function conversationRoutes(app: FastifyInstance, opts: ConversationRoutesOptions): Promise<void> {
  const { memory } = opts;

  app.post('/api/conversations', async (request, reply): Promise<void> => {
    const body = await validateOrReply(CreateConversationSchema, request, reply);
    if (!body) return;

    const { title } = body;
    const id = crypto.randomUUID();
    try {
      await memory.saveConversation({ id, title: title ?? null });
      const conv = await memory.getConversation(id);
      reply.code(201).send(conv);
    } catch (err: unknown) {
      app.log.error({ err }, 'Failed to create conversation');
      reply.code(500).send({ error: 'Failed to create conversation' });
    }
  });

  app.get('/api/conversations', async (request, reply): Promise<unknown> => {
    const result = PaginationSchema.safeParse(request.query ?? {});
    if (!result.success) {
      return reply.code(400).send({
        error: formatValidationError(result.error.issues),
      });
    }

    const { limit, offset } = result.data;
    try {
      return await memory.listConversations({ limit, offset });
    } catch (err: unknown) {
      app.log.error({ err }, 'Failed to list conversations');
      return reply.code(500).send({ error: 'Failed to list conversations' });
    }
  });

  app.delete('/api/conversations/:id', async (request, reply): Promise<void> => {
    const { id } = request.params as { id: string };
    try {
      const existing = await memory.getConversation(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      await memory.deleteConversation(id);
      reply.code(204).send();
    } catch (err: unknown) {
      app.log.error({ err }, 'Failed to delete conversation');
      reply.code(500).send({ error: 'Failed to delete conversation' });
    }
  });

  app.get('/api/conversations/:id/messages', async (request, reply): Promise<unknown> => {
    const { id } = request.params as { id: string };

    const result = PaginationSchema.safeParse(request.query ?? {});
    if (!result.success) {
      return reply.code(400).send({
        error: formatValidationError(result.error.issues),
      });
    }

    const { limit, offset } = result.data;
    try {
      return await memory.listMessages(id, { limit, offset });
    } catch (err: unknown) {
      app.log.error({ err }, 'Failed to list messages');
      return reply.code(500).send({ error: 'Failed to list messages' });
    }
  });
}
