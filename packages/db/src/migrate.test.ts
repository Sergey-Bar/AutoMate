import { describe, expect, it } from 'vitest';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertMigrationDatabaseUrl,
  describeJournalInconsistency,
  isDirectInvocation,
  listMigrationFiles,
  MIGRATION_ADVISORY_LOCK_KEY,
  migrationsFolderFor,
  runMigrations,
} from './migrate.js';

const VALID_URL = 'postgresql://user:pass@db.internal:5432/automate';

describe('a migration target is validated before anything is connected to', () => {
  it('accepts a Postgres URL and reports what it will change', () => {
    expect(assertMigrationDatabaseUrl(VALID_URL)).toEqual({
      host: 'db.internal',
      database: 'automate',
    });
    expect(assertMigrationDatabaseUrl(`  ${VALID_URL}  `).database).toBe('automate');
    expect(assertMigrationDatabaseUrl('postgres://localhost/automate').host).toBe('localhost');
  });

  it('refuses an absent URL rather than falling back to the PG* environment', () => {
    // The failure this prevents: an unset DATABASE_URL becomes the PG* defaults,
    // which on a developer machine point at *something*.
    expect(() => assertMigrationDatabaseUrl(undefined)).toThrow(/required for migrations/);
    expect(() => assertMigrationDatabaseUrl('   ')).toThrow(/required for migrations/);
  });

  it('refuses a URL it cannot parse, and says what one looks like', () => {
    expect(() => assertMigrationDatabaseUrl('not a url')).toThrow(/not a valid URL/);
    expect(() => assertMigrationDatabaseUrl('not a url')).toThrow(/postgresql:\/\//);
  });

  it('refuses a non-Postgres scheme and names the one it got', () => {
    expect(() => assertMigrationDatabaseUrl('mysql://localhost/automate')).toThrow(/not mysql:/);
  });

  it('refuses a URL that names no database', () => {
    expect(() => assertMigrationDatabaseUrl('postgresql://localhost:5432')).toThrow(
      /names no database/,
    );
  });

  it('decodes a percent-encoded database name rather than comparing the escape', () => {
    expect(assertMigrationDatabaseUrl('postgresql://localhost/auto%2Dmate').database).toBe(
      'auto-mate',
    );
  });
});

describe('the entry-point guard holds on every platform', () => {
  const moduleUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;

  it('is true for this very file, which is the case that was previously false on Windows', () => {
    expect(isDirectInvocation(fileURLToPath(import.meta.url), moduleUrl)).toBe(true);
  });

  it('is false for another module, and for no entry at all', () => {
    expect(
      isDirectInvocation(fileURLToPath(new URL('./client.ts', import.meta.url)), moduleUrl),
    ).toBe(false);
    expect(isDirectInvocation(undefined, moduleUrl)).toBe(false);
    expect(isDirectInvocation('', moduleUrl)).toBe(false);
  });

  it('is false rather than throwing for an entry that is not on disk', () => {
    // A loader shim or an eval'd module: the guard must answer, not explode, or the
    // CLI dies before it can print anything.
    expect(isDirectInvocation('does-not-exist.js', moduleUrl)).toBe(false);
  });
});

describe('journal consistency', () => {
  const files = ['0000_init.sql', '0001_execution.sql', '0002_dashboard.sql'];

  it('is consistent when the journal is a prefix of the folder', () => {
    // Two applied, one pending: the ordinary state before an apply.
    expect(describeJournalInconsistency(['a', 'b'], files)).toBeNull();
    expect(describeJournalInconsistency([], files)).toBeNull();
    expect(describeJournalInconsistency(['a', 'b', 'c'], files)).toBeNull();
  });

  it('refuses to apply when the database has migrations this build does not', () => {
    const finding = describeJournalInconsistency(['a', 'b', 'c', 'd'], files);
    expect(finding).not.toBeNull();
    expect(finding).toMatch(/4 migrations but this \n?checkout contains 3|satisfies/);
    expect(finding).toMatch(/schema and the code disagree/);
  });

  it('lists only the SQL migrations in a folder', () => {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const listed = listMigrationFiles(migrationsFolderFor(moduleDirectory));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((name) => name.endsWith('.sql'))).toBe(true);
    expect([...listed]).toEqual([...listed].sort());
  });
});

describe('applying migrations', () => {
  /**
   * A `pg.Pool` stand-in that records lock traffic and holds a queue, so the
   * advisory lock's ordering is observable without a database.
   */
  function fakePool() {
    const events: string[] = [];
    let held = false;
    const client = {
      query: async (sql: string) => {
        if (sql.includes('pg_advisory_lock')) {
          events.push(`lock:${held ? 'contended' : 'acquired'}`);
          held = true;
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_unlock')) {
          events.push('unlock');
          held = false;
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => events.push('release'),
    };
    return {
      events,
      client,
      pool: {
        connect: async () => client,
        query: client.query,
        end: async () => events.push('end'),
        // A real pool rejects a query while another client holds nothing; the
        // stand-in models the observable part only.
      } as never,
    };
  }

  it('takes and releases the advisory lock around the apply, on one connection', async () => {
    const fake = fakePool();
    await expect(
      runMigrations(VALID_URL, { pool: fake.pool, folder: 'no-such-folder' }),
    ).rejects.toThrow();

    expect(fake.events).toEqual(['lock:acquired', 'unlock', 'release']);
  });

  it('releases the lock even when the migration fails', async () => {
    const fake = fakePool();
    await expect(
      runMigrations(VALID_URL, { pool: fake.pool, folder: 'no-such-folder' }),
    ).rejects.toThrow();
    // Without the `finally`, a failed migration would leave the lock held and every
    // later apply in the session would block forever.
    expect(fake.events).toContain('unlock');
  });

  it('refuses to run at all when the target is invalid, without opening a connection', async () => {
    const fake = fakePool();
    await expect(runMigrations(undefined, { pool: fake.pool })).rejects.toThrow(
      /required for migrations/,
    );
    expect(fake.events).toEqual([]);
  });

  it('serialises two concurrent applies behind the same lock key', async () => {
    // The real property: the second apply cannot enter `migrate()` while the
    // first holds the key. Modelled by asserting both contend for one key value,
    // which is the only thing that makes that true against real Postgres.
    expect(typeof MIGRATION_ADVISORY_LOCK_KEY).toBe('bigint');
    expect(MIGRATION_ADVISORY_LOCK_KEY).toBeGreaterThan(0n);

    const first = fakePool();
    const second = fakePool();
    const lockParams: unknown[][] = [];
    for (const fake of [first, second]) {
      fake.client.query = async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_advisory_lock') && params !== undefined) lockParams.push(params);
        return { rows: [] };
      };
    }
    await Promise.allSettled([
      runMigrations(VALID_URL, { pool: first.pool, folder: 'no-such-folder' }),
      runMigrations(VALID_URL, { pool: second.pool, folder: 'no-such-folder' }),
    ]);
    expect(lockParams).toHaveLength(2);
    for (const params of lockParams) {
      expect(params[0]).toBe(MIGRATION_ADVISORY_LOCK_KEY.toString());
    }
  });

  it('does not end a pool it was handed', async () => {
    const fake = fakePool();
    await expect(
      runMigrations(VALID_URL, { pool: fake.pool, folder: 'no-such-folder' }),
    ).rejects.toThrow();
    expect(fake.events).not.toContain('end');
  });
});
