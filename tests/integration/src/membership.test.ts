import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0049_workspace_members`: people, and which workspaces they belong to (ADR-014, team).
 *
 * Additive only. `users` gains the identity a sign-in names (`issuer` + `subject`), and two
 * workspace-scoped tables arrive with the hard boundary from the first migration: a
 * membership per person per workspace, and an invitation that is stored only as a hash.
 * A session may now belong to a person. Nothing existing is rewritten.
 */
const TAG = '0049_workspace_members';
const opened: PGlite[] = [];
afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

function statements(migration: Migration): string[] {
  return migration.sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function migrated(): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  let found = false;
  for (const migration of readMigrations()) {
    for (const statement of statements(migration)) await client.exec(statement);
    if (migration.tag === TAG) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`${TAG} is missing`);
  await client.exec(`
    INSERT INTO workspaces (id, name, config_path, created_at)
      VALUES ('ws-a', 'A', '.', now()), ('ws-b', 'B', '.', now());
    INSERT INTO users (id, email, display_name, created_at, updated_at, issuer, subject)
      VALUES ('00000000-0000-4000-8000-0000000000a1', 'ana@example.com', 'Ana', now(), now(),
              'https://idp.example.com', 'sub-ana');
  `);
  return client;
}

const ANA = '00000000-0000-4000-8000-0000000000a1';

async function refused(client: PGlite, sql: string): Promise<string> {
  try {
    await client.exec(sql);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected a refusal: ${sql}`);
}

describe('0049_workspace_members', () => {
  it('names one identity once: issuer and subject together are unique', async () => {
    const client = await migrated();
    expect(
      await refused(
        client,
        `INSERT INTO users (email, display_name, created_at, updated_at, issuer, subject)
           VALUES ('other@example.com', 'O', now(), now(), 'https://idp.example.com', 'sub-ana')`,
      ),
    ).toMatch(/users_issuer_subject_idx/u);
    // The same subject at another issuer is another person.
    await client.exec(
      `INSERT INTO users (email, display_name, created_at, updated_at, issuer, subject)
         VALUES ('ana@other.example', 'A2', now(), now(), 'https://other.example', 'sub-ana')`,
    );
  });

  it('gives a person one role per workspace, from the three the guards know', async () => {
    const client = await migrated();
    await client.exec(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-a', '${ANA}', 'operator')`,
    );
    expect(
      await refused(
        client,
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-a', '${ANA}', 'admin')`,
      ),
    ).toMatch(/workspace_members_pkey|duplicate/u);
    expect(
      await refused(
        client,
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-b', '${ANA}', 'editor')`,
      ),
    ).toMatch(/workspace_members_role_check/u);
    // A second workspace is a second membership, with its own role.
    await client.exec(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-b', '${ANA}', 'viewer')`,
    );
  });

  it('holds the hard boundary: no membership or invitation without a workspace', async () => {
    const client = await migrated();
    expect(
      await refused(
        client,
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('nowhere', '${ANA}', 'viewer')`,
      ),
    ).toMatch(/workspace_members_workspace_id_workspaces_id_fk/u);
    expect(
      await refused(
        client,
        `INSERT INTO invitations (workspace_id, email, role, token_hash, created_by, expires_at)
           VALUES ('nowhere', 'bo@example.com', 'viewer', 'h1', 'session', now())`,
      ),
    ).toMatch(/invitations_workspace_id_workspaces_id_fk/u);
    // `restrict`: a workspace with members cannot be deleted out from under them.
    await client.exec(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-a', '${ANA}', 'viewer')`,
    );
    expect(await refused(client, `DELETE FROM workspaces WHERE id = 'ws-a'`)).toMatch(
      /workspace_members_workspace_id_workspaces_id_fk/u,
    );
  });

  it('removes a person’s memberships and sessions with the person', async () => {
    const client = await migrated();
    await client.exec(`
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-a', '${ANA}', 'viewer');
      INSERT INTO installations (id) VALUES ('00000000-0000-4000-8000-0000000000f1');
      INSERT INTO sessions (installation_id, token_hash, expires_at, user_id)
        VALUES ('00000000-0000-4000-8000-0000000000f1', 'th', now() + interval '1 hour', '${ANA}');
      DELETE FROM users WHERE id = '${ANA}';
    `);
    const left = await client.query<{ members: number; sessions: number }>(
      `SELECT (SELECT count(*)::int FROM workspace_members) AS members,
              (SELECT count(*)::int FROM sessions) AS sessions`,
    );
    expect(left.rows[0]).toEqual({ members: 0, sessions: 0 });
  });

  it('stores an invitation once, as a hash, with the roles the guards know', async () => {
    const client = await migrated();
    const insert = (hash: string, role = 'viewer') =>
      `INSERT INTO invitations (workspace_id, email, role, token_hash, created_by, expires_at)
         VALUES ('ws-a', 'bo@example.com', '${role}', '${hash}', 'session', now() + interval '7 days')`;
    await client.exec(insert('h1'));
    expect(await refused(client, insert('h1'))).toMatch(/invitations_token_hash_idx/u);
    expect(await refused(client, insert('h2', 'uploader'))).toMatch(/invitations_role_check/u);
  });

  it('keeps every session that existed before it, as the installation’s', async () => {
    const client = await migrated();
    const columns = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'user_id'`,
    );
    expect(columns.rows).toEqual([{ is_nullable: 'YES' }]);
  });
});
