import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyAuditTrail } from './audit-verify.js';

/** `pnpm audit:verify` against the real migration graph, in an in-process PostgreSQL. */
const drizzleDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

async function migrated(): Promise<PGlite> {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const client = new PGlite();
  for (const entry of journal.entries.slice().sort((a, b) => a.idx - b.idx)) {
    const text = readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8');
    for (const statement of text.split('--> statement-breakpoint')) {
      if (statement.trim() !== '') await client.exec(statement);
    }
  }
  await client.exec(`
    INSERT INTO workspaces (id, name, config_path, created_at) VALUES ('ws-a', 'A', '.', now());
    INSERT INTO audit_events (timestamp, actor_id, actor_type, action, workspace_id, created_at)
      VALUES (now(), 'token:t', 'service', 'one', 'ws-a', now()),
             (now(), 'token:t', 'service', 'two', 'ws-a', now());
  `);
  return client;
}

const opened: PGlite[] = [];
afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

function io(client: PGlite) {
  const lines: { info: string[]; error: string[] } = { info: [], error: [] };
  return {
    lines,
    io: {
      query: async (text: string) => (await client.query<Record<string, unknown>>(text)).rows,
      info: (line: string) => lines.info.push(line),
      error: (line: string) => lines.error.push(line),
    },
  };
}

describe('audit:verify', () => {
  it('passes an intact trail and names each workspace’s head', async () => {
    const client = await migrated();
    opened.push(client);
    const { lines, io: seam } = io(client);
    expect(await verifyAuditTrail(seam)).toBe(0);
    expect(lines.info.join('\n')).toMatch(/ws-a — 2 row\(s\), head at 2/u);
  });

  it('fails on a row edited behind the append-only guard, naming it', async () => {
    const client = await migrated();
    opened.push(client);
    await client.exec(`
      ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
      UPDATE audit_events SET action = 'forged' WHERE action = 'one';
    `);
    const { lines, io: seam } = io(client);
    expect(await verifyAuditTrail(seam)).toBe(1);
    expect(lines.error).toEqual(['audit:verify: ws-a row 1 is edited']);
  });
});
