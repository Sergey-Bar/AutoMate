// @automate/db — PostgreSQL schema package
// Exports all Drizzle pgTable schemas and a createDbClient helper.

export * from './schema/index.js';
export { createDbClient, createDbResources } from './client.js';
export { DrizzleInstallationKeyStore } from './repositories/installation-key-repository.js';
export { DrizzleSessionStore } from './repositories/session-repository.js';
export {
  DrizzleOutboxRepository,
  type AppendOutboxEvent,
  type OutboxDatabase,
  type OutboxEvent,
  type OutboxReadPage,
} from './repositories/outbox-repository.js';
