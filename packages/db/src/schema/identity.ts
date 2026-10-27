import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// The tenancy root. `dashboard.ts` does not import this module, so this is no cycle.
import { users, workspaces } from './dashboard.js';

export const installations = pgTable('installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const installationKeys = pgTable(
  'installation_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    displayPrefix: text('display_prefix').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('installation_keys_hash_idx').on(table.keyHash),
    uniqueIndex('installation_keys_installation_name_idx').on(table.installationId, table.name),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * The person this session signs in, since `0049_workspace_members.sql`. Null is the
     * installation's own session — every session before it, and the installation-key sign-in.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    index('sessions_installation_idx').on(table.installationId),
    index('sessions_expiry_idx').on(table.expiresAt),
    index('sessions_user_idx').on(table.userId),
  ],
);

/**
 * A person's role in one workspace (ADR-014, team). One row per person per workspace, so a
 * person can be an admin in one and a viewer in another. Hard-scoped from the first migration.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['viewer', 'operator', 'admin'] }).notNull(),
    invitedBy: text('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'workspace_members_pkey', columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId),
    check('workspace_members_role_check', sql`${table.role} IN ('viewer', 'operator', 'admin')`),
  ],
);

/**
 * An invitation to a workspace. Only a hash of its secret is stored; the secret is in the link
 * an admin sends, once. Spent when accepted: `accepted_at` set, `accepted_by` the person.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['viewer', 'operator', 'admin'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('invitations_token_hash_idx').on(table.tokenHash),
    index('invitations_workspace_idx').on(table.workspaceId, table.createdAt),
    check('invitations_role_check', sql`${table.role} IN ('viewer', 'operator', 'admin')`),
  ],
);

export const serviceCredentials = pgTable(
  'service_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    credentialHash: text('credential_hash').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('service_credentials_hash_idx').on(table.credentialHash)],
);

// `runner_identities` and `runner_enrollment_tokens` were removed in migration 0013.
//
// They were a second, parallel answer to "what is a runner", and they disagreed
// with the one the product uses. `runners` is what `execution_jobs.lease_owner`
// references, what carries the workspace scope, and what has a constrained `health`
// column. `runner_identities` overlapped it by name and declared a *different*
// status vocabulary (`pending | active | revoked`), with no workspace column and no
// writer or reader anywhere in application code. `RunnerControlService` kept a
// third, in-process vocabulary.
//
// The FK mismatch this was originally filed under cannot bite -- there is no row to
// mismatch -- but an unused second answer can still be *read* as an answer, and a
// future writer reaching for the obviously-intended table would populate a schema
// the scheduler never consults. The migration fails loudly if either table holds
// rows, because "there was nothing there" and "something was deleted" are different
// outcomes and only one of them should be silent.
//
// `RunnerControlService`'s in-process identities are unchanged and still not
// durable; `docs/migration/capability-register.md` records that for
// `auth.service-credentials`. Making enrollment write `runners` is product work, not
// consolidation.

export const outboxEvents = pgTable(
  'outbox_events',
  {
    sequence: integer('sequence').primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull().defaultRandom(),
    // NOT NULL since `0017_outbox_workspace_scope.sql`, and load-bearing rather than
    // tidy: `readAfter` matches on `workspace_id`, so a NULL row was invisible to every
    // consumer while still consuming a sequence number and counting toward the
    // retention floor. The gap was permanent and it moved the watermark.
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    // `EVENT_VERSION` from `@automate/shared-contracts`, repeated rather than
    // imported because `packages/db` is a leaf and must not depend on the
    // contracts. This column used to default to **2** while the contract, the SSE
    // frame and every writer used **1**, so a writer that omitted the field
    // produced a row no consumer could ever match; migration 0008 aligned the
    // default and `tests/integration` reads the **live** column default to assert
    // the two agree.
    eventVersion: integer('event_version').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    // Scoped to the workspace by `0017_outbox_workspace_scope.sql`. A dedupe key on its
    // own was global, so the same key in two workspaces suppressed the second event and
    // the append reported nothing — a tenant's event that simply never existed.
    uniqueIndex('outbox_events_workspace_dedupe_idx').on(table.workspaceId, table.dedupeKey),
    index('outbox_events_sequence_idx').on(table.sequence),
    index('outbox_events_expiry_idx').on(table.expiresAt),
    index('outbox_events_workspace_sequence_idx').on(table.workspaceId, table.sequence),
  ],
);

export const legacyIdMap = pgTable(
  'legacy_id_map',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSystem: text('source_system').notNull(),
    entityType: text('entity_type').notNull(),
    legacyId: text('legacy_id').notNull(),
    internalId: uuid('internal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('legacy_id_map_source_idx').on(
      table.sourceSystem,
      table.entityType,
      table.legacyId,
    ),
    uniqueIndex('legacy_id_map_internal_idx').on(
      table.sourceSystem,
      table.entityType,
      table.internalId,
    ),
  ],
);

// `system_audit_events` was removed in migration 0010.
//
// It was a strict *subset* of `audit_events` — same eight columns, none of the
// four that make an audit row attributable (`ip`, `userAgent`, `tenantId`,
// `workspaceId`) — and it had no writer anywhere in application code. Worse, its
// indexes were named `audit_events_resource_idx` and `audit_events_retain_idx`,
// so a reader of the schema or of a query plan would attribute them to the other
// table, and `retain_until` does not exist on `audit_events` at all.
//
// `auditEvents` in `dashboard.ts` is the audit table, and the only one.
