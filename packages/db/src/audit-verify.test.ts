import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAuditVerify, verifyAuditTrail } from './audit-verify.js';

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

describe('the audit:verify command', () => {
  const URL_OK = 'postgres://automate@localhost:5432/automate';
  const log = () => {
    const lines: string[] = [];
    return {
      lines,
      log: { info: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    };
  };

  it('refuses to run with no database named, before connecting to anything', async () => {
    const open = vi.fn();
    const { lines, log: sink } = log();
    expect(await runAuditVerify(undefined, open, sink)).toBe(2);
    expect(open).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/^audit:verify: /u);
  });

  it('reads the trail through the client it opened, and closes it', async () => {
    const client = await migrated();
    opened.push(client);
    const end = vi.fn(async () => undefined);
    const { lines, log: sink } = log();
    const code = await runAuditVerify(
      URL_OK,
      () => ({
        connect: async () => undefined,
        query: async (text) => ({ rows: (await client.query(text)).rows }),
        end,
      }),
      sink,
    );
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe('audit:verify: every workspace chain is intact.');
    expect(end).toHaveBeenCalledOnce();
  });

  it('reports a database it cannot read as 2, not as an intact trail', async () => {
    const { lines, log: sink } = log();
    const code = await runAuditVerify(
      URL_OK,
      () => ({
        connect: async () => {
          throw new Error('connection refused');
        },
        query: async () => ({ rows: [] }),
        end: async () => {
          throw new Error('not connected');
        },
      }),
      sink,
    );
    expect(code).toBe(2);
    expect(lines).toEqual(['audit:verify: could not read the audit trail: connection refused']);
  });
});
