import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

type MockBridge = {
  broadcast: ReturnType<typeof vi.fn>;
  addClient: ReturnType<typeof vi.fn>;
  handleReporterEvent: ReturnType<typeof vi.fn>;
};

type PseudoPtyProcess = {
  pid: number;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

type ChildProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
};

const dbState = vi.hoisted(() => ({
  db: undefined as unknown,
  sqlite: undefined as unknown,
}));

const ptyState = vi.hoisted(() => ({
  throwOnSpawn: false,
  lastSpawnArgs: undefined as unknown,
  lastProcess: undefined as unknown,
  onDataHandler: undefined as ((chunk: string) => void) | undefined,
  onExitHandler: undefined as ((payload: { exitCode: number }) => void) | undefined,
}));

const childState = vi.hoisted(() => ({
  spawnSyncResult: {
    stdout: JSON.stringify({ suites: [{ title: 'spec.ts' }] }),
    stderr: '',
  },
  lastSpawnArgs: undefined as unknown,
  lastProcess: undefined as ChildProc | undefined,
}));

vi.mock('../../db/client.js', () => ({
  get db() { return dbState.db; },
  get sqlite() { return dbState.sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = dbState.sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn((...args: unknown[]) => {
      if (ptyState.throwOnSpawn) {
        throw new Error('node-pty unavailable');
      }

      const proc: PseudoPtyProcess = {
        pid: 12345,
        onData: vi.fn((handler: (chunk: string) => void) => {
          ptyState.onDataHandler = handler;
        }),
        onExit: vi.fn((handler: (payload: { exitCode: number }) => void) => {
          ptyState.onExitHandler = handler;
        }),
        kill: vi.fn(),
      };

      ptyState.lastSpawnArgs = args;
      ptyState.lastProcess = proc;
      return proc;
    }),
  },
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => childState.spawnSyncResult),
  spawn: vi.fn((...args: unknown[]) => {
    const proc = new EventEmitter() as ChildProc;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = 99999;
    proc.kill = vi.fn();

    childState.lastSpawnArgs = args;
    childState.lastProcess = proc;

    return proc;
  }),
}));

function pushRunnerSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      flaky INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      branch TEXT,
      commit_sha TEXT,
      commit_message TEXT,
      triggered_by TEXT DEFAULT 'manual',
      config TEXT,
      raw_args TEXT,
      source TEXT NOT NULL DEFAULT 'live',
      gate_status TEXT,
      workspace_id TEXT,
      pr_number INTEGER,
      pr_branch TEXT,
      base_branch TEXT,
      commit_author TEXT
    );

    CREATE TABLE quarantine (
      id TEXT PRIMARY KEY,
      test_title TEXT NOT NULL,
      test_file TEXT NOT NULL,
      reason TEXT,
      quarantined_at TEXT NOT NULL,
      quarantined_by TEXT DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'approved',
      flakiness_category TEXT,
      category_confidence REAL,
      category_evidence TEXT,
      resolved_at TEXT,
      resolution_type TEXT,
      ttf_ms INTEGER
    );
  `);
}

function createBridge(): MockBridge {
  return {
    broadcast: vi.fn(),
    addClient: vi.fn(),
    handleReporterEvent: vi.fn(),
  };
}

function getRunRow(sqlite: Database.Database, runId: string): {
  id: string;
  status: string;
  finished_at: string | null;
  raw_args: string;
} {
  return sqlite
    .prepare('SELECT id, status, finished_at, raw_args FROM runs WHERE id = ?')
    .get(runId) as {
    id: string;
    status: string;
    finished_at: string | null;
    raw_args: string;
  };
}

function getOptionValues(args: string[], option: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === option) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

function escapeForGrepInvert(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadRunnerModule() {
  vi.resetModules();
  return import('../runner.js');
}

describe('runner (full)', () => {
  let testSqlite: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();

    testSqlite = new Database(':memory:');
    testSqlite.pragma('foreign_keys = ON');
    pushRunnerSchema(testSqlite);

    dbState.sqlite = testSqlite;
    dbState.db = drizzle(testSqlite, { schema });

    ptyState.throwOnSpawn = false;
    ptyState.lastSpawnArgs = undefined;
    ptyState.lastProcess = undefined;
    ptyState.onDataHandler = undefined;
    ptyState.onExitHandler = undefined;

    childState.spawnSyncResult = {
      stdout: JSON.stringify({ suites: [{ title: 'spec.ts' }] }),
      stderr: '',
    };
    childState.lastSpawnArgs = undefined;
    childState.lastProcess = undefined;
  });

  afterEach(() => {
    testSqlite.close();
  });

  describe('listTests', () => {
    it('returns parsed JSON from spawnSync stdout', async () => {
      const { runner } = await loadRunnerModule();
      const result = await runner.listTests();

      expect(result).toEqual({ suites: [{ title: 'spec.ts' }] });

      const child = await import('child_process');
      expect(vi.mocked(child.spawnSync)).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'test', '--list', '--reporter=json'],
        expect.objectContaining({
          encoding: 'utf-8',
          cwd: process.cwd(),
          env: expect.objectContaining({ FORCE_COLOR: '0' }),
        }),
      );
    });

    it('returns fallback errors object on invalid JSON output', async () => {
      childState.spawnSyncResult = {
        stdout: 'not-json',
        stderr: 'playwright list failed',
      };

      const { runner } = await loadRunnerModule();
      const result = await runner.listTests();

      expect(result).toEqual({ suites: [], errors: ['playwright list failed'] });
    });

    it('passes --config when config path is provided', async () => {
      const { runner } = await loadRunnerModule();
      await runner.listTests('custom.config.ts');

      const child = await import('child_process');
      expect(vi.mocked(child.spawnSync)).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'test', '--list', '--reporter=json', '--config', 'custom.config.ts'],
        expect.any(Object),
      );
    });
  });

  describe('startRun PTY path', () => {
    it('creates running DB record, spawns pty, streams stdout, and marks passed on exit code 0', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      const runId = await runner.startRun({}, bridge as never);

      expect(runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(runner.isRunning(runId)).toBe(true);

      const row = getRunRow(testSqlite, runId);
      expect(row.status).toBe('running');
      expect(row.raw_args).toContain('--screenshot=only-on-failure');
      expect(row.raw_args).toContain('--reporter=');

      const [cmd, args, options] = ptyState.lastSpawnArgs as [string, string[], { env: Record<string, string> }];
      expect(cmd).toBe('npx');
      expect(args).toEqual(expect.arrayContaining(['playwright', 'test']));
      expect(options.env.DASHBOARD_RUN_ID).toBe(runId);

      ptyState.onDataHandler?.('chunk-one');
      expect(bridge.broadcast).toHaveBeenCalledWith({
        type: 'stdout',
        runId,
        payload: { chunk: 'chunk-one' },
      });

      ptyState.onExitHandler?.({ exitCode: 0 });
      const afterExit = getRunRow(testSqlite, runId);
      expect(afterExit.status).toBe('passed');
      expect(afterExit.finished_at).toBeTruthy();
      expect(runner.isRunning(runId)).toBe(false);
    });

    it('marks run failed on pty exit code 1', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      const runId = await runner.startRun({}, bridge as never);
      ptyState.onExitHandler?.({ exitCode: 1 });

      const row = getRunRow(testSqlite, runId);
      expect(row.status).toBe('failed');
      expect(runner.isRunning(runId)).toBe(false);
    });
  });

  describe('startRun fallback path', () => {
    it('falls back to child_process.spawn when node-pty throws and streams stdout/stderr', async () => {
      ptyState.throwOnSpawn = true;

      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      const runId = await runner.startRun({ workers: 2 }, bridge as never);
      expect(runId).toBeTypeOf('string');
      expect(runner.isRunning(runId)).toBe(true);

      const child = await import('child_process');
      expect(vi.mocked(child.spawn)).toHaveBeenCalledTimes(1);

      const [cmd, args, options] = childState.lastSpawnArgs as [string, string[], { env: Record<string, string>; shell: boolean }];
      expect(cmd).toBe('npx');
      expect(args).toEqual(expect.arrayContaining(['playwright', 'test', '--workers', '2']));
      expect(options.shell).toBe(false);
      expect(options.env.DASHBOARD_RUN_ID).toBe(runId);

      childState.lastProcess?.stdout.emit('data', Buffer.from('out-data'));
      childState.lastProcess?.stderr.emit('data', Buffer.from('err-data'));
      expect(bridge.broadcast).toHaveBeenCalledWith({
        type: 'stdout',
        runId,
        payload: { chunk: 'out-data' },
      });
      expect(bridge.broadcast).toHaveBeenCalledWith({
        type: 'stderr',
        runId,
        payload: { chunk: 'err-data' },
      });

      childState.lastProcess?.emit('close', 0);
      expect(runner.isRunning(runId)).toBe(false);
    });
  });

  describe('startRun buildArgs via spawn arguments', () => {
    it('builds CLI args for full option set', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      await runner.startRun(
        {
          projects: ['chromium', 'firefox'],
          grep: 'login',
          workers: 4,
          retries: 2,
          headed: true,
          trace: 'on',
          shard: { current: 1, total: 3 },
          timeout: 30000,
          maxFailures: 5,
          lastFailed: true,
          updateSnapshots: true,
          tags: ['smoke', 'fast'],
          configPath: 'custom.config.ts',
        },
        bridge as never,
      );

      const [, args] = ptyState.lastSpawnArgs as [string, string[]];
      expect(args).toEqual(expect.arrayContaining(['--config', 'custom.config.ts']));
      expect(args).toEqual(expect.arrayContaining(['--workers', '4']));
      expect(args).toEqual(expect.arrayContaining(['--retries', '2']));
      expect(args).toEqual(expect.arrayContaining(['--headed']));
      expect(args).toEqual(expect.arrayContaining(['--trace', 'on']));
      expect(args).toEqual(expect.arrayContaining(['--shard', '1/3']));
      expect(args).toEqual(expect.arrayContaining(['--timeout', '30000']));
      expect(args).toEqual(expect.arrayContaining(['--max-failures', '5']));
      expect(args).toEqual(expect.arrayContaining(['--last-failed']));
      expect(args).toEqual(expect.arrayContaining(['--update-snapshots']));
      expect(args).toEqual(expect.arrayContaining(['--project', 'chromium']));
      expect(args).toEqual(expect.arrayContaining(['--project', 'firefox']));
      expect(args).toEqual(expect.arrayContaining(['--screenshot=only-on-failure']));
      expect(args.some((a) => a.startsWith('--reporter='))).toBe(true);

      const grepValues = getOptionValues(args, '--grep');
      // grep + tags combined into single argument
      expect(grepValues).toEqual(['login|@smoke|@fast']);
    });

    it('combines grep and tags into a single --grep argument', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      await runner.startRun(
        {
          grep: 'login',
          tags: ['smoke'],
        },
        bridge as never,
      );

      const [, args] = ptyState.lastSpawnArgs as [string, string[]];
      const grepValues = getOptionValues(args, '--grep');
      // Should be a single combined --grep, not two separate ones
      expect(grepValues).toEqual(['login|@smoke']);
    });

    it('adds --list and omits screenshot when dryRun is true', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      await runner.startRun({ dryRun: true }, bridge as never);

      const [, args] = ptyState.lastSpawnArgs as [string, string[]];
      expect(args).toContain('--list');
      expect(args).not.toContain('--screenshot=only-on-failure');
    });
  });

  describe('startRun quarantine grep-invert', () => {
    it('adds escaped --grep-invert pattern when quarantine has entries', async () => {
      const titleA = 'flaky (login)+ [smoke]?';
      const titleB = 'api|health^check$';

      testSqlite
        .prepare(
          'INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES (?, ?, ?, ?)',
        )
        .run(randomUUID(), titleA, 'a.spec.ts', '2023-11-14T22:13:20.000Z');
      testSqlite
        .prepare(
          'INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES (?, ?, ?, ?)',
        )
        .run(randomUUID(), titleB, 'b.spec.ts', '2023-11-14T22:13:20.000Z');

      const { runner } = await loadRunnerModule();
      const bridge = createBridge();
      await runner.startRun({}, bridge as never);

      const [, args] = ptyState.lastSpawnArgs as [string, string[]];
      const grepInvertValues = getOptionValues(args, '--grep-invert');
      expect(grepInvertValues).toHaveLength(1);
      expect(grepInvertValues[0]).toBe(
        `${escapeForGrepInvert(titleA)}|${escapeForGrepInvert(titleB)}`,
      );
    });

    it('does not add --grep-invert when quarantine is empty', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      await runner.startRun({}, bridge as never);

      const [, args] = ptyState.lastSpawnArgs as [string, string[]];
      expect(args).not.toContain('--grep-invert');
    });
  });

  describe('abortRun', () => {
    it('returns true, kills process, marks interrupted, sets finishedAt, and removes active process', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      const runId = await runner.startRun({}, bridge as never);
      expect(runner.isRunning(runId)).toBe(true);

      const aborted = runner.abortRun(runId);
      expect(aborted).toBe(true);
      expect((ptyState.lastProcess as PseudoPtyProcess).kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.isRunning(runId)).toBe(false);

      const row = getRunRow(testSqlite, runId);
      expect(row.status).toBe('interrupted');
      expect(row.finished_at).toBeTruthy();
    });

    it('returns false when runId is unknown', async () => {
      const { runner } = await loadRunnerModule();
      expect(runner.abortRun('missing-run-id')).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns true for active run and false after abort', async () => {
      const { runner } = await loadRunnerModule();
      const bridge = createBridge();

      expect(runner.isRunning('unknown')).toBe(false);

      const runId = await runner.startRun({}, bridge as never);
      expect(runner.isRunning(runId)).toBe(true);

      runner.abortRun(runId);
      expect(runner.isRunning(runId)).toBe(false);
    });
  });
});
