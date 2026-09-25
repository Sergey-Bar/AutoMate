import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import type { MemoryRepository } from '../agent/memory.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import { createOrchestrator } from '../agent/orchestrator-loop.js';
import type { ModelConfig } from '../agent/planner.js';
import type { EventHub } from '../services/event-hub.js';
import { validateOrReply } from '../lib/validate-or-reply.js';
import { pipeResponseStream } from '../lib/stream-helper.js';
import type { FlowTemplate } from '../db/schema.js';

export interface ChatDeps {
  memory: MemoryRepository;
  registry: ConnectorRegistry;
  getModelConfig: () => Promise<ModelConfig>;
  getCredentials: () => Promise<Record<string, Record<string, string>>>;
  getSystemPrompt: () => string;
  getFlowTemplate?: (id: string) => Promise<FlowTemplate | undefined>;
  rateLimitConfig?: {
    rateLimit: {
      max: number;
      timeWindow: string;
    };
  };
  eventHub?: EventHub;
}

/** Maximum allowed length for a single chat message content (32 KB). */
const MAX_MESSAGE_LENGTH = 32_768;

export const ChatBodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string().max(MAX_MESSAGE_LENGTH),
  })).min(1),
  conversationId: z.string().optional(),
  flowTemplate: z.string().optional(),
});

export function toSseEvent(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function chatRoutes(app: FastifyInstance, deps: ChatDeps): Promise<void> {
  const orchestrator = createOrchestrator(deps.registry);

  app.post('/api/chat', { config: deps.rateLimitConfig }, async (request, reply): Promise<void> => {
    const body = await validateOrReply(ChatBodySchema, request, reply);
    if (!body) return;

    // Ensure conversation exists
    let conversationId = body.conversationId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      const firstMsg = body.messages.find(m => m.role === 'user');
      try {
        await deps.memory.saveConversation({
          id: conversationId,
          title: firstMsg?.content.slice(0, 100) ?? 'New Chat',
        });
      } catch (err) {
        app.log.error({ err, conversationId }, 'Failed to save conversation');
        return reply.code(500).send({ error: 'Failed to save conversation' });
      }
    }

    // Save user message
    const userMsg = body.messages[body.messages.length - 1];
    if (userMsg?.role === 'user') {
      try {
        await deps.memory.saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          role: 'user',
          content: userMsg.content,
        });
      } catch (err) {
        app.log.error({ err, conversationId }, 'Failed to save user message');
        return reply.code(500).send({ error: 'Failed to save message' });
      }
    }

    // Stream response
    let modelConfig: ModelConfig;
    let credentials: Record<string, Record<string, string>>;
    let systemPrompt: string;
    
    try {
      modelConfig = await deps.getModelConfig();
      credentials = await deps.getCredentials();
      systemPrompt = deps.getSystemPrompt();
    } catch (err) {
      app.log.error({ err }, 'Failed to get model config or credentials');
      return reply.code(500).send({ error: 'Failed to initialize AI configuration' });
    }

    if (body.flowTemplate && deps.getFlowTemplate) {
      try {
        const template = await deps.getFlowTemplate(body.flowTemplate);
        if (template) {
          systemPrompt = template.systemPrompt + '\n\n' + systemPrompt;
        }
      } catch (err) {
        app.log.error({ err, flowTemplate: body.flowTemplate }, 'Failed to load flow template');
      }
    }

    const result = orchestrator.stream(
      body.messages,
      systemPrompt,
      modelConfig,
      credentials,
      {
        conversationId,
        onToolStart: deps.eventHub ? (toolName) => {
          deps.eventHub!.broadcast({
            type: 'tool:start',
            payload: { toolName, conversationId },
          });
        } : undefined,
        onToolExecute: deps.eventHub ? (event) => {
          const eventType = event.status === 'error' ? 'tool:error' : 'tool:complete';
          deps.eventHub!.broadcast({
            type: eventType,
            payload: {
              toolName: event.toolName,
              conversationId,
              durationMs: event.durationMs,
              ...(event.errorMessage ? { error: event.errorMessage } : {}),
            },
          });
        } : undefined,
      },
    );

    // Use Vercel AI SDK's built-in streaming response
    try {
      const response = (await result).toTextStreamResponse();
      await pipeResponseStream(response, reply);
    } catch (err) {
      app.log.error({ err, conversationId }, 'Stream failed during response processing');
      if (!reply.raw.headersSent) {
        reply.code(500).send({ error: 'Stream failed' });
      } else {
        reply.raw.end();
      }
    }
  });
}
