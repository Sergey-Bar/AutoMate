import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './migrations.js';

/**
 * `0047_quarantine_lifecycle`: an approved entry can be released, and an entry can name its
 * project. The database holds `released` and `released_at` to each other.
 */
const opened: PGlite[] = [];
afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

async function migrated(): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  await applyMigrations(client);
  await client.exec(
    `INSERT INTO projects (id, workspace_id, name, slug, default_branch)
     VALUES ('11111111-1111-4111-8111-111111111111', 'default-workspace', 'p', 'p', 'main')`,
  );
  return client;
}

const insert = (status: string, releasedAt: string | null, projectId: string | null = null) =>
  `INSERT INTO quarantine (id, workspace_id, test_title, test_file, quarantined_at, status, released_at, project_id)
   VALUES ('q-${status}-${String(releasedAt !== null)}', 'default-workspace', 't', 'f', now(), '${status}',
           ${releasedAt === null ? 'NULL' : `'${releasedAt}'`}, ${projectId === null ? 'NULL' : `'${projectId}'`})`;

describe('0047_quarantine_lifecycle', () => {
  it('accepts a released entry with a release time, and nothing else for released_at', async () => {
    const client = await migrated();
    await client.exec(insert('released', '2026-10-26T00:00:00Z'));
    await client.exec(insert('approved', null));
    await expect(client.exec(insert('released', null))).rejects.toThrow(/released_at_check/u);
    await expect(client.exec(insert('approved', '2026-10-26T00:00:00Z'))).rejects.toThrow(
      /released_at_check/u,
    );
    await expect(client.exec(insert('expired', null))).rejects.toThrow(/status_check/u);
  });

  it("removes a project's entries with the project", async () => {
    const client = await migrated();
    await client.exec(insert('approved', null, '11111111-1111-4111-8111-111111111111'));
    await client.exec(`DELETE FROM projects WHERE id = '11111111-1111-4111-8111-111111111111'`);
    const rows = await client.query('SELECT id FROM quarantine');
    expect(rows.rows).toEqual([]);
  });
});
