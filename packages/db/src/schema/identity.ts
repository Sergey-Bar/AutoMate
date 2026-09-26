import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
  },
  (table) => [
    uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    index('sessions_installation_idx').on(table.installationId),
    index('sessions_expiry_idx').on(table.expiresAt),
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

export const runnerIdentities = pgTable('runner_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  credentialHash: text('credential_hash'),
  status: text('status', { enum: ['pending', 'active', 'revoked'] })
    .notNull()
    .default('pending'),
  scopes: text('scopes').array().notNull().default([]),
  capabilities: jsonb('capabilities').$type<Record<string, unknown>>().notNull().default({}),
  enrollmentExpiresAt: timestamp('enrollment_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const runnerEnrollmentTokens = pgTable(
  'runner_enrollment_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runnerId: uuid('runner_id')
      .notNull()
      .references(() => runnerIdentities.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('runner_enrollment_token_hash_idx').on(table.tokenHash)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    sequence: integer('sequence').primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull().defaultRandom(),
    workspaceId: text('workspace_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    // `EVENT_VERSION` from `@automate/shared-contracts`, which defaults to 2
    // here while the contract, the SSE frame and every writer use 1 — so a
    // writer that omitted this field produced a row a consumer could never match
    // against the frame. Migration 0008 aligns the column. The value is repeated
    // rather than imported because `packages/db` is a leaf and must not depend
    // on the contracts; `tests/integration` asserts the two agree.
    eventVersion: integer('event_version').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbox_events_dedupe_idx').on(table.dedupeKey),
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
