import { z } from 'zod';

export const PROJECT_NAME = 'Automate';

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  flowTemplateId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  metadata: z.string().nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  connectorName: z.string(),
  enabled: z.boolean(),
  credentialRef: z.string().nullable(),
  settings: z.string().nullable(),
  updatedAt: z.string(),
});
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export const FlowTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string(),
  steps: z.string().nullable(),
  category: z.string().nullable(),
  isBuiltIn: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FlowTemplate = z.infer<typeof FlowTemplateSchema>;

export const ExecutionStatusSchema = z.enum(['running', 'success', 'error', 'timeout']);
export const ExecutionLogSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullable(),
  toolName: z.string(),
  input: z.string(),
  output: z.string().nullable(),
  status: ExecutionStatusSchema,
  durationMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;

export const ProviderSchema = z.enum([
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
export type Provider = z.infer<typeof ProviderSchema>;

export const ModelConfigSchema = z.object({
  id: z.string(),
  provider: ProviderSchema,
  model: z.string(),
  endpoint: z.string().url(),
  temperature: z.number(),
  maxTokens: z.number(),
  systemPrompt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/;

export function parseJsonSafe<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
