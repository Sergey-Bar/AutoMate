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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

// ─── conversations ─────────────────────────────────────────────────────────
// Source: conversations table — chat conversation records
export const conversations = pgTable(
  'conversations',
  {
    // SQLite: text('id').primaryKey()
    id: text('id').primaryKey(),
    // Added, `NOT NULL`, by `0018_chat_workspace_scope.sql`. Every conversation was
    // globally readable before it, and this is the only tenancy boundary in the
    // repository — see the migration for why workspace scope and not a per-owner column
    // (ledger P-11).
    workspaceId: text('workspace_id').notNull(),
    title: text('title'),
    flowTemplateId: text('flow_template_id'),
    // SQLite: text('created_at').notNull()
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('conversations_created_at_idx').on(t.createdAt),
    index('conversations_workspace_updated_at_idx').on(t.workspaceId, t.updatedAt),
  ],
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
    // Inherited from the conversation and kept alongside it.
    //
    // A message cannot exist without its conversation — the foreign key says so, and
    // cascades — so a denormalized copy of the workspace is a second value that can
    // disagree rather than a second way to read the same one. It is here so the
    // workspace-scoped query is a single index scan, and the migration fills it from the
    // parent rather than from anything a caller supplied (ledger P-11).
    workspaceId: text('workspace_id').notNull(),
    // SQLite: text('role', { enum: ['user', 'assistant', 'system', 'tool'] })
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    content: text('content').notNull(),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    // SQLite: text('metadata') // JSON
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('messages_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
    index('messages_workspace_conversation_created_idx').on(
      t.workspaceId,
      t.conversationId,
      t.createdAt,
    ),
  ],
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
export const connectorConfigs = pgTable(
  'connector_configs',
  {
    id: text('id').primaryKey(),
    // Was `UNIQUE` on its own, so one settings row served the whole installation and a
    // second tenant's configuration overwrote the first's. Now scoped to the workspace by
    // `0020_connector_credentials_tenant.sql` (ledger P-7).
    connectorName: text('connector_name').notNull(),
    workspaceId: text('workspace_id').notNull(),
    // SQLite: integer('enabled', { mode: 'boolean' })
    enabled: boolean('enabled').default(false),
    credentialRef: text('credential_ref'),
    // SQLite: text('settings') // JSON
    settings: jsonb('settings'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('connector_configs_workspace_connector_idx').on(t.workspaceId, t.connectorName),
  ],
);

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
