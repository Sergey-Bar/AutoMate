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
  uuid,
  serial,
  real,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const RUN_PHASES = [
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
  'complete',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
  'partial',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const RUN_OUTCOMES = [
  'passed',
  'failed',
  'unknown',
  'partial',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number] | null;

export type RunSelection =
  | string[]
  | {
      testIds: string[];
      paths: string[];
      tags: string[];
    };

export const RUNNER_HEALTH_VALUES = [
  'healthy',
  'degraded',
  'draining',
  'offline',
  'revoked',
] as const;
export type RunnerHealth = (typeof RUNNER_HEALTH_VALUES)[number];

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  configPath: text('config_path').notNull(),
  testResultsDir: text('test_results_dir'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const runners = pgTable(
  'runners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    protocolVersion: text('protocol_version').notNull().default('1'),
    os: text('os').notNull(),
    arch: text('arch').notNull(),
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    slots: integer('slots').notNull().default(1),
    health: text('health', { enum: RUNNER_HEALTH_VALUES }).notNull().default('offline'),
    tokenHash: text('token_hash').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_workspace_name_unique').on(table.workspaceId, table.name),
    uniqueIndex('runners_token_hash_unique').on(table.tokenHash),
    index('runners_workspace_health_idx').on(table.workspaceId, table.health),
    index('runners_heartbeat_idx').on(table.lastHeartbeatAt),
    check('runners_slots_check', sql`${table.slots} > 0`),
    check(
      'runners_health_check',
      sql`${table.health} in ('healthy', 'degraded', 'draining', 'offline', 'revoked')`,
    ),
  ],
);

// ─── runs ──────────────────────────────────────────────────────────────────
// Source: runs table — core run record
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status', {
      enum: ['running', 'passed', 'failed', 'interrupted'],
    })
      .notNull()
      .default('running'),
    phase: text('phase', { enum: RUN_PHASES }).notNull().default('queued'),
    outcome: text('outcome', { enum: RUN_OUTCOMES }),
    attempt: integer('attempt').notNull().default(1),
    priority: integer('priority').notNull().default(0),
    total: integer('total').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    flaky: integer('flaky').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    blocked: integer('blocked').notNull().default(0),
    unknown: integer('unknown').notNull().default(0),
    durationMs: integer('duration_ms'),
    branch: text('branch'),
    commit: text('commit'),
    commitSha: text('commit_sha'),
    commitMessage: text('commit_message'),
    triggeredBy: text('triggered_by').default('manual'),
    config: jsonb('config'),
    configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull().default({}),
    rawArgs: text('raw_args'),
    source: text('source').notNull().default('live'),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>(),
    framework: text('framework'),
    adapterVersion: text('adapter_version'),
    testType: text('test_type'),
    projectId: uuid('project_id'),
    environmentId: uuid('environment_id'),
    releaseId: uuid('release_id'),
    suite: text('suite'),
    selection: jsonb('selection').$type<RunSelection>().notNull().default([]),
    requiredCapabilities: jsonb('required_capabilities')
      .$type<string[]>()
      .notNull()
      .default([]),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    timeoutMs: integer('timeout_ms'),
    policyId: uuid('policy_id'),
    idempotencyKey: text('idempotency_key'),
    retryOfRunId: uuid('retry_of_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    runnerId: uuid('runner_id').references(() => runners.id, { onDelete: 'set null' }),
    currentJobId: uuid('current_job_id'),
    eventSequence: integer('event_sequence').notNull().default(0),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelRequestedBy: text('cancel_requested_by'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorDetails: jsonb('error_details').$type<Record<string, unknown>>(),
    rawEvidenceRefs: jsonb('raw_evidence_refs').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    gateStatus: text('gate_status', { enum: ['passed', 'failed', 'skipped'] }),
    workspaceId: text('workspace_id'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    prNumber: integer('pr_number'),
    prBranch: text('pr_branch'),
    baseBranch: text('base_branch'),
    commitAuthor: text('commit_author'),
  },
  (t) => [
    uniqueIndex('runs_workspace_external_source_unique').on(
      t.workspaceId,
      t.source,
      t.externalId,
    ),
    uniqueIndex('runs_workspace_idempotency_unique').on(t.workspaceId, t.idempotencyKey),
    index('runs_started_at_idx').on(t.startedAt),
    index('runs_finished_at_idx').on(t.finishedAt),
    index('runs_workspace_id_idx').on(t.workspaceId),
    index('runs_branch_idx').on(t.branch),
    index('runs_status_idx').on(t.status),
    index('runs_phase_outcome_idx').on(t.workspaceId, t.phase, t.outcome),
    index('runs_project_created_idx').on(t.projectId, t.startedAt),
    index('runs_environment_created_idx').on(t.environmentId, t.startedAt),
    index('runs_release_created_idx').on(t.releaseId, t.startedAt),
    index('runs_runner_idx').on(t.runnerId),
    index('runs_current_job_idx').on(t.currentJobId),
    index('runs_retry_of_idx').on(t.retryOfRunId),
    index('runs_pr_number_idx').on(t.prNumber),
    index('runs_commit_idx').on(t.commit),
    index('runs_commit_sha_idx').on(t.commitSha),
    check(
      'runs_phase_check',
      sql`${t.phase} in ('queued', 'assigned', 'preparing', 'running', 'collecting', 'normalizing', 'analyzing', 'gate_evaluation', 'complete', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked', 'partial')`,
    ),
    check(
      'runs_outcome_check',
      sql`${t.outcome} is null or ${t.outcome} in ('passed', 'failed', 'unknown', 'partial', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked')`,
    ),
    check(
      'runs_phase_outcome_check',
      sql`(${t.phase} in ('complete', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked', 'partial')) = (${t.outcome} is not null)`,
    ),
    check('runs_attempt_check', sql`${t.attempt} > 0`),
    check('runs_event_sequence_check', sql`${t.eventSequence} >= 0`),
    check('runs_timeout_check', sql`${t.timeoutMs} is null or ${t.timeoutMs} > 0`),
    check(
      'runs_summary_check',
      sql`${t.total} >= 0 and ${t.passed} >= 0 and ${t.failed} >= 0 and ${t.flaky} >= 0 and ${t.skipped} >= 0 and ${t.blocked} >= 0 and ${t.unknown} >= 0`,
    ),
  ],
);

export const canonicalRunResults = pgTable(
  'canonical_run_results',
  {
    workspaceId: text('workspace_id').notNull(),
    runId: text('run_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.runId] }),
    index('canonical_run_results_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
);

// ─── suites ────────────────────────────────────────────────────────────────
// Source: suites table — test suite hierarchy
export const suites = pgTable('suites', {
  // SQLite: text('id').primaryKey()
  id: text('id').primaryKey(),
  // SQLite: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' })
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  file: text('file'),
  project: text('project'),
});

// ─── tests ─────────────────────────────────────────────────────────────────
// Source: tests table — individual test instances per run (composite PK)
export const tests = pgTable('tests', {
  // SQLite: text('id').notNull() // Playwright testId (composite PK)
  id: text('id').notNull(),
  // SQLite: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' })
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  suiteId: text('suite_id').references(() => suites.id),
  title: text('title').notNull(),
  file: text('file').notNull(),
  line: integer('line'),
  column: integer('column'),
  stableId: text('stable_id'),
  status: text('status', {
    enum: ['passed', 'failed', 'flaky', 'skipped', 'timedOut', 'timed_out', 'running', 'queued', 'blocked', 'cancelled', 'unknown'],
  })
    .notNull()
    .default('queued'),
  durationMs: integer('duration_ms'),
  // SQLite: text('tags') // JSON array
  tags: jsonb('tags'),
  // SQLite: text('annotations') // JSON array
  annotations: jsonb('annotations'),
  retryCount: integer('retry_count').default(0),
  expectedStatus: text('expected_status'),
  workerIndex: integer('worker_index'),
}, (t) => [
  // SQLite: primaryKey({ columns: [t.id, t.runId] })
  primaryKey({ columns: [t.id, t.runId] }),
  index('tests_run_id_idx').on(t.runId),
  index('tests_stable_id_idx').on(t.stableId),
]);

// ─── results ───────────────────────────────────────────────────────────────
// Source: results table — per-retry execution result
export const results = pgTable('results', {
  // SQLite: text('id').primaryKey()
  id: text('id').primaryKey(),
  testId: text('test_id').notNull(),
  // SQLite: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' })
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  retry: integer('retry').notNull().default(0),
  status: text('status', {
    enum: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'],
  }).notNull(),
  durationMs: integer('duration_ms'),
  // SQLite: text('started_at')
  startedAt: timestamp('started_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  workerIndex: integer('worker_index'),
  parallelIndex: integer('parallel_index'),
  // SQLite: text('stdout') // JSON
  stdout: jsonb('stdout'),
  // SQLite: text('stderr') // JSON
  stderr: jsonb('stderr'),
  // SQLite: text('steps') // JSON tree
  steps: jsonb('steps'),
  // SQLite: text('attachments') // JSON array
  attachments: jsonb('attachments'),
  fingerprint: text('fingerprint'),
}, (t) => [
  index('results_run_id_idx').on(t.runId),
  index('results_test_id_idx').on(t.testId),
  index('results_fingerprint_idx').on(t.fingerprint),
  index('results_run_id_test_id_retry_idx').on(t.runId, t.testId, t.retry),
]);

// ─── attachments ───────────────────────────────────────────────────────────
// Source: attachments table — binary artifacts on disk
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  resultId: text('result_id')
    .notNull()
    .references(() => results.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes'),
  thumbnailPath: text('thumbnail_path'),
  // SQLite: integer('is_screenshot_diff', { mode: 'boolean' })
  isScreenshotDiff: boolean('is_screenshot_diff').default(false),
});

// ─── trends ────────────────────────────────────────────────────────────────
// Source: trends table — daily aggregates for analytics charts (composite PK)
export const trends = pgTable('trends', {
  date: text('date').notNull(),
  project: text('project').notNull(),
  branch: text('branch').notNull().default('main'),
  total: integer('total').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  // SQLite: real('avg_duration_ms')
  avgDurationMs: real('avg_duration_ms'),
  p95DurationMs: real('p95_duration_ms'),
}, (t) => [
  primaryKey({ columns: [t.date, t.project, t.branch] }),
]);

// ─── quarantine ────────────────────────────────────────────────────────────
// Source: quarantine table — quarantined flaky tests
export const quarantine = pgTable('quarantine', {
  id: text('id').primaryKey(),
  testTitle: text('test_title').notNull(),
  testFile: text('test_file').notNull(),
  reason: text('reason'),
  // SQLite: text('quarantined_at').notNull()
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }).notNull(),
  quarantinedBy: text('quarantined_by').default('manual'),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('approved'),
  flakinessCategory: text('flakiness_category'),
  // SQLite: real('category_confidence')
  categoryConfidence: real('category_confidence'),
  // SQLite: text('category_evidence') // JSON string of string[]
  categoryEvidence: jsonb('category_evidence'),
  // SQLite: text('resolved_at')
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionType: text('resolution_type'),
  ttfMs: integer('ttf_ms'),
});

// ─── known failures ────────────────────────────────────────────────────────
// Source: known_failures table — known-failure registry
export const knownFailures = pgTable('known_failures', {
  id: text('id').primaryKey(),
  testTitle: text('test_title').notNull(),
  testFile: text('test_file').notNull(),
  comment: text('comment'),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').default('manual'),
});

// ─── schedules ─────────────────────────────────────────────────────────────
// Source: schedules table — cron-based scheduled runs
export const schedules = pgTable('schedules', {
  id: text('id').primaryKey(),
  cronExpr: text('cron_expr').notNull(),
  // SQLite: text('run_options') // JSON
  runOptions: jsonb('run_options'),
  // SQLite: integer('enabled', { mode: 'boolean' })
  enabled: boolean('enabled').default(true),
  // SQLite: text('last_run_at')
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ─── quality gate config ───────────────────────────────────────────────────
// Source: quality_gate_config table — global + per-workspace quality gate thresholds
export const qualityGateConfig = pgTable('quality_gate_config', {
  id: text('id').primaryKey().default('global'),
  workspaceId: text('workspace_id'),
  // SQLite: real('pass_rate_threshold').notNull().default(100)
  passRateThreshold: real('pass_rate_threshold').notNull().default(100),
  maxDurationMs: integer('max_duration_ms'),
  maxFlakyCount: integer('max_flaky_count'),
  maxQuarantinePercent: real('max_quarantine_percent'),
  // SQLite: text('updated_at').notNull()
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── defect categories ─────────────────────────────────────────────────────
// Source: defect_categories table — named defect categories
export const defectCategories = pgTable('defect_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull().default('#6b7280'),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// Source: fingerprint_categories table — maps error fingerprint to category
export const fingerprintCategories = pgTable('fingerprint_categories', {
  fingerprint: text('fingerprint').primaryKey(),
  categoryId: text('category_id')
    .notNull()
    .references(() => defectCategories.id, { onDelete: 'cascade' }),
  // SQLite: text('assigned_at').notNull()
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
});

// ─── blob shards ──────────────────────────────────────────────────────────
// Source: blob_shards table — partial blob shard upload tracking
export const blobShards = pgTable('blob_shards', {
  id: text('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  shardIndex: integer('shard_index').notNull(),
  totalShards: integer('total_shards').notNull(),
  filePath: text('file_path').notNull(),
  // SQLite: text('uploaded_at').notNull()
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
  // SQLite: integer('merged', { mode: 'boolean' })
  merged: boolean('merged').default(false),
});

// ─── NL query history ────────────────────────────────────────────────────
// Source: nl_query_history table — NL→SQL query history
export const nlQueryHistory = pgTable('nl_query_history', {
  // SQLite: integer('id').primaryKey({ autoIncrement: true })
  id: serial('id').primaryKey(),
  userQuery: text('user_query').notNull(),
  generatedSql: text('generated_sql').notNull(),
  resultCount: integer('result_count'),
  userId: text('user_id'),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ─── failure taxonomy rules ────────────────────────────────────────────────
// Source: failure_taxonomy_rules table — rule-based failure classifier config
export const failureTaxonomyRules = pgTable('failure_taxonomy_rules', {
  id: text('id').primaryKey(),
  priority: integer('priority').notNull(),
  category: text('category', {
    enum: ['infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'],
  }).notNull(),
  pattern: text('pattern').notNull(),
  patternTarget: text('pattern_target', {
    enum: ['error_message', 'error_stack', 'test_title', 'file_path'],
  }).notNull(),
  description: text('description').notNull(),
  // SQLite: integer('is_built_in', { mode: 'boolean' })
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  // SQLite: integer('enabled', { mode: 'boolean' })
  enabled: boolean('enabled').notNull().default(true),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── failure classifications ───────────────────────────────────────────────
// Source: failure_classifications table — per-run failure classifications
export const failureClassifications = pgTable('failure_classifications', {
  id: text('id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  category: text('category', {
    enum: ['infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'],
  }).notNull(),
  // SQLite: real('confidence').notNull()
  confidence: real('confidence').notNull(),
  matchedRuleId: text('matched_rule_id').references(() => failureTaxonomyRules.id, {
    onDelete: 'cascade',
  }),
  rationale: text('rationale').notNull(),
  // SQLite: integer('is_manual_override', { mode: 'boolean' })
  isManualOverride: boolean('is_manual_override').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('failure_classifications_fingerprint_run_unique').on(t.fingerprint, t.runId),
]);

// ─── test failure correlations ─────────────────────────────────────────────
// Source: test_failure_correlations table — source-file ↔ test failure correlation window
export const testFailureCorrelations = pgTable('test_failure_correlations', {
  id: text('id').primaryKey(),
  testStableId: text('test_stable_id').notNull(),
  sourceFilePath: text('source_file_path').notNull(),
  failureCount: integer('failure_count').notNull().default(0),
  totalOccurrences: integer('total_occurrences').notNull().default(0),
  lastUpdatedRunId: uuid('last_updated_run_id').references(() => runs.id, { onDelete: 'cascade' }),
  // SQLite: text('window_start_date').notNull()
  windowStartDate: timestamp('window_start_date', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('test_failure_correlations_test_file_unique').on(t.testStableId, t.sourceFilePath),
]);

// ─── locator suggestions ───────────────────────────────────────────────────
// Source: locator_suggestions table — self-healing locator suggestions
export const locatorSuggestions = pgTable('locator_suggestions', {
  id: text('id').primaryKey(),
  testId: text('test_id').notNull(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  originalSelector: text('original_selector').notNull(),
  suggestedSelector: text('suggested_selector').notNull(),
  // SQLite: real('confidence').notNull()
  confidence: real('confidence').notNull(),
  rationale: text('rationale').notNull(),
  status: text('status', {
    enum: ['pending', 'accepted', 'rejected', 'expired'],
  })
    .notNull()
    .default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ─── failure_clusters ─────────────────────────────────────────────────────────
// Source: failure_clusters table — cross-run error cluster groups
export const failureClusters = pgTable('failure_clusters', {
  id: text('id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  clusterLabel: text('cluster_label').notNull(),
  firstSeenRunId: uuid('first_seen_run_id'),
  lastSeenRunId: uuid('last_seen_run_id'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  representativeError: text('representative_error').notNull(),
  category: text('category'),
  status: text('status', { enum: ['active', 'resolved'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('failure_clusters_fingerprint_idx').on(t.fingerprint),
  index('failure_clusters_status_idx').on(t.status),
]);

// ─── users ────────────────────────────────────────────────────────────────────
// Source: users table — user accounts
export const users = pgTable('users', {
  // SQLite: text('id').primaryKey() // UUID
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull().default('viewer'),
  samlSubject: text('saml_subject'),
  tenantId: text('tenant_id'),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('users_email_unique').on(t.email),
]);

// ─── roles ────────────────────────────────────────────────────────────────────
// Source: roles table — RBAC roles
export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
  description: text('description').notNull(),
  // SQLite: text('permissions').notNull() // JSON array of allowed actions
  permissions: jsonb('permissions').notNull(),
  tenantId: text('tenant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('roles_name_unique').on(t.name),
]);

// ─── api_keys ─────────────────────────────────────────────────────────────────
// Source: api_keys table — API access tokens (hashed)
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  role: text('role', { enum: ['admin', 'editor', 'viewer', 'service'] }).notNull().default('admin'),
  // SQLite: text('scopes') // JSON array
  scopes: jsonb('scopes'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  tenantId: text('tenant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('api_keys_key_hash_unique').on(t.keyHash),
  index('api_keys_user_id_idx').on(t.userId),
]);

// ─── agent_sessions ───────────────────────────────────────────────────────────
// Source: agent_sessions table — AI agent code-review sessions
export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  repository: text('repository').notNull(),
  prNumber: integer('pr_number').notNull(),
  prBranch: text('pr_branch').notNull(),
  baseBranch: text('base_branch'),
  prTitle: text('pr_title'),
  prAuthor: text('pr_author'),
  agentName: text('agent_name').notNull(),
  matchedRule: text('matched_rule'),
  status: text('status', { enum: ['active', 'closed', 'error'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  filesLastSyncedAt: timestamp('files_last_synced_at', { withTimezone: true }),
  fileSyncStatus: text('file_sync_status', { enum: ['pending', 'synced', 'failed'] }),
}, (t) => [
  index('agent_sessions_pr_number_repository_idx').on(t.prNumber, t.repository),
  index('agent_sessions_status_idx').on(t.status),
  index('agent_sessions_pr_branch_idx').on(t.prBranch),
]);

// ─── agent_session_runs ───────────────────────────────────────────────────────
// Source: agent_session_runs table — links agent sessions to test runs (composite PK)
export const agentSessionRuns = pgTable('agent_session_runs', {
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.runId] }),
  index('agent_session_runs_session_id_idx').on(t.sessionId),
  index('agent_session_runs_run_id_idx').on(t.runId),
]);

// ─── agent_session_files ──────────────────────────────────────────────────────
// Source: agent_session_files table — files modified in agent session
export const agentSessionFiles = pgTable('agent_session_files', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  changeType: text('change_type', { enum: ['added', 'modified', 'removed', 'renamed'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('agent_session_files_session_id_file_path_unique').on(t.sessionId, t.filePath),
  index('agent_session_files_session_id_idx').on(t.sessionId),
]);

// ─── generated_test_suggestions ───────────────────────────────────────────────
// Source: generated_test_suggestions table — AI-generated test code drafts
export const generatedTestSuggestions = pgTable('generated_test_suggestions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  sourceType: text('source_type', { enum: ['pr_diff', 'requirement', 'source'] }).notNull(),
  status: text('status', { enum: ['draft', 'accepted', 'rejected', 'edited'] }).notNull().default('draft'),
  originalContent: text('original_content').notNull(),
  editedContent: text('edited_content'),
  language: text('language'),
  framework: text('framework'),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),
  // SQLite: text('warnings')
  warnings: jsonb('warnings'),
  // SQLite: text('source_metadata')
  sourceMetadata: jsonb('source_metadata'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(new Date(0).toISOString() as unknown as Date),
}, (t) => [
  index('generated_test_suggestions_session_id_idx').on(t.sessionId),
  index('generated_test_suggestions_status_idx').on(t.status),
]);

// ─── repair_attempts ──────────────────────────────────────────────────────────
// Source: repair_attempts table — auto-repair attempt records
export const repairAttempts = pgTable('repair_attempts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status', {
    enum: ['payload_built', 'comment_posted', 'comment_failed', 'rerun_requested', 'escalated'],
  }).notNull(),
  // SQLite: text('payload')
  payload: jsonb('payload'),
  commentUrl: text('comment_url'),
  commentId: text('comment_id'),
  rerunRunId: text('rerun_run_id'),
  lastProcessedSha: text('last_processed_sha'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('repair_attempts_session_id_idx').on(t.sessionId),
  uniqueIndex('repair_attempts_session_id_attempt_number_unique').on(t.sessionId, t.attemptNumber),
]);

// ─── agent_conflicts ──────────────────────────────────────────────────────────
// Source: agent_conflicts table — concurrent agent conflict detection
export const agentConflicts = pgTable('agent_conflicts', {
  id: text('id').primaryKey(),
  repository: text('repository').notNull(),
  // SQLite: text('session_ids').notNull()
  sessionIds: jsonb('session_ids').notNull(),
  // SQLite: text('overlapping_files').notNull()
  overlappingFiles: jsonb('overlapping_files').notNull(),
  severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull().default('warning'),
  status: text('status', { enum: ['active', 'resolved'] }).notNull().default('active'),
  firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).notNull(),
  lastDetectedAt: timestamp('last_detected_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
}, (t) => [
  index('agent_conflicts_repository_idx').on(t.repository),
  index('agent_conflicts_status_idx').on(t.status),
]);

// ─── saml_config ──────────────────────────────────────────────────────────────
// Source: saml_config table — SAML SSO configuration
export const samlConfig = pgTable('saml_config', {
  id: text('id').primaryKey(),
  entryPoint: text('entry_point').notNull(),
  issuer: text('issuer').notNull(),
  idpCert: text('idp_cert').notNull(),
  callbackUrl: text('callback_url').notNull(),
  spPrivateKey: text('sp_private_key'),
  defaultRole: text('default_role', { enum: ['viewer', 'editor', 'admin'] }).notNull().default('viewer'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── audit_events ─────────────────────────────────────────────────────────────
// Source: audit_events table — immutable audit trail
export const auditEvents = pgTable('audit_events', {
  // SQLite: text('id').primaryKey() // UUID
  id: uuid('id').primaryKey().defaultRandom(),
  // SQLite: text('timestamp').notNull() // ISO-8601 UTC
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type', { enum: ['user', 'system', 'service'] }).notNull().default('user'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  // SQLite: text('details') // JSON blob
  details: jsonb('details'),
  tenantId: text('tenant_id'),
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('audit_events_actor_idx').on(t.actorId),
  index('audit_events_action_idx').on(t.action),
  index('audit_events_timestamp_idx').on(t.timestamp),
  index('audit_events_workspace_timestamp_idx').on(t.workspaceId, t.timestamp),
]);

// ─── Inferred types ───────────────────────────────────────────────────────────
export type Run = typeof runs.$inferSelect;
export type InsertRun = typeof runs.$inferInsert;
export type Suite = typeof suites.$inferSelect;
export type InsertSuite = typeof suites.$inferInsert;
export type Test = typeof tests.$inferSelect;
export type InsertTest = typeof tests.$inferInsert;
export type Result = typeof results.$inferSelect;
export type InsertResult = typeof results.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;
export type Trend = typeof trends.$inferSelect;
export type InsertTrend = typeof trends.$inferInsert;
export type Quarantine = typeof quarantine.$inferSelect;
export type InsertQuarantine = typeof quarantine.$inferInsert;
export type KnownFailure = typeof knownFailures.$inferSelect;
export type InsertKnownFailure = typeof knownFailures.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = typeof schedules.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;
export type Runner = typeof runners.$inferSelect;
export type InsertRunner = typeof runners.$inferInsert;
export type QualityGateConfig = typeof qualityGateConfig.$inferSelect;
export type InsertQualityGateConfig = typeof qualityGateConfig.$inferInsert;
export type DefectCategory = typeof defectCategories.$inferSelect;
export type InsertDefectCategory = typeof defectCategories.$inferInsert;
export type FingerprintCategory = typeof fingerprintCategories.$inferSelect;
export type InsertFingerprintCategory = typeof fingerprintCategories.$inferInsert;
export type BlobShard = typeof blobShards.$inferSelect;
export type InsertBlobShard = typeof blobShards.$inferInsert;
export type NlQueryHistory = typeof nlQueryHistory.$inferSelect;
export type InsertNlQueryHistory = typeof nlQueryHistory.$inferInsert;
export type FailureTaxonomyRule = typeof failureTaxonomyRules.$inferSelect;
export type InsertFailureTaxonomyRule = typeof failureTaxonomyRules.$inferInsert;
export type FailureClassification = typeof failureClassifications.$inferSelect;
export type InsertFailureClassification = typeof failureClassifications.$inferInsert;
export type TestFailureCorrelation = typeof testFailureCorrelations.$inferSelect;
export type InsertTestFailureCorrelation = typeof testFailureCorrelations.$inferInsert;
export type LocatorSuggestion = typeof locatorSuggestions.$inferSelect;
export type InsertLocatorSuggestion = typeof locatorSuggestions.$inferInsert;
export type FailureCluster = typeof failureClusters.$inferSelect;
export type InsertFailureCluster = typeof failureClusters.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type InsertAgentSession = typeof agentSessions.$inferInsert;
export type AgentSessionRun = typeof agentSessionRuns.$inferSelect;
export type InsertAgentSessionRun = typeof agentSessionRuns.$inferInsert;
export type AgentSessionFile = typeof agentSessionFiles.$inferSelect;
export type InsertAgentSessionFile = typeof agentSessionFiles.$inferInsert;
export type GeneratedTestSuggestion = typeof generatedTestSuggestions.$inferSelect;
export type InsertGeneratedTestSuggestion = typeof generatedTestSuggestions.$inferInsert;
export type RepairAttempt = typeof repairAttempts.$inferSelect;
export type InsertRepairAttempt = typeof repairAttempts.$inferInsert;
export type AgentConflict = typeof agentConflicts.$inferSelect;
export type InsertAgentConflict = typeof agentConflicts.$inferInsert;
export type SamlConfig = typeof samlConfig.$inferSelect;
export type InsertSamlConfig = typeof samlConfig.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;
