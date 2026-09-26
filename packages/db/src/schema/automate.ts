// Ported from Automate/apps/server/src/db/schema.ts
// SQLite → PostgreSQL type adaptations:
//   text(UUID) → uuid
//   text(date/ISO) → timestamp with timezone
//   integer(boolean mode) → boolean
//   real → real
//   text(JSON) → jsonb
//   integer autoIncrement PK → serial

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  index,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

// ─── conversations ─────────────────────────────────────────────────────────
// Source: conversations table — chat conversation records
export const conversations = pgTable(
  'conversations',
  {
    // SQLite: text('id').primaryKey()
    id: text('id').primaryKey(),
    title: text('title'),
    flowTemplateId: text('flow_template_id'),
    // SQLite: text('created_at').notNull()
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('conversations_created_at_idx').on(t.createdAt)],
);

// ─── messages ──────────────────────────────────────────────────────────────
// Source: messages table — individual chat messages
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // SQLite: text('role', { enum: ['user', 'assistant', 'system', 'tool'] })
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    content: text('content').notNull(),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    // SQLite: text('metadata') // JSON
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('messages_conversation_id_created_at_idx').on(t.conversationId, t.createdAt)],
);

// ─── message_attachments ───────────────────────────────────────────────────
// Source: message_attachments table — file attachments on messages
export const messageAttachments = pgTable('message_attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  path: text('path').notNull(),
  // SQLite: integer('size_bytes')
  sizeBytes: integer('size_bytes'),
});

// ─── connector_configs ─────────────────────────────────────────────────────
// Source: connector_configs table — per-connector settings
export const connectorConfigs = pgTable('connector_configs', {
  id: text('id').primaryKey(),
  connectorName: text('connector_name').notNull().unique(),
  // SQLite: integer('enabled', { mode: 'boolean' })
  enabled: boolean('enabled').default(false),
  credentialRef: text('credential_ref'),
  // SQLite: text('settings') // JSON
  settings: jsonb('settings'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── flow_templates ────────────────────────────────────────────────────────
// Source: flow_templates table — workflow templates
export const flowTemplates = pgTable('flow_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  // SQLite: text('steps') // JSON
  steps: jsonb('steps'),
  category: text('category'),
  // SQLite: integer('is_built_in', { mode: 'boolean' })
  isBuiltIn: boolean('is_built_in').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── execution_log ─────────────────────────────────────────────────────────
// Source: execution_log table — tool execution audit trail
export const executionLog = pgTable(
  'execution_log',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id),
    toolName: text('tool_name').notNull(),
    // SQLite: text('input').notNull() // JSON
    input: jsonb('input').notNull(),
    // SQLite: text('output') // JSON
    output: jsonb('output'),
    status: text('status', { enum: ['running', 'success', 'error', 'timeout'] }).notNull(),
    // SQLite: integer('duration_ms')
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('execution_log_conversation_id_idx').on(t.conversationId),
    index('execution_log_created_at_idx').on(t.createdAt),
  ],
);

// ─── model_config ──────────────────────────────────────────────────────────
// Source: model_config table — active LLM configuration
export const modelConfig = pgTable('model_config', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider').notNull().default('ollama'),
  model: text('model').notNull().default('llama3.1'),
  endpoint: text('endpoint').notNull().default('http://localhost:11434'),
  // SQLite: real('temperature')
  temperature: real('temperature').default(0.7),
  // SQLite: integer('max_tokens')
  maxTokens: integer('max_tokens').default(4096),
  systemPrompt: text('system_prompt'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── trace_links ───────────────────────────────────────────────────────────
// Source: trace_links table — cross-entity traceability links
export const traceLinks = pgTable(
  'trace_links',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    linkType: text('link_type').notNull(),
    // SQLite: text('metadata') // JSON
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by'),
  },
  (t) => [
    index('trace_links_source_idx').on(t.sourceType, t.sourceId),
    index('trace_links_target_idx').on(t.targetType, t.targetId),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────
export type Conversation = InferSelectModel<typeof conversations>;
export type NewConversation = InferInsertModel<typeof conversations>;
export type Message = InferSelectModel<typeof messages>;
export type NewMessage = InferInsertModel<typeof messages>;
export type MessageAttachment = InferSelectModel<typeof messageAttachments>;
export type NewMessageAttachment = InferInsertModel<typeof messageAttachments>;
export type ConnectorConfig = InferSelectModel<typeof connectorConfigs>;
export type NewConnectorConfig = InferInsertModel<typeof connectorConfigs>;
export type FlowTemplate = InferSelectModel<typeof flowTemplates>;
export type NewFlowTemplate = InferInsertModel<typeof flowTemplates>;
export type ExecutionLogRow = InferSelectModel<typeof executionLog>;
export type NewExecutionLogRow = InferInsertModel<typeof executionLog>;
export type ModelConfigRow = InferSelectModel<typeof modelConfig>;
export type NewModelConfig = InferInsertModel<typeof modelConfig>;
export type TraceLink = InferSelectModel<typeof traceLinks>;
export type NewTraceLink = InferInsertModel<typeof traceLinks>;
