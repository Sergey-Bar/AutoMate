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
  status: text('status', { enum: ['pending', 'active', 'revoked'] }).notNull().default('pending'),
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
    eventVersion: integer('event_version').notNull().default(2),
    payload: jsonb('payload').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbox_events_dedupe_idx').on(table.dedupeKey),
    index('outbox_events_sequence_idx').on(table.sequence),
    index('outbox_events_expiry_idx').on(table.expiresAt),
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
    uniqueIndex('legacy_id_map_source_idx').on(table.sourceSystem, table.entityType, table.legacyId),
    uniqueIndex('legacy_id_map_internal_idx').on(table.sourceSystem, table.entityType, table.internalId),
  ],
);

export const systemAuditEvents = pgTable(
  'system_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestId: text('request_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (table) => [
    index('audit_events_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_events_retain_idx').on(table.retainUntil),
  ],
);
