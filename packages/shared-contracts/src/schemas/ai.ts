/**
 * AI provider domain schemas — Zod v4
 *
 * Covers provider config, model info, chat messages, streaming events,
 * and tool call/result contracts.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// AIProviderConfig
// ---------------------------------------------------------------------------

export const AIProviderNameSchema = z.enum([
  'ollama',
  'openai',
  'anthropic',
  'google',
  'azure-openai',
  'groq',
  'mistral',
  'openrouter',
  'cohere',
  'bedrock',
]);
export type AIProviderName = z.infer<typeof AIProviderNameSchema>;

export const AIProviderConfigSchema = z.object({
  provider: AIProviderNameSchema,
  model: z.string(),
  endpoint: z.string().url(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  apiKey: z.string().optional(),
});
export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>;

// ---------------------------------------------------------------------------
// AIModelInfo
// ---------------------------------------------------------------------------

export const AIModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: AIProviderNameSchema,
  contextWindow: z.number().int().positive().optional(),
  supportsTools: z.boolean(),
  supportsStreaming: z.boolean(),
});
export type AIModelInfo = z.infer<typeof AIModelInfoSchema>;

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

export const ChatMessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatMessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------------------------------------------------------------------------
// ToolCall / ToolResult
// ---------------------------------------------------------------------------

export const ToolCallSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// ---------------------------------------------------------------------------
// ChatStreamEvent
// ---------------------------------------------------------------------------

export const ChatStreamEventTypeSchema = z.enum([
  'text-delta',
  'tool-call',
  'tool-result',
  'finish',
  'error',
]);
export type ChatStreamEventType = z.infer<typeof ChatStreamEventTypeSchema>;

export const ChatStreamEventSchema = z.object({
  type: ChatStreamEventTypeSchema,
  delta: z.string().optional(),
  toolCall: ToolCallSchema.optional(),
  toolResult: ToolResultSchema.optional(),
  finishReason: z.enum(['stop', 'length', 'tool-calls', 'content-filter', 'error']).optional(),
  error: z.string().optional(),
});
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
