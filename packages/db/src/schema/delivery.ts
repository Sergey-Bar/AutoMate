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

// ─── Delivery performance ──────────────────────────────────────────────────
//
// Eight tables, added in `0037_delivery.sql`, `0038_github_webhooks.sql` and
// `0039_ai_code_governance.sql`, each hard-scoped
// from its first migration: `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and an
// index that leads with it. `ON DELETE CASCADE` on the project, as the health tables have.
//
// **Every observation is keyed on (workspace, project, source, external id)**, so a sync that
// runs twice and a CI job that pushes the same deployment twice each write one row. A pushed
// deployment that GitHub also reports is a second row under a different source; the two are
// collapsed when the metrics are computed (`apps/api/src/services/delivery-service.ts`,
// `dedupeDeployments`), never on write, so the order the two arrive in does not matter.
//
// **No token is stored here.** A project's GitHub token is the vault entry `git:<projectId>`.

/** Where a project's delivery data comes from, and how far each stream has been read. */
export const deliverySources = pgTable(
  'delivery_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('github'),
    enabled: boolean('enabled').notNull().default(false),
    cadence: text('cadence').notNull().default('daily'),
    productionEnvironments: jsonb('production_environments')
      .$type<string[]>()
      .notNull()
      .default(['production']),
    /** Labels and head-branch prefixes that mark a change a rollback or a hotfix. */
    markers: jsonb('markers').notNull().default({}),
    /** Workflow names whose completed runs on the default branch count as deployments. */
    deployWorkflows: jsonb('deploy_workflows').$type<string[]>().notNull().default([]),
    /** Per stream: `{ cursor, syncedAt }`. Advanced only when the stream read succeeded. */
    cursors: jsonb('cursors').notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    rateLimitedUntil: timestamp('rate_limited_until', { withTimezone: true }),
    /** When the worker queues the next scheduled sync. */
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('delivery_sources_project_idx').on(table.workspaceId, table.projectId),
    // The worker's poll: enabled sources whose next sync is due.
    index('delivery_sources_due_idx')
      .on(table.nextSyncAt)
      .where(sql`enabled = true`),
    check('delivery_sources_provider_check', sql`${table.provider} IN ('github')`),
    check('delivery_sources_cadence_check', sql`${table.cadence} IN ('hourly', 'daily')`),
    check(
      'delivery_sources_last_status_check',
      sql`${table.lastStatus} IS NULL OR ${table.lastStatus} IN ('ok', 'failed', 'not_configured', 'rate_limited')`,
    ),
  ],
);

/**
 * One sync of one source, queued by the worker, an operator or a webhook, and claimed by the
 * API with a lease (`next_attempt_at`), the `report_deliveries` pattern.
 */
export const deliverySyncs = pgTable(
  'delivery_syncs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => deliverySources.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    requestedBy: text('requested_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** What the sync wrote, per stream. */
    stats: jsonb('stats').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /**
     * Set afresh by every claim: the token a running sync's writes carry. A process whose
     * lease lapsed and was reclaimed holds a stale one, and every write it attempts matches
     * nothing (`0044_delivery_hardening.sql`).
     */
    leaseId: uuid('lease_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('delivery_syncs_idempotency_idx').on(table.idempotencyKey),
    // One queued sync per source: a second request while one waits is that one.
    uniqueIndex('delivery_syncs_one_queued_idx')
      .on(table.sourceId)
      .where(sql`status = 'queued'`),
    index('delivery_syncs_workspace_idx').on(table.workspaceId, table.sourceId, table.createdAt),
    index('delivery_syncs_due_idx')
      .on(table.status, table.nextAttemptAt)
      .where(sql`status IN ('queued', 'running')`),
    check(
      'delivery_syncs_status_check',
      sql`${table.status} IN ('queued', 'running', 'done', 'failed')`,
    ),
    check(
      'delivery_syncs_requested_by_check',
      sql`${table.requestedBy} IN ('schedule', 'operator', 'webhook')`,
    ),
  ],
);

/** A pull request as GitHub last described it, with what the sync derived from it. */
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('github'),
    externalId: text('external_id').notNull(),
    number: integer('number').notNull(),
    state: text('state').notNull(),
    draft: boolean('draft').notNull().default(false),
    /** Kept for attribution; never returned by a delivery or an ai-code read. */
    authorLogin: text('author_login'),
    headBranch: text('head_branch'),
    baseBranch: text('base_branch'),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    title: text('title').notNull(),
    /** Bounded (4000 characters) by the sync: kept for attribution markers, not as a mirror. */
    body: text('body'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    firstCommitAt: timestamp('first_commit_at', { withTimezone: true }),
    firstReviewAt: timestamp('first_review_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    mergeCommitSha: text('merge_commit_sha'),
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    changedFiles: integer('changed_files').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    approvalCount: integer('approval_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    testsTouched: boolean('tests_touched').notNull().default(false),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    // ─── AI-code governance (`0039_ai_code_governance.sql`) ───
    /** The head commit when last synced, for the diff coverage the PR was gated on. */
    headSha: text('head_sha'),
    /** The first 300 changed paths, each at most 500 characters: for follow-up-fix matching. */
    changedPaths: jsonb('changed_paths').$type<string[]>().notNull().default([]),
    /** Distinct approvers who are neither the author nor a bot (`[bot]` or an agent's login). */
    humanApprovalCount: integer('human_approval_count').notNull().default(0),
    attribution: text('attribution').notNull().default('unknown'),
    aiAgent: text('ai_agent'),
    attributionConfidence: real('attribution_confidence').notNull().default(0),
    /** The signals the classifier used, at most 20; each names a signature, never a person. */
    attributionSignals: jsonb('attribution_signals')
      .$type<Array<{ kind: string; detail: string }>>()
      .notNull()
      .default([]),
    /**
     * The signature table (and label set) the row was classified against; `null` before the
     * first classification. A row whose version is not the current one is re-classified at the
     * start of the next sync.
     */
    attributionVersion: text('attribution_version'),
  },
  (table) => [
    uniqueIndex('pull_requests_external_idx').on(
      table.workspaceId,
      table.projectId,
      table.source,
      table.externalId,
    ),
    index('pull_requests_activity_idx').on(
      table.workspaceId,
      table.projectId,
      table.lastActivityAt,
    ),
    index('pull_requests_merge_idx').on(table.workspaceId, table.projectId, table.mergeCommitSha),
    index('pull_requests_number_idx').on(table.workspaceId, table.projectId, table.number),
    check('pull_requests_state_check', sql`${table.state} IN ('open', 'closed', 'merged')`),
    check(
      'pull_requests_attribution_check',
      sql`${table.attribution} IN ('agent-authored', 'ai-assisted', 'human', 'unknown')`,
    ),
    check(
      'pull_requests_attribution_confidence_check',
      sql`${table.attributionConfidence} >= 0 AND ${table.attributionConfidence} <= 1`,
    ),
  ],
);

/**
 * Commits, from a pull request's commit list or the default branch. Bounded by the sync to the
 * most recent 5000 per project; they feed the next wave's AI attribution.
 */
export const commits = pgTable(
  'commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('github'),
    sha: text('sha').notNull(),
    prNumber: integer('pr_number'),
    authorLogin: text('author_login'),
    authorEmail: text('author_email'),
    authorName: text('author_name'),
    committerLogin: text('committer_login'),
    /** Bounded (2000 characters) by the sync. */
    message: text('message').notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('commits_external_idx').on(
      table.workspaceId,
      table.projectId,
      table.source,
      table.sha,
    ),
    index('commits_recent_idx').on(table.workspaceId, table.projectId, table.committedAt),
  ],
);

/** A deployment, from GitHub or pushed by CI, with its outcome. */
export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    environment: text('environment').notNull(),
    status: text('status').notNull(),
    /** When the deployment happened (GitHub's `created_at`, or what CI pushed). */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    sha: text('sha'),
    shas: jsonb('shas').$type<string[]>().notNull().default([]),
    rollback: boolean('rollback').notNull().default(false),
    hotfix: boolean('hotfix').notNull().default(false),
    unplanned: boolean('unplanned').notNull().default(false),
    url: text('url'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('deployments_external_idx').on(
      table.workspaceId,
      table.projectId,
      table.source,
      table.externalId,
    ),
    index('deployments_recent_idx').on(table.workspaceId, table.projectId, table.createdAt),
    check('deployments_source_check', sql`${table.source} IN ('github', 'push')`),
    check('deployments_status_check', sql`${table.status} IN ('success', 'failure')`),
  ],
);

/** An incident, pushed by whatever pages people, linked to the deployment that caused it. */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    severity: text('severity'),
    /** The causing deployment's external id, as the pusher knows it. */
    deploymentExternalId: text('deployment_external_id'),
    sha: text('sha'),
    title: text('title').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('incidents_external_idx').on(
      table.workspaceId,
      table.projectId,
      table.source,
      table.externalId,
    ),
    index('incidents_recent_idx').on(table.workspaceId, table.projectId, table.openedAt),
    check(
      'incidents_severity_check',
      sql`${table.severity} IS NULL OR ${table.severity} IN ('critical', 'high', 'medium', 'low')`,
    ),
  ],
);

/**
 * GitHub webhook delivery ids already accepted, so a captured request replayed later is
 * refused. Bounded by the receiver to seven days and 10 000 rows per workspace: a replay
 * older than that is a sync request for data the schedule has long since read.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().default('github'),
    deliveryId: text('delivery_id').notNull(),
    event: text('event').notNull(),
    /**
     * The sha256 of the raw signed body. GitHub's signature covers the body and not the
     * `X-GitHub-Delivery` header, so a replay is a repeated body as well as a repeated id
     * (`0044_delivery_hardening.sql`). `null` on rows accepted before it was kept.
     */
    bodySha256: text('body_sha256'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_deliveries_delivery_idx').on(
      table.workspaceId,
      table.provider,
      table.deliveryId,
    ),
    uniqueIndex('webhook_deliveries_body_idx').on(
      table.workspaceId,
      table.provider,
      table.bodySha256,
    ),
    index('webhook_deliveries_recent_idx').on(table.workspaceId, table.receivedAt),
  ],
);

/**
 * What the pull-request gate found new on a pull request: the high and critical findings its
 * branch adds over the default branch, as of the last gate report that named the pull request.
 * One row per (workspace, project, pull request), upserted, and bounded by the writer to the
 * 5000 most recently reported per project. Added in `0039_ai_code_governance.sql`, hard-scoped
 * from its first migration.
 */
export const pullRequestGateFindings = pgTable(
  'pull_request_gate_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    commitSha: text('commit_sha').notNull(),
    newHigh: integer('new_high').notNull().default(0),
    newCritical: integer('new_critical').notNull().default(0),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pull_request_gate_findings_pr_idx').on(
      table.workspaceId,
      table.projectId,
      table.prNumber,
    ),
    index('pull_request_gate_findings_recent_idx').on(
      table.workspaceId,
      table.projectId,
      table.reportedAt,
    ),
    check(
      'pull_request_gate_findings_counts_check',
      sql`${table.prNumber} >= 1 AND ${table.newHigh} >= 0 AND ${table.newCritical} >= 0`,
    ),
  ],
);

export type DeliverySourceRow = InferSelectModel<typeof deliverySources>;
export type DeliverySyncRow = InferSelectModel<typeof deliverySyncs>;
export type PullRequestRow = InferSelectModel<typeof pullRequests>;
export type CommitRow = InferSelectModel<typeof commits>;
export type DeploymentRow = InferSelectModel<typeof deployments>;
export type IncidentRow = InferSelectModel<typeof incidents>;
export type PullRequestGateFindingsRow = InferSelectModel<typeof pullRequestGateFindings>;
