import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { results, runs, runners, workspaces } from './dashboard.js';

export const EXECUTION_JOB_STATES = [
  'queued',
  'leased',
  'completed',
  'failed',
  'cancelled',
  'requeued',
] as const;
export type ExecutionJobState = (typeof EXECUTION_JOB_STATES)[number];

export const ARTIFACT_KINDS = [
  'report',
  'junit',
  'json',
  'log',
  'stdout',
  'stderr',
  'screenshot',
  'video',
  'trace',
  'html',
  'attachment',
  'other',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const GATE_STATUSES = ['passed', 'failed', 'warning', 'unknown', 'not_evaluated'] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export const RELEASE_DECISIONS = ['ready', 'ready_with_warnings', 'blocked', 'unknown'] as const;
export type ReleaseDecision = (typeof RELEASE_DECISIONS)[number];

export const QUALITY_DOMAINS = [
  'browser',
  'api',
  'mobile',
  'performance',
  'security',
  'accessibility',
  'other',
] as const;
export type QualityDomain = (typeof QUALITY_DOMAINS)[number];

export const DOMAIN_STATUSES = [
  'passed',
  'failed',
  'warning',
  'unknown',
  'not_configured',
  'not_implemented',
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export type QualityPolicyRule = {
  domain: QualityDomain;
  required: boolean;
  minimumPassRate?: number;
  requiredArtifactKinds: ArtifactKind[];
};

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    defaultBranch: text('default_branch'),
    repositoryUrl: text('repository_url'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_workspace_slug_unique').on(table.workspaceId, table.slug),
    index('projects_workspace_idx').on(table.workspaceId),
  ],
);

export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind').notNull().default('browser'),
    baseUrl: text('base_url'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('environments_workspace_slug_unique').on(table.workspaceId, table.slug),
    index('environments_workspace_idx').on(table.workspaceId),
    index('environments_project_idx').on(table.projectId),
  ],
);

export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    branch: text('branch'),
    commitSha: text('commit_sha'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('releases_workspace_project_version_unique').on(
      table.workspaceId,
      table.projectId,
      table.version,
    ),
    index('releases_workspace_idx').on(table.workspaceId),
    index('releases_project_idx').on(table.projectId),
  ],
);

export const qualityPolicies = pgTable(
  'quality_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    hash: text('hash').notNull(),
    requiredDomains: jsonb('required_domains')
      .$type<QualityDomain[]>()
      .notNull()
      .default(['browser']),
    browserPassRateThreshold: real('browser_pass_rate_threshold').notNull().default(100),
    maxFlakyRate: real('max_flaky_rate').notNull().default(0),
    maxDurationMs: integer('max_duration_ms'),
    rules: jsonb('rules').$type<QualityPolicyRule[]>().notNull().default([]),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quality_policies_workspace_name_version_unique').on(
      table.workspaceId,
      table.name,
      table.version,
    ),
    uniqueIndex('quality_policies_workspace_default_unique')
      .on(table.workspaceId)
      .where(sql`${table.isDefault} = true`),
    index('quality_policies_workspace_idx').on(table.workspaceId),
    check('quality_policies_hash_check', sql`${table.hash} ~ '^[0-9a-f]{64}$'`),
    check(
      'quality_policies_browser_pass_rate_check',
      sql`${table.browserPassRateThreshold} >= 0 and ${table.browserPassRateThreshold} <= 100`,
    ),
    check(
      'quality_policies_flaky_rate_check',
      sql`${table.maxFlakyRate} >= 0 and ${table.maxFlakyRate} <= 100`,
    ),
    check(
      'quality_policies_duration_check',
      sql`${table.maxDurationMs} is null or ${table.maxDurationMs} >= 0`,
    ),
  ],
);

export const executionJobs = pgTable(
  'execution_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull().default(1),
    priority: integer('priority').notNull().default(0),
    state: text('state', { enum: EXECUTION_JOB_STATES }).notNull().default('queued'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    timeoutMs: integer('timeout_ms').notNull(),
    requiredCapabilities: jsonb('required_capabilities').$type<string[]>().notNull().default([]),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    spec: jsonb('spec').$type<Record<string, unknown>>().notNull().default({}),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    leaseId: text('lease_id'),
    leaseOwner: uuid('lease_owner').references(() => runners.id, { onDelete: 'restrict' }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    fencingToken: integer('fencing_token').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    completionHash: text('completion_hash'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('execution_jobs_run_attempt_unique').on(table.runId, table.attempt),
    uniqueIndex('execution_jobs_workspace_idempotency_unique').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index('execution_jobs_claim_idx').on(table.state, table.availableAt, table.priority),
    index('execution_jobs_lease_expiry_idx').on(table.state, table.leaseExpiresAt),
    index('execution_jobs_workspace_idx').on(table.workspaceId),
    check('execution_jobs_attempt_check', sql`${table.attempt} > 0`),
    check('execution_jobs_timeout_check', sql`${table.timeoutMs} > 0`),
    check(
      'execution_jobs_state_check',
      sql`${table.state} in ('queued', 'leased', 'completed', 'failed', 'cancelled', 'requeued')`,
    ),
    check('execution_jobs_fencing_token_check', sql`${table.fencingToken} >= 0`),
    check(
      'execution_jobs_lease_check',
      sql`${table.state} <> 'leased' or (${table.leaseId} is not null and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null and ${table.fencingToken} > 0)`,
    ),
  ],
);

export const runEvents = pgTable(
  'run_events',
  {
    eventId: text('event_id').notNull(),
    version: text('version').notNull().default('1'),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id').references(() => executionJobs.id, { onDelete: 'set null' }),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    eventKey: text('event_key').notNull(),
    hash: text('hash').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    leaseId: text('lease_id'),
    fencingToken: integer('fencing_token').notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.eventId] }),
    uniqueIndex('run_events_run_sequence_unique').on(table.runId, table.sequence),
    uniqueIndex('run_events_workspace_event_key_unique').on(table.workspaceId, table.eventKey),
    uniqueIndex('run_events_run_hash_unique').on(table.runId, table.hash),
    index('run_events_run_received_idx').on(table.runId, table.receivedAt),
    index('run_events_workspace_received_idx').on(table.workspaceId, table.receivedAt),
    check('run_events_sequence_check', sql`${table.sequence} > 0`),
    check('run_events_hash_check', sql`${table.hash} ~ '^[0-9a-f]{64}$'`),
    check('run_events_fencing_token_check', sql`${table.fencingToken} >= 0`),
  ],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legacyAttachmentId: text('legacy_attachment_id'),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => executionJobs.id, { onDelete: 'set null' }),
    testId: text('test_id'),
    resultId: text('result_id').references(() => results.id, { onDelete: 'set null' }),
    attempt: integer('attempt'),
    kind: text('kind', { enum: ARTIFACT_KINDS }).notNull().default('other'),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    storageKey: text('storage_key').notNull(),
    checksumAlgorithm: text('checksum_algorithm').notNull().default('sha256'),
    checksum: text('checksum'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    legalHold: boolean('legal_hold').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('artifacts_legacy_attachment_unique').on(table.legacyAttachmentId),
    index('artifacts_run_created_idx').on(table.runId, table.createdAt),
    index('artifacts_job_idx').on(table.jobId),
    index('artifacts_test_idx').on(table.testId),
    index('artifacts_result_idx').on(table.resultId),
    index('artifacts_expiry_idx').on(table.expiresAt),
    check(
      'artifacts_kind_check',
      sql`${table.kind} in ('report', 'junit', 'json', 'log', 'stdout', 'stderr', 'screenshot', 'video', 'trace', 'html', 'attachment', 'other')`,
    ),
    check('artifacts_attempt_check', sql`${table.attempt} is null or ${table.attempt} > 0`),
    check('artifacts_size_check', sql`${table.sizeBytes} is null or ${table.sizeBytes} >= 0`),
    check(
      'artifacts_evidence_check',
      sql`${table.legacyAttachmentId} is not null or (${table.checksumAlgorithm} = 'sha256' and ${table.checksum} is not null and ${table.checksum} ~ '^[0-9a-f]{64}$' and ${table.sizeBytes} is not null)`,
    ),
  ],
);

export const gateEvaluations = pgTable(
  'gate_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    releaseId: uuid('release_id').references(() => releases.id, { onDelete: 'set null' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => qualityPolicies.id, { onDelete: 'restrict' }),
    policyVersion: text('policy_version').notNull(),
    policyHash: text('policy_hash').notNull(),
    status: text('status', { enum: GATE_STATUSES }).notNull(),
    decision: text('decision', { enum: RELEASE_DECISIONS }).notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    domainStatuses: jsonb('domain_statuses').$type<Record<QualityDomain, DomainStatus>>().notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('gate_evaluations_run_policy_hash_unique').on(
      table.runId,
      table.policyId,
      table.policyHash,
    ),
    index('gate_evaluations_workspace_evaluated_idx').on(table.workspaceId, table.evaluatedAt),
    index('gate_evaluations_release_evaluated_idx').on(table.releaseId, table.evaluatedAt),
    check(
      'gate_evaluations_status_check',
      sql`${table.status} in ('passed', 'failed', 'warning', 'unknown', 'not_evaluated')`,
    ),
    check(
      'gate_evaluations_decision_check',
      sql`${table.decision} in ('ready', 'ready_with_warnings', 'blocked', 'unknown')`,
    ),
    check('gate_evaluations_policy_hash_check', sql`${table.policyHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type Environment = typeof environments.$inferSelect;
export type InsertEnvironment = typeof environments.$inferInsert;
export type Release = typeof releases.$inferSelect;
export type InsertRelease = typeof releases.$inferInsert;
export type QualityPolicy = typeof qualityPolicies.$inferSelect;
export type InsertQualityPolicy = typeof qualityPolicies.$inferInsert;
export type ExecutionJob = typeof executionJobs.$inferSelect;
export type InsertExecutionJob = typeof executionJobs.$inferInsert;
export type RunEvent = typeof runEvents.$inferSelect;
export type InsertRunEvent = typeof runEvents.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type InsertArtifact = typeof artifacts.$inferInsert;
export type GateEvaluation = typeof gateEvaluations.$inferSelect;
export type InsertGateEvaluation = typeof gateEvaluations.$inferInsert;
