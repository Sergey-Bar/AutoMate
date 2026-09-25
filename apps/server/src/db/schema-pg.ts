// PostgreSQL schema — mirrors schema.ts but uses pgTable instead of sqliteTable.
// Used by client.ts when DATABASE_URL is a postgres:// connection string.
import { boolean, doublePrecision, index, integer, pgTable, real, text } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  flowTemplateId: text('flow_template_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('conversations_created_at_idx').on(t.createdAt),
]);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  toolName: text('tool_name'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('messages_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
]);

export const messageAttachments = pgTable('message_attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes'),
});

export const connectorConfigs = pgTable('connector_configs', {
  id: text('id').primaryKey(),
  connectorName: text('connector_name').notNull().unique(),
  enabled: boolean('enabled').default(false),
  credentialRef: text('credential_ref'),
  settings: text('settings'),
  updatedAt: text('updated_at').notNull(),
});

export const flowTemplates = pgTable('flow_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  steps: text('steps'),
  category: text('category'),
  isBuiltIn: boolean('is_built_in').default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const executionLog = pgTable('execution_log', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(),
  output: text('output'),
  status: text('status', { enum: ['running', 'success', 'error', 'timeout'] }).notNull(),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('execution_log_conversation_id_idx').on(t.conversationId),
  index('execution_log_created_at_idx').on(t.createdAt),
]);

export const modelConfig = pgTable('model_config', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider').notNull().default('ollama'),
  model: text('model').notNull().default('llama3.1'),
  endpoint: text('endpoint').notNull().default('http://localhost:11434'),
  temperature: doublePrecision('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  systemPrompt: text('system_prompt'),
  updatedAt: text('updated_at').notNull(),
});

export const traceLinks = pgTable('trace_links', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  linkType: text('link_type').notNull(),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
}, (t) => [
  index('trace_links_source_idx').on(t.sourceType, t.sourceId),
  index('trace_links_target_idx').on(t.targetType, t.targetId),
]);

export type Conversation = InferSelectModel<typeof conversations>;
export type Message = InferSelectModel<typeof messages>;
export type MessageAttachment = InferSelectModel<typeof messageAttachments>;
export type ConnectorConfig = InferSelectModel<typeof connectorConfigs>;
export type FlowTemplate = InferSelectModel<typeof flowTemplates>;
export type ExecutionLogRow = InferSelectModel<typeof executionLog>;
export type ModelConfigRow = InferSelectModel<typeof modelConfig>;
export type TraceLink = InferSelectModel<typeof traceLinks>;
export type NewConversation = InferInsertModel<typeof conversations>;
export type NewMessage = InferInsertModel<typeof messages>;
export type NewExecutionLogRow = InferInsertModel<typeof executionLog>;
