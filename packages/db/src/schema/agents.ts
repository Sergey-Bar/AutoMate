import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { projects, workspaces } from './dashboard.js';

// ─── Agent quality ─────────────────────────────────────────────────────────
//
// Five tables, added in `0040_agent_quality.sql`, each hard-scoped from its first migration:
// `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and every index leading with it.
// `ON DELETE CASCADE` on the project, as the health tables have.
//
// **Content is not stored by default.** An eval case keeps its prompt text only under the
// project's `agents.storePrompts`; a span keeps its (redacted, capped) content only under
// `agents.storeTraceContent`. The installation's own chat spans never keep content.

/** One eval run: an upload through the health door, or a run of the built-in eval runner. */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sequence: integer('sequence').notNull().generatedAlwaysAsIdentity(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    commitSha: text('commit_sha'),
    suite: text('suite').notNull(),
    format: text('format').notNull(),
    source: text('source').notNull(),
    toolName: text('tool_name').notNull(),
    toolVersion: text('tool_version'),
    model: text('model'),
    provider: text('provider'),
    configHash: text('config_hash').notNull(),
    totals: jsonb('totals').$type<Record<string, unknown>>().notNull().default({}),
    truncated: boolean('truncated').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('eval_runs_latest_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.suite,
      table.sequence,
    ),
    index('eval_runs_recent_idx').on(table.workspaceId, table.projectId, table.sequence),
    check('eval_runs_source_check', sql`${table.source} IN ('ci', 'runner', 'manual')`),
    check(
      'eval_runs_format_check',
      sql`${table.format} IN ('promptfoo-json', 'deepeval-json', 'inspect-eval-json', 'automate-eval-json')`,
    ),
  ],
);

/** One case of an eval run, with its attempts. */
export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    caseId: text('case_id').notNull(),
    label: text('label').notNull(),
    promptHash: text('prompt_hash'),
    /** Only under the project's `agents.storePrompts`. */
    prompt: text('prompt'),
    attempts: jsonb('attempts').$type<unknown[]>().notNull().default([]),
  },
  (table) => [
    index('eval_cases_run_idx').on(table.workspaceId, table.runId, table.position),
    check('eval_cases_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * One GenAI span. `source = 'otlp'` is a project's exporter; `source = 'self'` is the
 * installation's own chat completions, which belong to no project but are still in the
 * installation's workspace. `expires_at` is decided on write from the retention policy.
 */
export const genaiSpans = pgTable(
  'genai_spans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    traceId: text('trace_id').notNull(),
    spanId: text('span_id').notNull(),
    parentSpanId: text('parent_span_id'),
    operation: text('operation').notNull(),
    provider: text('provider'),
    requestModel: text('request_model'),
    responseModel: text('response_model'),
    agentName: text('agent_name'),
    toolName: text('tool_name'),
    toolArgsHash: text('tool_args_hash'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: real('duration_ms').notNull(),
    status: text('status').notNull(),
    errorType: text('error_type'),
    serviceName: text('service_name'),
    /** Only under the project's `agents.storeTraceContent`; redacted and capped. */
    content: jsonb('content').$type<{ input: string | null; output: string | null }>(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('genai_spans_span_idx').on(
      table.workspaceId,
      table.projectId,
      table.traceId,
      table.spanId,
    ),
    index('genai_spans_window_idx').on(table.workspaceId, table.projectId, table.startedAt),
    index('genai_spans_expiry_idx').on(table.workspaceId, table.expiresAt),
    check('genai_spans_source_check', sql`${table.source} IN ('otlp', 'self')`),
    check('genai_spans_status_check', sql`${table.status} IN ('ok', 'error', 'unset')`),
    check(
      'genai_spans_project_check',
      sql`(${table.source} = 'self') = (${table.projectId} IS NULL)`,
    ),
    check(
      'genai_spans_counts_check',
      sql`${table.durationMs} >= 0 AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)`,
    ),
  ],
);

/** A project branch's MCP server inventory, replaced by every agent-config scan. */
export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    name: text('name').notNull(),
    configPath: text('config_path').notNull(),
    transport: text('transport').notNull(),
    command: text('command'),
    package: text('package'),
    version: text('version'),
    pinned: boolean('pinned').notNull().default(false),
    url: text('url'),
    /** Environment variable names. Never a value. */
    envKeys: jsonb('env_keys').$type<string[]>().notNull().default([]),
    commitSha: text('commit_sha'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mcp_servers_project_idx').on(table.workspaceId, table.projectId, table.branch),
    check(
      'mcp_servers_transport_check',
      sql`${table.transport} IN ('stdio', 'http', 'sse', 'unknown')`,
    ),
  ],
);

/** A built-in eval runner dataset: cases with deterministic checks, one per (project, name). */
export const evalDatasets = pgTable(
  'eval_datasets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    model: text('model').notNull(),
    repeats: integer('repeats').notNull().default(3),
    judge: jsonb('judge').$type<{ model: string; rubric: string }>(),
    cases: jsonb('cases').$type<unknown[]>().notNull().default([]),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('eval_datasets_name_idx').on(table.workspaceId, table.projectId, table.name),
    check('eval_datasets_repeats_check', sql`${table.repeats} >= 1 AND ${table.repeats} <= 20`),
  ],
);

export type EvalRunRow = InferSelectModel<typeof evalRuns>;
export type EvalCaseRow = InferSelectModel<typeof evalCases>;
export type GenAiSpanRow = InferSelectModel<typeof genaiSpans>;
export type McpServerRow = InferSelectModel<typeof mcpServers>;
export type EvalDatasetRow = InferSelectModel<typeof evalDatasets>;
