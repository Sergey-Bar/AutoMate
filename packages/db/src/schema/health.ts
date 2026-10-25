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
// The tenancy root and the project registry. `dashboard.ts` does not import this module.
import { projects, workspaces } from './dashboard.js';

// ─── Repository health ─────────────────────────────────────────────────────
//
// Three tables, added in `0031_repository_health.sql`, each hard-scoped from its first
// migration: `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and an index that
// leads with it.
//
// **No grade is stored as an authority.** The grade is `grade()` in `@automate/projects`,
// computed live from the open findings and the latest metrics. `health_snapshots` is a
// history — each row is the grade as it was computed just after an upload, drawn only as a
// past point on the trend line — exactly the rule `scan_snapshots` follows.

/** One scanner report as it arrived: a SARIF file, a jscpd report, a Scorecard result. */
export const healthReports = pgTable(
  'health_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Arrival order. "The latest report of a kind" is the highest sequence, not the latest
    // timestamp: two uploads in one millisecond still have an order.
    sequence: integer('sequence').notNull().generatedAlwaysAsIdentity(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    commitSha: text('commit_sha'),
    // `ci` (an upload), `runner` (a scan this install ran) or `manual`.
    source: text('source').notNull(),
    format: text('format').notNull(),
    // Which report a later one of the same kind supersedes: the format, plus the tool names
    // for SARIF. A finding absent from the next report with the same key is fixed.
    toolKey: text('tool_key').notNull(),
    // `ScannerRun[]` — the tools that ran and the dimensions their silence measures.
    tools: jsonb('tools').$type<unknown[]>().notNull().default([]),
    // `DimensionMetric[]` for a metric report; empty for SARIF.
    metrics: jsonb('metrics').$type<unknown[]>().notNull().default([]),
    findingCount: integer('finding_count').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('health_reports_latest_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.toolKey,
      table.sequence,
    ),
    check('health_reports_finding_count_check', sql`${table.findingCount} >= 0`),
  ],
);

/** One finding per `(project, branch, fingerprint)`, carried across reports. */
export const healthFindings = pgTable(
  'health_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    fingerprint: text('fingerprint').notNull(),
    toolKey: text('tool_key').notNull(),
    tool: text('tool').notNull(),
    ruleId: text('rule_id').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    dimension: text('dimension').notNull(),
    path: text('path'),
    line: integer('line'),
    message: text('message').notNull(),
    helpUri: text('help_uri'),
    fixAvailable: boolean('fix_available'),
    // `open` | `fixed` decided by reports; `suppressed` | `accepted` | `false_positive`
    // decided by a person, who leaves a reason. Only `open` counts against the grade.
    state: text('state').notNull().default('open'),
    triageReason: text('triage_reason'),
    // A suppression or an accepted risk expires; past it the finding counts again.
    triageExpiresAt: timestamp('triage_expires_at', { withTimezone: true }),
    triagedBy: text('triaged_by'),
    owner: text('owner'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastReportId: uuid('last_report_id').references(() => healthReports.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('health_findings_identity_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.fingerprint,
    ),
    index('health_findings_tool_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.toolKey,
    ),
    check(
      'health_findings_state_check',
      sql`${table.state} IN ('open', 'fixed', 'suppressed', 'accepted', 'false_positive')`,
    ),
    check(
      'health_findings_severity_check',
      sql`${table.severity} IN ('critical', 'high', 'medium', 'low', 'info')`,
    ),
  ],
);

/** The grade just after each upload, for the trend line. Never read to decide anything. */
export const healthSnapshots = pgTable(
  'health_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    score: real('score'),
    letter: text('letter'),
    // `HealthGrade`, verbatim, so a past point can be explained by what produced it.
    grade: jsonb('grade').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('health_snapshots_project_taken_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.takenAt,
    ),
    check(
      'health_snapshots_score_check',
      sql`${table.score} IS NULL OR ${table.score} BETWEEN 0 AND 100`,
    ),
  ],
);

export type HealthReportRow = InferSelectModel<typeof healthReports>;
export type HealthFindingRow = InferSelectModel<typeof healthFindings>;
export type HealthSnapshotRow = InferSelectModel<typeof healthSnapshots>;

/**
 * Access tokens: a role, optionally pinned to one project, and a hash of a random secret.
 *
 * `uploader` may only send reports to its own project — the CI credential. `viewer`,
 * `operator` and `admin` are the dashboard roles. The secret itself is shown once at creation
 * and never stored. Added in `0032_access_tokens.sql`.
 */
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    role: text('role').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    displayPrefix: text('display_prefix').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('access_tokens_hash_idx').on(table.tokenHash),
    index('access_tokens_workspace_idx').on(table.workspaceId, table.createdAt),
    check(
      'access_tokens_role_check',
      sql`${table.role} IN ('viewer', 'operator', 'admin', 'uploader')`,
    ),
    // An uploader without a project could send reports anywhere: the one role that must be pinned.
    check(
      'access_tokens_uploader_project_check',
      sql`${table.role} <> 'uploader' OR ${table.projectId} IS NOT NULL`,
    ),
  ],
);

export type AccessTokenRow = InferSelectModel<typeof accessTokens>;
