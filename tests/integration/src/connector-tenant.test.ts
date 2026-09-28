import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { connectorConfigs, vaultEntries } from '@automate/db';
import { assertSchemaBuildIsFresh, createMigratedDatabase } from './migrations.js';

/**
 * P-7, against the real migration graph.
 *
 * `connector_name` was `UNIQUE` on its own in both `vault_entries` and
 * `connector_configs`, and neither table had a workspace column — so one row per
 * connector served the whole installation. Two tenants configuring GitHub shared a
 * single row, and the second write updated the first tenant's credential. Whether it
 * overwrote or collided on the constraint, the outcome was a tenant reading or losing
 * another tenant's secret.
 */

let client: PGlite;

const WS_A = 'workspace-a';
const WS_B = 'workspace-b';

const NOW = new Date('2026-09-27T00:00:00.000Z');

beforeEach(async () => {
  assertSchemaBuildIsFresh();
  client = await createMigratedDatabase();
});

describe('connector credentials are per workspace', () => {
  it('stores a different credential for each workspace using the same connector', async () => {
    // The finding, as a test. Before the composite index the second insert could not
    // exist at all: one row per connector name, installation-wide.
    await client.query(
      'INSERT INTO vault_entries (id, connector_name, workspace_id, ciphertext, iv, auth_tag, salt, iterations, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10), ($11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
      [
        'entry-a',
        'github',
        WS_A,
        'github-secret-for-a',
        'iv',
        'tag',
        'salt',
        100_000,
        NOW,
        NOW,
        'entry-b',
        'github',
        WS_B,
        'github-secret-for-b',
        'iv',
        'tag',
        'salt',
        100_000,
        NOW,
        NOW,
      ],
    );
    const rows = await client.query<{ workspace_id: string; ciphertext: string }>(
      'SELECT workspace_id, ciphertext FROM vault_entries ORDER BY workspace_id',
    );
    expect(rows.rows.map((r) => r.ciphertext)).toEqual([
      'github-secret-for-a',
      'github-secret-for-b',
    ]);
  });

  it('still refuses a second credential for the same connector in the same workspace', () => {
    // The property the index exists for, and the half that must not regress: a genuine
    // duplicate inside one tenant is still a duplicate.
    const failure = client
      .query(
        'INSERT INTO vault_entries (id, connector_name, workspace_id, ciphertext, iv, auth_tag, salt, iterations, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10), ($11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          'entry-1',
          'github',
          WS_A,
          'a',
          'iv',
          'tag',
          'salt',
          100_000,
          NOW,
          NOW,
          'entry-2',
          'github',
          WS_A,
          'b',
          'iv',
          'tag',
          'salt',
          100_000,
          NOW,
          NOW,
        ],
      )
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    return expect(failure).not.toBeNull();
  });

  it('scopes connector settings the same way', async () => {
    await client.query(
      'INSERT INTO connector_configs (id, connector_name, workspace_id, enabled, settings, updated_at) VALUES ($1,$2,$3,$4,$5,$6), ($7,$8,$9,$10,$11,$12)',
      [
        'cfg-a',
        'github',
        WS_A,
        true,
        JSON.stringify({ org: 'a' }),
        NOW,
        'cfg-b',
        'github',
        WS_B,
        false,
        JSON.stringify({ org: 'b' }),
        NOW,
      ],
    );
    const rows = await client.query<{ workspace_id: string; settings: { org: string } }>(
      'SELECT workspace_id, settings FROM connector_configs ORDER BY workspace_id',
    );
    expect(rows.rows.map((r) => r.settings.org)).toEqual(['a', 'b']);
  });

  it('cannot store a credential with no workspace', async () => {
    // The other half of the migration. A credential with no workspace is one that no
    // tenant can own, which is the state that made the global uniqueness look
    // reasonable in the first place.
    const failure = await client
      .query(
        'INSERT INTO vault_entries (id, connector_name, workspace_id, ciphertext, iv, auth_tag, salt, iterations, created_at, updated_at) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9)',
        ['entry-null', 'jira', 'secret', 'iv', 'tag', 'salt', 100_000, NOW, NOW],
      )
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(failure).not.toBeNull();
  });

  it('declares the workspace on both tables and scopes both indexes', () => {
    // Cheap, and it pins the decision in both places the drift could reappear: a table
    // that gained a column but kept a global unique index would pass a runtime test
    // that only ever inserted into one workspace.
    expect(vaultEntries.workspaceId.notNull).toBe(true);
    expect(connectorConfigs.workspaceId.notNull).toBe(true);
    expect(vaultEntries.connectorName.isUnique).toBeFalsy();
    expect(connectorConfigs.connectorName.isUnique).toBeFalsy();
  });
});
