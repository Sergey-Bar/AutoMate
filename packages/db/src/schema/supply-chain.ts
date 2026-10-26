import {
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
import { healthReports } from './health.js';

// ─── Supply chain and diff coverage ────────────────────────────────────────
//
// Five tables, added in `0035_supply_chain.sql` and `0036_diff_coverage.sql`, each
// hard-scoped from its first migration: `workspace_id` NOT NULL, a `restrict` key onto
// `workspaces`, and an index that leads with it. `ON DELETE CASCADE` on the project, as the
// health tables have: an inventory of a project that is gone describes nothing.

/**
 * The latest SBOM inventory of a project on a branch. Replaced whole on every SBOM upload, so
 * a component that left the build leaves the table — this is "what ships now", not a history.
 */
export const sbomComponents = pgTable(
  'sbom_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    reportId: uuid('report_id').references(() => healthReports.id, { onDelete: 'set null' }),
    purl: text('purl'),
    name: text('name').notNull(),
    version: text('version'),
    type: text('type').notNull(),
    // SPDX identifiers named by the document, sorted and unique.
    licences: jsonb('licences').$type<string[]>().notNull().default([]),
    licenceExpression: text('licence_expression'),
    supplier: text('supplier'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sbom_components_project_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.purl,
    ),
    // The portfolio search: every project in a workspace shipping a purl prefix.
    index('sbom_components_purl_idx').on(table.workspaceId, table.purl),
  ],
);

/**
 * Every VEX document uploaded for a project, one row per document id. A re-upload of the same
 * id replaces its statements and moves it to the end of the order the documents apply in.
 */
export const vexDocuments = pgTable(
  'vex_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),
    author: text('author'),
    // The document's own timestamp, verbatim: the supplier's claim, never the apply order.
    issuedAt: text('issued_at'),
    // `VexStatement[]`, as `parseVex` read them.
    statements: jsonb('statements').$type<unknown[]>().notNull().default([]),
    reportId: uuid('report_id').references(() => healthReports.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('vex_documents_identity_idx').on(
      table.workspaceId,
      table.projectId,
      table.documentId,
    ),
    index('vex_documents_order_idx').on(table.workspaceId, table.projectId, table.receivedAt),
  ],
);

/** A project's licence and provenance policy: `SupplyChainPolicy` from the contracts. */
export const supplyChainPolicies = pgTable(
  'supply_chain_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supply_chain_policies_project_idx').on(table.workspaceId, table.projectId),
  ],
);

/**
 * The executable and covered lines of one commit, from its coverage reports. One row per
 * commit, merged across reports (shards of one run are one measurement). Bounded: the service
 * keeps the most recent 50 per project.
 */
export const coverageLineMaps = pgTable(
  'coverage_line_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    // `LineCoverageFile[]`.
    files: jsonb('files').$type<unknown[]>().notNull().default([]),
    reportId: uuid('report_id').references(() => healthReports.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coverage_line_maps_commit_idx').on(
      table.workspaceId,
      table.projectId,
      table.commitSha,
    ),
    index('coverage_line_maps_recent_idx').on(table.workspaceId, table.projectId, table.receivedAt),
  ],
);

/**
 * A commit's diff and, once both halves have arrived, its diff coverage. `changed` is the
 * diff's added lines; the result columns stay null until a line map for the same commit
 * exists. Bounded like `coverage_line_maps`.
 */
export const diffCoverageResults = pgTable(
  'diff_coverage_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    commitSha: text('commit_sha').notNull(),
    // `{ path, lines }[]`: the added lines per file, by their number in the new file.
    changed: jsonb('changed').$type<unknown[]>().notNull().default([]),
    covered: integer('covered'),
    executable: integer('executable'),
    ratio: real('ratio'),
    uncovered: jsonb('uncovered').$type<unknown[]>(),
    unmeasuredFiles: jsonb('unmeasured_files').$type<string[]>(),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    reportId: uuid('report_id').references(() => healthReports.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('diff_coverage_results_commit_idx').on(
      table.workspaceId,
      table.projectId,
      table.branch,
      table.commitSha,
    ),
    index('diff_coverage_results_recent_idx').on(
      table.workspaceId,
      table.projectId,
      table.receivedAt,
    ),
    check(
      'diff_coverage_results_ratio_check',
      sql`${table.ratio} IS NULL OR ${table.ratio} BETWEEN 0 AND 1`,
    ),
  ],
);

export type SbomComponentRow = InferSelectModel<typeof sbomComponents>;
export type VexDocumentRow = InferSelectModel<typeof vexDocuments>;
export type SupplyChainPolicyRow = InferSelectModel<typeof supplyChainPolicies>;
export type CoverageLineMapRow = InferSelectModel<typeof coverageLineMaps>;
export type DiffCoverageResultRow = InferSelectModel<typeof diffCoverageResults>;
