import { pgTable, text, integer, real, primaryKey, uniqueIndex, index, boolean, serial } from 'drizzle-orm/pg-core';

// ─── runs ──────────────────────────────────────────────────────────────────
export const runs = pgTable('runs', {
  id: text('id').primaryKey(), // UUID
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status', {
    enum: ['running', 'passed', 'failed', 'interrupted'],
  })
    .notNull()
    .default('running'),
  total: integer('total').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  durationMs: integer('duration_ms'),
  branch: text('branch'),
  commitSha: text('commit_sha'),
  commitMessage: text('commit_message'),
  triggeredBy: text('triggered_by').default('manual'),
  config: text('config'), // JSON: projects, workers, retries, trace mode, grep, shard
  rawArgs: text('raw_args'),
  source: text('source', { enum: ['live', 'blob'] }).notNull().default('live'),
  gateStatus: text('gate_status', { enum: ['passed', 'failed', 'skipped'] }),
  workspaceId: text('workspace_id'),
  prNumber: integer('pr_number'),
  prBranch: text('pr_branch'),
  baseBranch: text('base_branch'),
  commitAuthor: text('commit_author'),
}, (t) => ({
  startedAtIdx: index('runs_started_at_idx').on(t.startedAt),
  finishedAtIdx: index('runs_finished_at_idx').on(t.finishedAt),
  workspaceIdIdx: index('runs_workspace_id_idx').on(t.workspaceId),
  branchIdx: index('runs_branch_idx').on(t.branch),
  statusIdx: index('runs_status_idx').on(t.status),
  prNumberIdx: index('runs_pr_number_idx').on(t.prNumber),
  commitShaIdx: index('runs_commit_sha_idx').on(t.commitSha),
}));

// ─── suites ────────────────────────────────────────────────────────────────
export const suites = pgTable('suites', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  file: text('file'),
  project: text('project'),
});

// ─── tests ─────────────────────────────────────────────────────────────────
export const tests = pgTable('tests', {
  id: text('id').notNull(), // Playwright testId
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  suiteId: text('suite_id').references(() => suites.id),
  title: text('title').notNull(),
  file: text('file').notNull(),
  line: integer('line'),
  column: integer('column'),
  stableId: text('stable_id'),
  status: text('status', {
    enum: ['passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued'],
  })
    .notNull()
    .default('queued'),
  durationMs: integer('duration_ms'),
  tags: text('tags'), // JSON array
  annotations: text('annotations'), // JSON array
  retryCount: integer('retry_count').default(0),
  expectedStatus: text('expected_status'),
  workerIndex: integer('worker_index'),
}, (t) => ({
  pk: primaryKey({ columns: [t.id, t.runId] }),
  runIdIdx: index('tests_run_id_idx').on(t.runId),
  stableIdIdx: index('tests_stable_id_idx').on(t.stableId),
}));

// ─── results ───────────────────────────────────────────────────────────────
export const results = pgTable('results', {
  id: text('id').primaryKey(),
  testId: text('test_id').notNull(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  retry: integer('retry').notNull().default(0),
  status: text('status', {
    enum: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'],
  }).notNull(),
  durationMs: integer('duration_ms'),
  startedAt: text('started_at'),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  workerIndex: integer('worker_index'),
  parallelIndex: integer('parallel_index'),
  stdout: text('stdout'), // JSON
  stderr: text('stderr'), // JSON
  steps: text('steps'), // JSON tree
  attachments: text('attachments'), // JSON array
  fingerprint: text('fingerprint'), // normalized error hash (12-char hex)
}, (t) => ({
  runIdIdx: index('results_run_id_idx').on(t.runId),
  testIdIdx: index('results_test_id_idx').on(t.testId),
  fingerprintIdx: index('results_fingerprint_idx').on(t.fingerprint),
  runTestRetryIdx: index('results_run_id_test_id_retry_idx').on(t.runId, t.testId, t.retry),
}));

// ─── attachments ───────────────────────────────────────────────────────────
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
  isScreenshotDiff: boolean('is_screenshot_diff').default(false),
});

// ─── trends ────────────────────────────────────────────────────────────────
export const trends = pgTable('trends', {
  date: text('date').notNull(),
  project: text('project').notNull(),
  branch: text('branch').notNull().default('main'),
  total: integer('total').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  avgDurationMs: real('avg_duration_ms'),
  p95DurationMs: real('p95_duration_ms'),
}, (t) => ({
  pk: primaryKey({ columns: [t.date, t.project, t.branch] }),
}));

// ─── quarantine ────────────────────────────────────────────────────────────
export const quarantine = pgTable('quarantine', {
  id: text('id').primaryKey(),
  testTitle: text('test_title').notNull(),
  testFile: text('test_file').notNull(),
  reason: text('reason'),
  quarantinedAt: text('quarantined_at').notNull(),
  quarantinedBy: text('quarantined_by').default('manual'),
  // T13: approval workflow — 'pending' requires editor approval before taking effect
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('approved'),
  // Phase 1A: flakiness classification
  flakinessCategory: text('flakiness_category'),
  categoryConfidence: real('category_confidence'),
  categoryEvidence: text('category_evidence'), // JSON string of string[]
  // Phase 1B columns (logic implemented in 1B; columns added now for migration completeness)
  resolvedAt: text('resolved_at'),
  resolutionType: text('resolution_type'),
  ttfMs: integer('ttf_ms'),
});

// ─── known failures ────────────────────────────────────────────────────────
export const knownFailures = pgTable('known_failures', {
  id: text('id').primaryKey(),
  testTitle: text('test_title').notNull(),
  testFile: text('test_file').notNull(),
  comment: text('comment'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').default('manual'),
});

// ─── schedules ─────────────────────────────────────────────────────────────
export const schedules = pgTable('schedules', {
  id: text('id').primaryKey(),
  cronExpr: text('cron_expr').notNull(),
  runOptions: text('run_options'), // JSON
  enabled: boolean('enabled').default(true),
  lastRunAt: text('last_run_at'),
  createdAt: text('created_at').notNull(),
});

// ─── workspaces ────────────────────────────────────────────────────────────
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  configPath: text('config_path').notNull(),
  testResultsDir: text('test_results_dir'),
  createdAt: text('created_at').notNull(),
});

// ─── quality gate config ───────────────────────────────────────────────────
export const qualityGateConfig = pgTable('quality_gate_config', {
  id: text('id').primaryKey().default('global'),
  workspaceId: text('workspace_id'),                          // null = global config
  passRateThreshold: real('pass_rate_threshold').notNull().default(100),
  maxDurationMs: integer('max_duration_ms'),
  maxFlakyCount: integer('max_flaky_count'),
  maxQuarantinePercent: real('max_quarantine_percent'),       // anti-gaming guardrail
  updatedAt: text('updated_at').notNull(),
});

// ─── defect categories ─────────────────────────────────────────────────────
export const defectCategories = pgTable('defect_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull().default('#6b7280'), // CSS hex color
  createdAt: text('created_at').notNull(),
});

// Maps a fingerprint (12-char hex) to a defect category
export const fingerprintCategories = pgTable('fingerprint_categories', {
  fingerprint: text('fingerprint').primaryKey(),
  categoryId: text('category_id')
    .notNull()
    .references(() => defectCategories.id, { onDelete: 'cascade' }),
  assignedAt: text('assigned_at').notNull(),
});

// ─── blob shards ──────────────────────────────────────────────────────────
export const blobShards = pgTable('blob_shards', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  shardIndex: integer('shard_index').notNull(),
  totalShards: integer('total_shards').notNull(),
  filePath: text('file_path').notNull(), // path where blob zip is stored
  uploadedAt: text('uploaded_at').notNull(),
  merged: boolean('merged').default(false),
});

// ─── NL query history ────────────────────────────────────────────────────
export const nlQueryHistory = pgTable('nl_query_history', {
  id: serial('id').primaryKey(),
  userQuery: text('user_query').notNull(),
  generatedSql: text('generated_sql').notNull(),
  resultCount: integer('result_count'),
  userId: text('user_id'),
  createdAt: text('created_at').notNull(),
});

// ─── failure taxonomy rules ────────────────────────────────────────────────
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
  isBuiltIn: integer('is_built_in').notNull().default(false),
  enabled: integer('enabled').notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── failure classifications ───────────────────────────────────────────────
export const failureClassifications = pgTable('failure_classifications', {
  id: text('id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  category: text('category', {
    enum: ['infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'],
  }).notNull(),
  confidence: real('confidence').notNull(),
  matchedRuleId: text('matched_rule_id').references(() => failureTaxonomyRules.id, {
    onDelete: 'cascade',
  }),
  rationale: text('rationale').notNull(),
  isManualOverride: integer('is_manual_override').notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  fingerprintRunUnique: uniqueIndex('failure_classifications_fingerprint_run_unique').on(
    t.fingerprint,
    t.runId,
  ),
}));

// ─── test failure correlations ─────────────────────────────────────────────
export const testFailureCorrelations = pgTable('test_failure_correlations', {
  id: text('id').primaryKey(),
  testStableId: text('test_stable_id').notNull(),
  sourceFilePath: text('source_file_path').notNull(),
  failureCount: integer('failure_count').notNull().default(0),
  totalOccurrences: integer('total_occurrences').notNull().default(0),
  lastUpdatedRunId: text('last_updated_run_id').references(() => runs.id, { onDelete: 'cascade' }),
  windowStartDate: text('window_start_date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  testFileUnique: uniqueIndex('test_failure_correlations_test_file_unique').on(
    t.testStableId,
    t.sourceFilePath,
  ),
}));

// ─── locator suggestions ───────────────────────────────────────────────────
export const locatorSuggestions = pgTable('locator_suggestions', {
  id: text('id').primaryKey(),
  testId: text('test_id').notNull(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  originalSelector: text('original_selector').notNull(),
  suggestedSelector: text('suggested_selector').notNull(),
  confidence: real('confidence').notNull(),
  rationale: text('rationale').notNull(),
  status: text('status', {
    enum: ['pending', 'accepted', 'rejected', 'expired'],
  })
    .notNull()
    .default('pending'),
  createdAt: text('created_at').notNull(),
});

// ─── failure_clusters ─────────────────────────────────────────────────────────
export const failureClusters = pgTable('failure_clusters', {
  id: text('id').primaryKey(),
  fingerprint: text('fingerprint').notNull(), // 12-char hex from results.fingerprint
  clusterLabel: text('cluster_label').notNull(),
  firstSeenRunId: text('first_seen_run_id'),
  lastSeenRunId: text('last_seen_run_id'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  representativeError: text('representative_error').notNull(),
  category: text('category'),
  status: text('status', { enum: ['active', 'resolved'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  fingerprintIdx: index('failure_clusters_fingerprint_idx').on(t.fingerprint),
  statusIdx: index('failure_clusters_status_idx').on(t.status),
}));

// ─── users ────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: text('id').primaryKey(), // UUID
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull().default('viewer'),
  samlSubject: text('saml_subject'), // nullable — set on SSO login for IdP user matching
  tenantId: text('tenant_id'), // nullable, cloud prep
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_unique').on(t.email),
}));

// ─── roles ────────────────────────────────────────────────────────────────────
export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
  description: text('description').notNull(),
  permissions: text('permissions').notNull(), // JSON array of allowed actions
  tenantId: text('tenant_id'), // nullable, cloud prep
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  nameIdx: uniqueIndex('roles_name_unique').on(t.name),
}));

// ─── api_keys ─────────────────────────────────────────────────────────────────
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(), // SHA-256 hash, never plaintext
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  role: text('role', { enum: ['admin', 'editor', 'viewer', 'service'] }).notNull().default('admin'),
  scopes: text('scopes'), // JSON array, null = all scopes
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
  tenantId: text('tenant_id'), // nullable, cloud prep
  createdAt: text('created_at').notNull(),
}, (t) => ({
  keyHashIdx: uniqueIndex('api_keys_key_hash_unique').on(t.keyHash),
  userIdIdx: index('api_keys_user_id_idx').on(t.userId),
}));

// ─── audit_events ─────────────────────────────────────────────────────────────
// Actor is a text field (not FK) so audit records survive user/key deletion.
export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(), // UUID
  timestamp: text('timestamp').notNull(), // ISO-8601 UTC
  actorId: text('actor_id').notNull(), // key ID or 'system' — NOT a FK
  actorType: text('actor_type', { enum: ['user', 'system', 'service'] }).notNull().default('user'),
  action: text('action').notNull(), // e.g. 'auth.login', 'key.create', 'quarantine.add'
  resourceType: text('resource_type'), // e.g. 'api_key', 'quarantine', 'gate'
  resourceId: text('resource_id'), // the ID of the affected resource
  ip: text('ip'), // request remote address
  userAgent: text('user_agent'), // request User-Agent
  requestId: text('request_id'), // correlate with request logs
  details: text('details'), // JSON blob for extra context
  tenantId: text('tenant_id'), // nullable, cloud prep
  createdAt: text('created_at').notNull(),
}, (t) => ({
  actorIdx: index('audit_events_actor_idx').on(t.actorId),
  actionIdx: index('audit_events_action_idx').on(t.action),
  timestampIdx: index('audit_events_timestamp_idx').on(t.timestamp),
}));

// ─── saml_config ───────────────────────────────────────────────────────────────
// Stores SAML IdP configuration (single-row table — one IdP per deployment).
export const samlConfig = pgTable('saml_config', {
  id: text('id').primaryKey(), // UUID
  entryPoint: text('entry_point').notNull(), // IdP SSO URL
  issuer: text('issuer').notNull(), // SP entity ID / issuer
  idpCert: text('idp_cert').notNull(), // IdP public certificate (PEM or base64-PEM)
  callbackUrl: text('callback_url').notNull(), // ACS URL
  spPrivateKey: text('sp_private_key'), // SP private key for signed requests (optional)
  defaultRole: text('default_role', { enum: ['admin', 'editor', 'viewer'] }).notNull().default('viewer'),
  updatedAt: text('updated_at').notNull(),
});
