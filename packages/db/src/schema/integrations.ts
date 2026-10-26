import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { projects, workspaces } from './dashboard.js';
import { healthFindings } from './health.js';

// ─── Issue trackers, issue links and test proposals ─────────────────────────
//
// Three tables, each hard-scoped from its first migration, the `0028` shape: `workspace_id`
// NOT NULL, a `restrict` key onto `workspaces`, and every index leading with it. `ON DELETE
// CASCADE` on the project, as the health tables have.
//
// **No credential is stored here.** A tracker's token is the vault entry
// `tracker:<projectId>:<kind>` (`apps/api/src/services/vault-secrets.ts`), so a row of
// `issue_trackers` is safe to list and return.

/** One project's issue tracker: where an issue from a finding or a failure cluster goes. */
export const issueTrackers = pgTable(
  'issue_trackers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** `https` only: every request to it carries the token. */
    baseUrl: text('base_url').notNull(),
    projectKey: text('project_key').notNull(),
    issueType: text('issue_type').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('issue_trackers_project_kind_idx').on(
      table.workspaceId,
      table.projectId,
      table.kind,
    ),
    check('issue_trackers_kind_check', sql`${table.kind} IN ('jira')`),
    check('issue_trackers_base_url_check', sql`${table.baseUrl} LIKE 'https://%'`),
  ],
);

/**
 * The issue created from one finding or one failure cluster, in one tracker — the record
 * that makes the create idempotent. A row is written `pending` before the tracker is called
 * (the unique index makes that the claim), and `created` with the key and URL after.
 */
export const issueLinks = pgTable(
  'issue_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceKind: text('source_kind').notNull(),
    /** A finding's id, or the sha256 of a failure cluster's signature. */
    sourceKey: text('source_key').notNull(),
    target: text('target').notNull(),
    state: text('state').notNull().default('pending'),
    issueKey: text('issue_key'),
    issueUrl: text('issue_url'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('issue_links_source_idx').on(
      table.workspaceId,
      table.projectId,
      table.sourceKind,
      table.sourceKey,
      table.target,
    ),
    check('issue_links_source_kind_check', sql`${table.sourceKind} IN ('finding', 'cluster')`),
    check('issue_links_target_check', sql`${table.target} IN ('jira', 'github')`),
    check('issue_links_state_check', sql`${table.state} IN ('pending', 'created')`),
    check(
      'issue_links_created_check',
      sql`${table.state} <> 'created' OR (${table.issueKey} IS NOT NULL AND ${table.issueUrl} IS NOT NULL)`,
    ),
  ],
);

/**
 * A test the model proposed: a unified diff for a new test file, never applied. Bounded per
 * project by the service (`TEST_PROPOSAL_RETENTION` in `apps/api`).
 */
export const testProposals = pgTable(
  'test_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    findingId: uuid('finding_id').references(() => healthFindings.id, { onDelete: 'set null' }),
    commitSha: text('commit_sha'),
    path: text('path').notNull(),
    testFramework: text('test_framework').notNull(),
    suggestedPath: text('suggested_path').notNull(),
    patch: text('patch').notNull(),
    rationale: text('rationale').notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('test_proposals_project_idx').on(table.workspaceId, table.projectId, table.createdAt),
    check(
      'test_proposals_kind_check',
      sql`${table.kind} IN ('surviving-mutant', 'uncovered-lines')`,
    ),
    check('test_proposals_patch_check', sql`length(${table.patch}) <= 65536`),
  ],
);

export type IssueTrackerRow = InferSelectModel<typeof issueTrackers>;
export type IssueLinkRow = InferSelectModel<typeof issueLinks>;
export type TestProposalRow = InferSelectModel<typeof testProposals>;
