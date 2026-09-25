// Ported from Automate/apps/server/src/vault/schema.ts
// Original schema is a raw SQLite CREATE TABLE (not managed by Drizzle Kit).
// When migrating to Postgres, this table is brought under Drizzle Kit migration management.
// SQLite → PostgreSQL type adaptations:
//   text(primary key) → text primary key (kept as text, not UUID — connector_name is the natural key)
//   integer → integer
//   text → text

import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

// ─── vault_entries ─────────────────────────────────────────────────────────
// Source: vault_entries — AES-256-GCM encrypted connector credentials
// Original: CREATE TABLE IF NOT EXISTS vault_entries (
//   id TEXT PRIMARY KEY,
//   connector_name TEXT NOT NULL UNIQUE,
//   ciphertext TEXT NOT NULL,
//   iv TEXT NOT NULL,
//   auth_tag TEXT NOT NULL,
//   salt TEXT NOT NULL,
//   iterations INTEGER NOT NULL,
//   created_at TEXT NOT NULL,
//   updated_at TEXT NOT NULL
// )
export const vaultEntries = pgTable('vault_entries', {
  // SQLite: id TEXT PRIMARY KEY
  id: text('id').primaryKey(),
  // SQLite: connector_name TEXT NOT NULL UNIQUE
  connectorName: text('connector_name').notNull().unique(),
  // SQLite: ciphertext TEXT NOT NULL — AES-256-GCM encrypted payload (base64)
  ciphertext: text('ciphertext').notNull(),
  // SQLite: iv TEXT NOT NULL — initialization vector (base64)
  iv: text('iv').notNull(),
  // SQLite: auth_tag TEXT NOT NULL — GCM authentication tag (base64)
  authTag: text('auth_tag').notNull(),
  // SQLite: salt TEXT NOT NULL — PBKDF2 salt (base64)
  salt: text('salt').notNull(),
  // SQLite: iterations INTEGER NOT NULL — PBKDF2 iteration count
  iterations: integer('iterations').notNull(),
  // SQLite: created_at TEXT NOT NULL
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  // SQLite: updated_at TEXT NOT NULL
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────
export type VaultEntry = InferSelectModel<typeof vaultEntries>;
export type InsertVaultEntry = InferInsertModel<typeof vaultEntries>;
