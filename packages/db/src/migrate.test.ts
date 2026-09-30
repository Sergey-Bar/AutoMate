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
    // The environment is cleared explicitly rather than assumed empty. This test
    // passes `undefined` and expects the guard, and with the documented default in
    // place an ambient `DATABASE_URL` would satisfy the guard instead — so the test
    // would start passing for the wrong reason on any developer machine that has one
    // set, which is a green test asserting nothing.
    const ambient = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    try {
      const fake = fakePool();
      await expect(runMigrations(undefined, { pool: fake.pool })).rejects.toThrow(
        /required for migrations/,
      );
      expect(fake.events).toEqual([]);
    } finally {
      if (ambient !== undefined) process.env['DATABASE_URL'] = ambient;
    }
  });

  it('defaults the target to DATABASE_URL, because the CLI entrypoint passes no argument', async () => {
    // The regression this test exists for, and the reason it is worth a test rather
    // than a one-word fix.
    //
    // `runMigrations` documents `connectionString` as "defaults to `DATABASE_URL`",
    // and the entrypoint calls `runMigrations()` with no argument at all. The body
    // passed the parameter straight to the guard with no default, so the guard
    // received `undefined` and threw "DATABASE_URL is required for migrations" — on a
    // run where `DATABASE_URL` was set. **`pnpm db:migrate` therefore failed every
    // time it was invoked**, with a message that named the very variable the process
    // had, and the error said the fallback would have been the `PG*` defaults, so the
    // message read as a missing environment variable rather than as a wiring bug.
    //
    // No test covered it because every test passed an explicit URL, and the entrypoint
    // guard (`isDirectInvocation`) is never true when a test imports the module.
    const ambient = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = VALID_URL;
    try {
      const fake = fakePool();
      // No first argument: exactly what the entrypoint does.
      await expect(runMigrations(undefined, { pool: fake.pool })).rejects.not.toThrow(
        /required for migrations/,
      );
      // It got far enough to take the lock, which is the observable proof that the
      // guard accepted the environment rather than rejecting an absent argument.
      expect(fake.events).toContain('lock:acquired');
    } finally {
      if (ambient === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = ambient;
    }
  });

  it('creates the journal before reading it, so a fresh database can be bootstrapped', async () => {
    // The second defect this file's migration work found, and the one that made the
    // first unobservable in practice.
    //
    // The runner reads the journal before calling drizzle's `migrate()`, because the
    // consistency check is the reason for reading it. But the read is a `SELECT`
    // against `drizzle.__drizzle_migrations`, which does not exist on a clean database —
    // so the read failed with `42P01` and `pnpm db:migrate` could not create a schema at
    // all. The compose file migrates before the API starts, so a clean
    // `docker compose up` hit the same wall.
    //
    // The assertion is on the *order*: the schema and table are created before the first
    // `SELECT` against the journal. Ordering is the whole property — creating them
    // afterwards would satisfy a weaker test and still not bootstrap anything.
    const statements: string[] = [];
    const client = {
      query: async (/** @type {string} */ text: string) => {
        statements.push(text);
        return { rows: [] };
      },
      release: () => undefined,
    };
    await runMigrations(VALID_URL, {
      pool: {
        connect: async () => client,
        end: async () => undefined,
      } as never,
      folder: 'no-such-folder',
    }).catch(() => {
      // drizzle's own `migrate()` rejects on a folder with no `_journal.json`, which is
      // what the other tests here lean on. The statements this test reads are all issued
      // before that point, and the ordering claim is about *those*, so the rejection is
      // expected rather than tolerated-and-ignored.
    });

    const createSchema = statements.findIndex((text) =>
      text.includes('CREATE SCHEMA IF NOT EXISTS'),
    );
    const firstRead = statements.findIndex((text) =>
      text.includes('FROM drizzle.__drizzle_migrations'),
    );
    assert.ok(
      createSchema !== -1,
      `the journal schema must be created; statements: ${statements.join(' | ')}`,
    );
    assert.ok(firstRead !== -1, `the journal must be read; statements: ${statements.join(' | ')}`);
    assert.ok(
      createSchema < firstRead,
      `the journal must be created before it is read; create at ${String(createSchema)}, read at ` +
        `${String(firstRead)}`,
    );
    assert.ok(
      statements.some((text) =>
        text.includes('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations'),
      ),
      'and the table itself must be created, not only the schema',
    );
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
