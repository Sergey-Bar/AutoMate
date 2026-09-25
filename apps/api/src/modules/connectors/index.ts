/**
 * index.ts — Connectors Hono sub-app
 *
 * Combines connector registry routes and vault credential routes under a single
 * Hono instance. Mount in apps/api/src/index.ts via:
 *   app.route('/', createConnectorsModule())
 */
import { Hono } from 'hono';
import {
  createConnectorRegistryRoutes,
  InMemoryConnectorRegistry,
} from './registry.js';
import { createVaultRoutes, InMemoryVaultStore } from './vault.js';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface ConnectorsModuleOptions {
  /** Optional pre-constructed registry (for testing) */
  registry?: InstanceType<typeof InMemoryConnectorRegistry>;
  /** Optional pre-constructed vault store (for testing) */
  vaultStore?: InstanceType<typeof InMemoryVaultStore>;
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createConnectorsModule(options: ConnectorsModuleOptions = {}): Hono {
  const app = new Hono();

  // Shared in-memory stores (per-process lifetime, temporary until Postgres layer)
  const registry = options.registry ?? new InMemoryConnectorRegistry();
  const vaultStore = options.vaultStore ?? new InMemoryVaultStore(process.env['VAULT_SECRET']);

  app.route('/', createConnectorRegistryRoutes({ registry }));
  app.route('/', createVaultRoutes({ store: vaultStore }));

  return app;
}

// Re-export types and implementations so callers can inject custom stores for testing
export type { ConnectorRegistry, ConnectorEntry, ConnectorType, ConnectorStatus, ConnectorHealthResult } from './registry.js';
export type { VaultStore, CredentialRecord, CredentialMetadata, CredentialResponse } from './vault.js';
export { InMemoryConnectorRegistry } from './registry.js';
export { InMemoryVaultStore } from './vault.js';
