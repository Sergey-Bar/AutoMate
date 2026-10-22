import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  assertSchemaBuildIsFresh,
  readMigrationStateValues,
  readMigrations,
} from './migrations.js';

/**
 * The migration runner's own guards. Every other file in this package trusts it to apply
 * the real graph faithfully, so the ways it can refuse - a journal naming a file that is
 * not there, a file the journal does not name, a stale build - are asserted here against
 * small throwaway trees instead of the real `packages/db`.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeGraph(
  entries: Array<{ idx: number; tag: string }>,
  files: Record<string, string>,
): string {
  const directory = path.join(root, 'drizzle');
  mkdirSync(path.join(directory, 'meta'), { recursive: true });
  writeFileSync(path.join(directory, 'meta', '_journal.json'), JSON.stringify({ entries }));
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(directory, name), sql);
  return directory;
}

describe('readMigrations', () => {
  it('orders by the journal index, not by file name or journal position', () => {
    const directory = writeGraph(
      [
        { idx: 2, tag: '0002_c' },
        { idx: 0, tag: '0000_z' },
        { idx: 1, tag: '0001_a' },
      ],
      { '0000_z.sql': 'SELECT 0;', '0001_a.sql': 'SELECT 1;', '0002_c.sql': 'SELECT 2;' },
    );
    expect(readMigrations(directory)).toEqual([
      { index: 0, tag: '0000_z', sql: 'SELECT 0;' },
      { index: 1, tag: '0001_a', sql: 'SELECT 1;' },
      { index: 2, tag: '0002_c', sql: 'SELECT 2;' },
    ]);
  });

  it('refuses a journal entry whose file is missing, naming every missing tag', () => {
    const directory = writeGraph(
      [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0001_b' },
        { idx: 2, tag: '0002_c' },
      ],
      { '0000_a.sql': 'SELECT 1;' },
    );
    expect(() => readMigrations(directory)).toThrow(
      'Migration files missing for journal entries: 0001_b, 0002_c',
    );
  });

  it('refuses a SQL file the journal does not name, because no deploy would run it', () => {
    const directory = writeGraph([{ idx: 0, tag: '0000_a' }], {
      '0000_a.sql': 'SELECT 1;',
      '0001_orphan.sql': 'DROP TABLE x;',
      'README.md': 'not sql',
    });
    expect(() => readMigrations(directory)).toThrow(
      'Migration files with no journal entry, so no deploy would run them: 0001_orphan.sql',
    );
  });

  it('reads the real graph without complaint', () => {
    const migrations = readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((migration) => migration.index)).toEqual(
      migrations.map((_migration, position) => position),
    );
  });
});

describe('applyMigrations', () => {
  it('executes each statement on its own, in journal order, and returns the tags', async () => {
    const directory = writeGraph(
      [
        { idx: 1, tag: '0001_b' },
        { idx: 0, tag: '0000_a' },
      ],
      {
        '0000_a.sql':
          'CREATE TABLE a (id int);\n--> statement-breakpoint\n\n  \nCREATE INDEX i ON a (id);\n',
        '0001_b.sql': 'CREATE TABLE b (id int);',
      },
    );
    const executed: string[] = [];
    const client = {
      exec: async (statement: string) => {
        executed.push(statement);
        return [];
      },
    };
    expect(await applyMigrations(client, directory)).toEqual(['0000_a', '0001_b']);
    expect(executed).toEqual([
      'CREATE TABLE a (id int);',
      'CREATE INDEX i ON a (id);',
      'CREATE TABLE b (id int);',
    ]);
  });

  it('stops at the first statement that fails and reports nothing applied after it', async () => {
    const directory = writeGraph(
      [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0001_b' },
      ],
      { '0000_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 2;' },
    );
    const executed: string[] = [];
    const client = {
      exec: async (statement: string) => {
        executed.push(statement);
        if (statement === 'SELECT 1;') throw new Error('boom');
        return [];
      },
    };
    await expect(applyMigrations(client, directory)).rejects.toThrow('boom');
    expect(executed).toEqual(['SELECT 1;']);
  });
});

describe('assertSchemaBuildIsFresh', () => {
  function packageTree(): string {
    const packageRoot = path.join(root, 'db');
    mkdirSync(path.join(packageRoot, 'src', 'nested'), { recursive: true });
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    return packageRoot;
  }
  const touch = (file: string, whenSeconds: number): void => {
    writeFileSync(file, '');
    utimesSync(file, whenSeconds, whenSeconds);
  };

  it('says the build is missing, with the guidance, when dist/index.js does not exist', () => {
    const packageRoot = packageTree();
    expect(() => assertSchemaBuildIsFresh(packageRoot)).toThrow(
      /dist[\\/]index\.js does not exist\. These assertions compare/,
    );
  });

  it('passes when every source file is older than the build', () => {
    const packageRoot = packageTree();
    touch(path.join(packageRoot, 'src', 'a.ts'), 1_000);
    touch(path.join(packageRoot, 'src', 'nested', 'b.ts'), 1_000);
    touch(path.join(packageRoot, 'dist', 'index.js'), 2_000);
    expect(() => assertSchemaBuildIsFresh(packageRoot)).not.toThrow();
  });

  it('names how many sources are newer, and the first of them by path, at any depth', () => {
    const packageRoot = packageTree();
    touch(path.join(packageRoot, 'dist', 'index.js'), 2_000);
    touch(path.join(packageRoot, 'src', 'old.ts'), 1_000);
    touch(path.join(packageRoot, 'src', 'z.ts'), 3_000);
    touch(path.join(packageRoot, 'src', 'nested', 'a.ts'), 3_000);
    expect(() => assertSchemaBuildIsFresh(packageRoot)).toThrow(
      /packages\/db is not built: 2 source file\(s\) are newer than dist\/\. Newest: src\/nested\/a\.ts\./,
    );
  });

  it('ignores declaration files and non-TypeScript files, which a build does not read', () => {
    const packageRoot = packageTree();
    touch(path.join(packageRoot, 'dist', 'index.js'), 2_000);
    touch(path.join(packageRoot, 'src', 'types.d.ts'), 3_000);
    touch(path.join(packageRoot, 'src', 'notes.md'), 3_000);
    expect(() => assertSchemaBuildIsFresh(packageRoot)).not.toThrow();
  });

  it('is satisfied by the real packages/db once it has been built', () => {
    expect(() => assertSchemaBuildIsFresh()).not.toThrow();
  });
});

describe('readMigrationStateValues', () => {
  const clientReturning = (rows: Array<{ pg_get_constraintdef: string }>) => {
    const calls: unknown[][] = [];
    const client = {
      query: async (_sql: string, params: unknown[]) => {
        calls.push(params);
        return { rows };
      },
    } as unknown as PGlite;
    return { client, calls };
  };

  it('reads the quoted values out of the constraint PostgreSQL enforces', async () => {
    const { client, calls } = clientReturning([
      {
        pg_get_constraintdef:
          "CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'done_ok'::text])))",
      },
    ]);
    expect(await readMigrationStateValues(client, 'jobs', 'state')).toEqual([
      'queued',
      'running',
      'done_ok',
    ]);
    expect(calls).toEqual([['jobs', 'jobs_state_check']]);
  });

  it('fails loudly when the constraint is not there, rather than returning an empty list', async () => {
    const { client } = clientReturning([]);
    await expect(readMigrationStateValues(client, 'jobs', 'state')).rejects.toThrow(
      'jobs_state_check not found; the constraint is not enforced',
    );
  });

  it('returns no values for a constraint that quotes none', async () => {
    const { client } = clientReturning([{ pg_get_constraintdef: 'CHECK ((n > 0))' }]);
    expect(await readMigrationStateValues(client, 't', 'n')).toEqual([]);
  });
});
