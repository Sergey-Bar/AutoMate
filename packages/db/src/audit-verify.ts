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

/** The part of `pg.Client` the command uses, so a test can stand in for the database. */
export interface AuditVerifyClient {
  connect: () => Promise<unknown>;
  query: (text: string) => Promise<{ rows: unknown[] }>;
  end: () => Promise<unknown>;
}

/**
 * The command: refuses a missing or unusable `DATABASE_URL` (2), reads the trail (0 or 1), and
 * reports a database it cannot read as 2 rather than as an intact trail.
 */
export async function runAuditVerify(
  url: string | undefined,
  open: (connectionString: string) => AuditVerifyClient,
  log: Pick<Console, 'info' | 'error'> = console,
): Promise<0 | 1 | 2> {
  try {
    assertMigrationDatabaseUrl(url);
  } catch (error) {
    log.error(`audit:verify: ${(error as Error).message}`);
    return 2;
  }
  const client = open(url as string);
  try {
    await client.connect();
    return await verifyAuditTrail({
      query: async (text) => (await client.query(text)).rows as Array<Record<string, unknown>>,
      info: (line) => log.info(line),
      error: (line) => log.error(line),
    });
  } catch (error) {
    log.error(`audit:verify: could not read the audit trail: ${(error as Error).message}`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  process.exitCode = await runAuditVerify(
    process.env['DATABASE_URL'],
    (connectionString) => new pg.Client({ connectionString }),
  );
}
