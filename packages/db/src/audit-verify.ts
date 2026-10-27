import pg from 'pg';
import { assertMigrationDatabaseUrl, isDirectInvocation } from './migrate.js';

/**
 * `pnpm audit:verify` — every break in every workspace's audit chain (ADR-014, enterprise).
 *
 * The check is `audit_chain_breaks` in `0050_audit_chain.sql`, so this, the API's
 * `GET /api/v1/audit/verify` and the integration suite all read one definition of an intact
 * chain. Exits 1 on a break, 2 when the database cannot be read, 0 on an intact trail.
 */
export interface AuditBreak {
  workspaceId: string;
  seq: number;
  problem: string;
}

export interface AuditVerifyIo {
  query: (text: string) => Promise<Array<Record<string, unknown>>>;
  info: (line: string) => void;
  error: (line: string) => void;
}

export async function verifyAuditTrail(io: AuditVerifyIo): Promise<0 | 1> {
  const rows = await io.query(
    `SELECT w.id AS workspace_id, b.seq::int AS seq, b.problem
       FROM workspaces w CROSS JOIN LATERAL audit_chain_breaks(w.id) b
      ORDER BY w.id, b.seq, b.problem`,
  );
  const heads = await io.query(
    `SELECT workspace_id, max(chain_seq)::int AS seq, count(*)::int AS rows
       FROM audit_events GROUP BY workspace_id ORDER BY workspace_id`,
  );
  for (const head of heads) {
    io.info(
      `audit:verify: ${String(head['workspace_id'])} — ${String(head['rows'])} row(s), head at ${String(head['seq'])}`,
    );
  }
  if (rows.length === 0) {
    io.info('audit:verify: every workspace chain is intact.');
    return 0;
  }
  for (const row of rows) {
    io.error(
      `audit:verify: ${String(row['workspace_id'])} row ${String(row['seq'])} is ${String(row['problem'])}`,
    );
  }
  return 1;
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  const url = process.env['DATABASE_URL'];
  try {
    assertMigrationDatabaseUrl(url);
  } catch (error) {
    console.error(`audit:verify: ${(error as Error).message}`);
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const code = await verifyAuditTrail({
      query: async (text) => (await client.query(text)).rows as Array<Record<string, unknown>>,
      info: (line) => console.info(line),
      error: (line) => console.error(line),
    });
    process.exitCode = code;
  } catch (error) {
    console.error(`audit:verify: could not read the audit trail: ${(error as Error).message}`);
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}
