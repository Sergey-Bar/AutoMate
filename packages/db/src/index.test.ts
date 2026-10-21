import { describe, expect, it } from 'vitest';

import * as entry from './index.js';
import { createDbClient, createDbResources } from './client.js';
import {
  BootstrapKeyUnavailableError,
  DrizzleInstallationKeyStore,
} from './repositories/installation-key-repository.js';
import { DrizzleOutboxRepository } from './repositories/outbox-repository.js';
import { DrizzleSessionStore } from './repositories/session-repository.js';
import * as schema from './schema/index.js';

describe('@automate/db package entry', () => {
  it('re-exports the client factories and repositories as the same bindings, not copies', () => {
    expect(entry.createDbClient).toBe(createDbClient);
    expect(entry.createDbResources).toBe(createDbResources);
    expect(entry.DrizzleInstallationKeyStore).toBe(DrizzleInstallationKeyStore);
    expect(entry.BootstrapKeyUnavailableError).toBe(BootstrapKeyUnavailableError);
    expect(entry.DrizzleSessionStore).toBe(DrizzleSessionStore);
    expect(entry.DrizzleOutboxRepository).toBe(DrizzleOutboxRepository);
  });

  it('exposes every schema export unchanged', () => {
    const entryRecord: Record<string, unknown> = entry;
    for (const [name, value] of Object.entries(schema)) {
      expect(entryRecord[name], name).toBe(value);
    }
  });
});
