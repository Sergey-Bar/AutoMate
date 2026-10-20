import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { assertSchemaBuildIsFresh, createMigratedDatabase } from './migrations.js';

/**
 * `scan_snapshots` (migration 0025), against the real migration graph.
 *
 * The claims the history depends on are database claims, so they are asserted here rather
 * than through a service: one reading per workspace, project and hour; a workspace that
 * must exist; values that must be percentages; and a history that goes with its project.
 */
let client: PGlite;
const NOW = new Date('2026-10-20T10:00:00.000Z');
const PROJECT = '11111111-1111-4111-8111-111111111111';

async function seed(workspace: string): Promise<void> {
  await client.query(
    'INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES ($1, $1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [workspace, '/etc/automate', '/var/automate', NOW],
  );
}

async function insert(values: {
  workspace?: string;
  hour?: Date;
  coverage?: number | null;
  maturity?: number;
}): Promise<void> {
  await client.query(
    'INSERT INTO scan_snapshots (workspace_id, project_id, hour, coverage, maturity) VALUES ($1, $2, $3, $4, $5)',
    [
      values.workspace ?? 'ws-a',
      PROJECT,
      values.hour ?? NOW,
      values.coverage ?? 80,
      values.maturity ?? 70,
    ],
  );
}

beforeEach(async () => {
  assertSchemaBuildIsFresh();
  client = await createMigratedDatabase();
  await seed('ws-a');
  await client.query(
    'INSERT INTO projects (id, workspace_id, name, slug) VALUES ($1, $2, $3, $4)',
    [PROJECT, 'ws-a', 'Service', 'svc'],
  );
});

describe('scan_snapshots', () => {
  it('holds one reading per workspace, project and hour', async () => {
    await insert({});
    await expect(insert({ coverage: 81 })).rejects.toThrow(/duplicate key|unique/u);
    await insert({ hour: new Date('2026-10-20T11:00:00.000Z') });
    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM scan_snapshots',
    );
    expect(rows.rows[0]?.count).toBe(2);
  });

  it('refuses a reading for a workspace that does not exist', async () => {
    await expect(insert({ workspace: 'ws-nowhere' })).rejects.toThrow(/foreign key/u);
  });

  it('refuses a coverage or maturity outside 0–100', async () => {
    await expect(insert({ coverage: 140 })).rejects.toThrow(/scan_snapshots_range_check/u);
    await expect(insert({ maturity: -1 })).rejects.toThrow(/scan_snapshots_range_check/u);
    await insert({ coverage: null });
  });

  it('keeps two workspaces’ readings apart, and drops a project’s history with it', async () => {
    await seed('ws-b');
    await insert({});
    await insert({ workspace: 'ws-b' });
    const mine = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM scan_snapshots WHERE workspace_id = $1',
      ['ws-a'],
    );
    expect(mine.rows.map((row) => row.workspace_id)).toEqual(['ws-a']);
    await client.query('DELETE FROM projects WHERE id = $1', [PROJECT]);
    const left = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM scan_snapshots',
    );
    expect(left.rows[0]?.count).toBe(0);
  });
});
