import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { parseArgs, run } from './cli.js';
import { createPlan, writePlan } from './engine.js';

// `migrate.ts` imports `{ Pool }` and `postgres-catalog.ts` imports the default
// export, so the stand-in serves both shapes. No test here reaches a real server.
const pgMock = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn();
  const Pool = vi.fn().mockImplementation(function Pool() {
    return { query, end };
  });
  return { query, end, Pool };
});

vi.mock('pg', () => ({ default: { Pool: pgMock.Pool }, Pool: pgMock.Pool }));

const TARGET = 'postgres://user:pass@localhost:5432/automate';

let directory: string;
let savedExitCode: typeof process.exitCode;
let stderr: MockInstance<typeof console.error>;
let stdout: MockInstance<typeof console.info>;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'automate-cli-'));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  stdout = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  pgMock.query.mockReset();
  pgMock.end.mockReset();
  pgMock.Pool.mockClear();
  pgMock.end.mockResolvedValue(undefined);
});

afterEach(() => {
  process.exitCode = savedExitCode;
  stderr.mockRestore();
  stdout.mockRestore();
  rmSync(directory, { recursive: true, force: true });
});

function sqliteSource(name: string, sql: string): string {
  const file = path.join(directory, name);
  const database = new Database(file);
  database.exec(sql);
  database.close();
  return file;
}

const KNOWN_FAILURES_SQL = `
  CREATE TABLE known_failures (
    id TEXT PRIMARY KEY, test_title TEXT, test_file TEXT, comment TEXT,
    created_at TEXT, created_by TEXT
  );
  INSERT INTO known_failures VALUES ('k1', 't', 'f.spec.ts', NULL, '2026-01-01', 'qa');
`;

function validPlanFile(): { source: string; plan: string } {
  const source = sqliteSource('source.db', KNOWN_FAILURES_SQL);
  const plan = path.join(directory, 'plan.json');
  writePlan(
    plan,
    createPlan({ source, sourceId: 'src', sourceCommit: 'aaa', targetCommit: 'bbb' }),
  );
  return { source, plan };
}

/** The single message `run` printed, and the exit code it left behind. */
function outcome(): { error: string | undefined; exitCode: typeof process.exitCode } {
  expect(stderr.mock.calls.length).toBeLessThanOrEqual(1);
  const first = stderr.mock.calls[0]?.[0];
  return { error: first === undefined ? undefined : String(first), exitCode: process.exitCode };
}

describe('parseArgs', () => {
  it('maps every flag to its option and defaults dryRun to false', () => {
    expect(
      parseArgs([
        'plan',
        '--from',
        'a.db',
        '--to',
        'pg://x',
        '--out',
        'o.json',
        '--source-id',
        'sid',
        '--source-commit',
        'sc',
        '--target-commit',
        'tc',
        '--plan',
        'p.json',
      ]),
    ).toEqual({
      command: 'plan',
      from: 'a.db',
      to: 'pg://x',
      out: 'o.json',
      sourceId: 'sid',
      sourceCommit: 'sc',
      targetCommit: 'tc',
      plan: 'p.json',
      dryRun: false,
    });
  });

  it('treats --dry-run as a valueless switch anywhere in the list', () => {
    expect(parseArgs(['apply', '--dry-run', '--plan', 'p.json'])).toEqual({
      command: 'apply',
      plan: 'p.json',
      dryRun: true,
    });
    expect(parseArgs(['apply', '--plan', 'p.json', '--dry-run']).dryRun).toBe(true);
  });

  it.each([[[]], [['migrate']], [['--plan', 'p.json']], [['PLAN']]])(
    'refuses %j with the usage line',
    (argv: string[]) => {
      expect(() => parseArgs(argv)).toThrow('Usage: migrate plan|apply|validate|verify');
    },
  );

  it('refuses a flag at the end of the list with no value', () => {
    expect(() => parseArgs(['validate', '--plan'])).toThrow('Missing value for --plan');
  });

  it('refuses a flag whose value would be the next flag', () => {
    expect(() => parseArgs(['verify', '--from', '--to', 'pg://x'])).toThrow(
      'Missing value for --from',
    );
  });

  it('refuses an unknown flag by name', () => {
    expect(() => parseArgs(['validate', '--force', 'yes'])).toThrow('Unknown argument: --force');
  });

  it('reads --workspace, the tenant every imported row belongs to (ledger MNT-17)', () => {
    expect(parseArgs(['apply', '--plan', 'p.json', '--workspace', 'ws-1']).workspace).toBe('ws-1');
    expect(parseArgs(['apply', '--plan', 'p.json']).workspace).toBeUndefined();
  });
});

describe('run', () => {
  it('prints the usage line and sets exit code 1 for an unknown command', async () => {
    await run(['explode']);
    expect(outcome()).toEqual({
      error: 'Usage: migrate plan|apply|validate|verify',
      exitCode: 1,
    });
  });

  it('reports argument errors through stderr rather than rejecting', async () => {
    await expect(run(['validate', '--bogus', 'x'])).resolves.toBeUndefined();
    expect(outcome()).toEqual({ error: 'Unknown argument: --bogus', exitCode: 1 });
  });

  describe('plan', () => {
    it.each([
      ['--from', 'a.db'],
      ['--source-id', 'sid'],
      ['--source-commit', 'sc'],
      ['--target-commit', 'tc'],
      ['--out', 'o.json'],
    ])('refuses when %s is the only missing argument', async (missing) => {
      const all: Record<string, string> = {
        '--from': 'a.db',
        '--source-id': 'sid',
        '--source-commit': 'sc',
        '--target-commit': 'tc',
        '--out': 'o.json',
      };
      const argv = [
        'plan',
        ...Object.entries(all).flatMap(([k, v]) => (k === missing ? [] : [k, v])),
      ];
      await run(argv);
      expect(outcome()).toEqual({
        error: 'plan requires --from, --source-id, --source-commit, --target-commit, and --out',
        exitCode: 1,
      });
    });

    it('writes a plan file describing the source catalog', async () => {
      const source = sqliteSource('source.db', KNOWN_FAILURES_SQL);
      const out = path.join(directory, 'written.json');
      await run([
        'plan',
        '--from',
        source,
        '--source-id',
        'legacy-1',
        '--source-commit',
        'abc',
        '--target-commit',
        'def',
        '--out',
        out,
      ]);
      expect(outcome()).toEqual({ error: undefined, exitCode: undefined });
      const written = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
      expect(written).toMatchObject({
        planVersion: 1,
        sourceId: 'legacy-1',
        sourceCommit: 'abc',
        targetCommit: 'def',
        tables: [{ name: 'known_failures', rowCount: 1, disposition: 'migrate' }],
      });
    });
  });

  describe('validate', () => {
    it('refuses without --plan and points at db:check for the journal', async () => {
      await run(['validate']);
      expect(outcome()).toEqual({
        error:
          'validate requires --plan <file>: it checks a plan written by migrate plan. ' +
          'To check the migration journal against the schema, run pnpm db:check.',
        exitCode: 1,
      });
    });

    it('accepts a plan written by the engine', async () => {
      const { plan } = validPlanFile();
      await run(['validate', '--plan', plan]);
      expect(outcome()).toEqual({ error: undefined, exitCode: undefined });
    });

    it('rejects a plan that contains a blocked table', async () => {
      const source = sqliteSource('blocked.db', 'CREATE TABLE users (id TEXT PRIMARY KEY)');
      const plan = path.join(directory, 'blocked.json');
      writePlan(plan, createPlan({ source, sourceId: 's', sourceCommit: 'a', targetCommit: 'b' }));
      await run(['validate', '--plan', plan]);
      expect(outcome()).toEqual({ error: 'Plan contains blocked tables', exitCode: 1 });
    });

    it('rejects a plan whose version has been altered', async () => {
      const { plan } = validPlanFile();
      const parsed = JSON.parse(readFileSync(plan, 'utf8')) as Record<string, unknown>;
      writeFileSync(plan, JSON.stringify({ ...parsed, planVersion: 2 }), 'utf8');
      await run(['validate', '--plan', plan]);
      expect(outcome()).toEqual({ error: 'Unsupported migration plan version', exitCode: 1 });
    });

    it('reports a plan file that is not JSON', async () => {
      const plan = path.join(directory, 'garbage.json');
      writeFileSync(plan, 'not json', 'utf8');
      await run(['validate', '--plan', plan]);
      const { error, exitCode } = outcome();
      expect(exitCode).toBe(1);
      expect(error).toMatch(/JSON/);
    });
  });

  describe('apply', () => {
    it.each([
      [['apply', '--to', TARGET, '--plan', 'p.json']],
      [['apply', '--from', 'a.db', '--plan', 'p.json']],
      [['apply', '--from', 'a.db', '--to', TARGET]],
    ])('refuses %j for a missing required argument', async (argv: string[]) => {
      await run(argv);
      expect(outcome()).toEqual({
        error: 'apply requires --from, --to, and --plan',
        exitCode: 1,
      });
    });

    it('refuses to write without --dry-run, even with a valid plan', async () => {
      const { source, plan } = validPlanFile();
      await run(['apply', '--from', source, '--to', TARGET, '--plan', plan]);
      expect(outcome()).toEqual({
        error:
          'Migration apply is blocked until the resumable wave engine and restore verification are enabled',
        exitCode: 1,
      });
      expect(pgMock.Pool).not.toHaveBeenCalled();
    });

    it('validates the plan before considering --dry-run', async () => {
      const source = sqliteSource('blocked.db', 'CREATE TABLE users (id TEXT PRIMARY KEY)');
      const plan = path.join(directory, 'blocked.json');
      writePlan(plan, createPlan({ source, sourceId: 's', sourceCommit: 'a', targetCommit: 'b' }));
      await run(['apply', '--dry-run', '--from', source, '--to', TARGET, '--plan', plan]);
      expect(outcome()).toEqual({ error: 'Plan contains blocked tables', exitCode: 1 });
    });

    it('prints the dry-run plan and never opens a PostgreSQL pool', async () => {
      const { source, plan } = validPlanFile();
      await run(['apply', '--dry-run', '--from', source, '--to', TARGET, '--plan', plan]);
      expect(outcome()).toEqual({ error: undefined, exitCode: undefined });
      expect(stdout.mock.calls.map((call) => call[0])).toEqual([
        'Dry run migration plan:',
        'known_failures: 1 row',
      ]);
      expect(pgMock.Pool).not.toHaveBeenCalled();
    });

    it('accepts --workspace on a dry run and still opens no pool', async () => {
      const { source, plan } = validPlanFile();
      await run([
        'apply',
        '--dry-run',
        '--from',
        source,
        '--to',
        TARGET,
        '--plan',
        plan,
        '--workspace',
        'ws-1',
      ]);
      expect(outcome()).toEqual({ error: undefined, exitCode: undefined });
      expect(pgMock.Pool).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    function targetCounts(counts: Record<string, number>): void {
      pgMock.query.mockImplementation((sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return Promise.resolve({
            rows: Object.keys(counts).map((tableName) => ({ table_name: tableName })),
          });
        }
        const table = /FROM "([^"]+)"/.exec(sql)?.[1] ?? '';
        return Promise.resolve({ rows: [{ count: String(counts[table] ?? 0) }] });
      });
    }

    it.each([
      [['verify', '--to', TARGET, '--plan', 'p.json']],
      [['verify', '--from', 'a.db', '--plan', 'p.json']],
      [['verify', '--from', 'a.db', '--to', TARGET]],
    ])('refuses %j for a missing required argument', async (argv: string[]) => {
      await run(argv);
      expect(outcome()).toEqual({
        error: 'verify requires --from, --to, and --plan',
        exitCode: 1,
      });
    });

    it('reports a failure that is not an Error by its text and sets the exit code', async () => {
      const { source, plan } = validPlanFile();
      pgMock.query.mockRejectedValue('connection refused');
      await run(['verify', '--from', source, '--to', TARGET, '--plan', plan]);
      expect(outcome()).toEqual({ error: 'connection refused', exitCode: 1 });
    });
    it('passes when every source table count matches the target', async () => {
      const { source, plan } = validPlanFile();
      targetCounts({ known_failures: 1 });
      await run(['verify', '--from', source, '--to', TARGET, '--plan', plan]);
      expect(outcome()).toEqual({ error: undefined, exitCode: undefined });
      expect(stdout).toHaveBeenCalledWith('Migration reconciliation passed');
      expect(pgMock.Pool).toHaveBeenCalledWith({ connectionString: TARGET });
      expect(pgMock.end).toHaveBeenCalledOnce();
    });

    it('fails naming each table whose counts differ', async () => {
      const { source, plan } = validPlanFile();
      targetCounts({ known_failures: 0, runs: 3 });
      await run(['verify', '--from', source, '--to', TARGET, '--plan', plan]);
      expect(outcome()).toEqual({
        error: 'Reconciliation failed: known_failures: source=1 target=0; runs: source=0 target=3',
        exitCode: 1,
      });
      expect(stdout).not.toHaveBeenCalledWith('Migration reconciliation passed');
    });
  });
});

describe('index entry point', () => {
  it('hands process.argv after the script path to run', async () => {
    vi.resetModules();
    const runSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./cli.js', () => ({ run: runSpy }));
    const savedArgv = process.argv;
    process.argv = ['node', 'migrate', 'validate', '--plan', 'x.json'];
    try {
      await import('./index.js');
    } finally {
      process.argv = savedArgv;
      vi.doUnmock('./cli.js');
    }
    expect(runSpy).toHaveBeenCalledExactlyOnceWith(['validate', '--plan', 'x.json']);
  });
});
