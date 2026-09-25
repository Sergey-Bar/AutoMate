import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
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
    source TEXT DEFAULT 'live',
    gate_status TEXT,
    workspace_id TEXT,
    pr_number INTEGER,
    pr_branch TEXT,
    base_branch TEXT,
    commit_author TEXT
  );

  CREATE TABLE IF NOT EXISTS tests (
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (id, run_id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    test_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    error_stack TEXT
  );
`);

const testDb = drizzle(sqlite, { schema });

const {
  mockExistsSync,
  mockReadFileSync,
  mockSendSlackRunSummary,
  mockCreateJiraBug,
  mockPostPrComment,
  mockCreateCommitStatus,
  mockPostOrUpdatePrComment,
  mockDispatchAllWebhooks,
  mockSendRunReportEmail,
  mockSendTeamsRunSummary,
  mockResolveBaseRun,
  mockCompareRunToBase,
  mockGeneratePrCommentMarkdown,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(targetPath: string) => boolean>(),
  mockReadFileSync: vi.fn<(targetPath: string, encoding: string) => string>(),
  mockSendSlackRunSummary: vi.fn(),
  mockCreateJiraBug: vi.fn(),
  mockPostPrComment: vi.fn(),
  mockCreateCommitStatus: vi.fn(),
  mockPostOrUpdatePrComment: vi.fn(),
  mockDispatchAllWebhooks: vi.fn(),
  mockSendRunReportEmail: vi.fn(),
  mockSendTeamsRunSummary: vi.fn(),
  mockResolveBaseRun: vi.fn(),
  mockCompareRunToBase: vi.fn(),
  mockGeneratePrCommentMarkdown: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  get db() { return testDb; },
  get sqlite() { return sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('../integrations/slack.js', () => ({ sendSlackRunSummary: mockSendSlackRunSummary }));
vi.mock('../integrations/jira.js', () => ({ createJiraBug: mockCreateJiraBug }));
vi.mock('../integrations/github.js', () => ({
  postPrComment: mockPostPrComment,
  createCommitStatus: mockCreateCommitStatus,
  postOrUpdatePrComment: mockPostOrUpdatePrComment,
}));
vi.mock('../integrations/webhooks.js', () => ({ dispatchAllWebhooks: mockDispatchAllWebhooks }));
vi.mock('../integrations/email.js', () => ({ sendRunReportEmail: mockSendRunReportEmail }));
vi.mock('../integrations/teams.js', () => ({ sendTeamsRunSummary: mockSendTeamsRunSummary }));
vi.mock('../trend-backfill.js', () => ({ updateTrendsForDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../auto-quarantine.js', () => ({ autoQuarantineCheck: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../pr-comparison.js', () => ({
  resolveBaseRun: mockResolveBaseRun,
  compareRunToBase: mockCompareRunToBase,
  generatePrCommentMarkdown: mockGeneratePrCommentMarkdown,
}));
vi.mock('../fingerprint.js', () => ({ fingerprintError: vi.fn().mockReturnValue('fp') }));

import { ReporterBridge } from '../reporter-bridge.js';

function createLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

async function dispatchFor(bridge: ReporterBridge, runId: string): Promise<void> {
  const fn = Reflect.get(bridge as object, 'dispatchIntegrations') as (rid: string) => Promise<void>;
  await fn.call(bridge, runId);
}

beforeEach(() => {
  sqlite.exec('DELETE FROM results');
  sqlite.exec('DELETE FROM tests');
  sqlite.exec('DELETE FROM runs');
  vi.clearAllMocks();

  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue('{}');
  mockSendSlackRunSummary.mockResolvedValue(undefined);
  mockCreateJiraBug.mockResolvedValue(undefined);
  mockPostPrComment.mockResolvedValue(undefined);
  mockCreateCommitStatus.mockResolvedValue(undefined);
  mockPostOrUpdatePrComment.mockResolvedValue(undefined);
  mockDispatchAllWebhooks.mockResolvedValue(undefined);
  mockSendRunReportEmail.mockResolvedValue(undefined);
  mockSendTeamsRunSummary.mockResolvedValue(undefined);
  mockResolveBaseRun.mockResolvedValue(null);
  mockCompareRunToBase.mockResolvedValue({});
  mockGeneratePrCommentMarkdown.mockReturnValue('pr-markdown');
});

afterAll(() => {
  sqlite.close();
});

describe('reporter-bridge dispatchIntegrations coverage', () => {
  it('returns early when integration config file is missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const bridge = new ReporterBridge(createLogger());

    await dispatchFor(bridge, 'run-1');

    expect(mockDispatchAllWebhooks).not.toHaveBeenCalled();
    expect(mockSendSlackRunSummary).not.toHaveBeenCalled();
  });

  it('returns early on invalid integration config JSON', async () => {
    mockReadFileSync.mockReturnValue('{not json');
    const bridge = new ReporterBridge(createLogger());

    await dispatchFor(bridge, 'run-1');

    expect(mockDispatchAllWebhooks).not.toHaveBeenCalled();
  });

  it('returns early when run cannot be found', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ slack: { enabled: true, webhookUrl: 'https://x', notifyOn: ['all'] } }));
    const bridge = new ReporterBridge(createLogger());

    await dispatchFor(bridge, 'missing-run');

    expect(mockSendSlackRunSummary).not.toHaveBeenCalled();
    expect(mockDispatchAllWebhooks).not.toHaveBeenCalled();
  });

  it('dispatches integrations including jira/github/pr-comparison and webhooks', async () => {
    sqlite
      .prepare(
        `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, commit_sha, commit_message, workspace_id, pr_number, base_branch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'run-1',
        '2023-11-14T22:13:20.000Z',
        'failed',
        3,
        1,
        2,
        0,
        0,
        1000,
        'feature/123',
        'sha-123',
        'Fix #123',
        'ws-1',
        123,
        'main',
      );

    sqlite
      .prepare('INSERT INTO tests (id, run_id, title, file, status) VALUES (?, ?, ?, ?, ?)')
      .run('t1', 'run-1', 'fails one', 'tests/a.spec.ts', 'failed');
    sqlite
      .prepare('INSERT INTO tests (id, run_id, title, file, status) VALUES (?, ?, ?, ?, ?)')
      .run('t2', 'run-1', 'fails two', 'tests/b.spec.ts', 'failed');
    sqlite
      .prepare('INSERT INTO results (id, test_id, run_id, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?)')
      .run('r1', 't1', 'run-1', 'failed', 'boom one', 'stack one');
    sqlite
      .prepare('INSERT INTO results (id, test_id, run_id, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?)')
      .run('r2', 't2', 'run-1', 'failed', 'boom two', 'stack two');

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        slack: { enabled: true, webhookUrl: 'https://slack.example', notifyOn: ['all'] },
        teams: { enabled: true, webhookUrl: 'https://teams.example', notifyOn: ['failed'] },
        email: {
          enabled: true,
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'bot',
          pass: 'pass',
          recipients: ['dev@example.com'],
        },
        jira: {
          enabled: true,
          autoCreateBugs: true,
          baseUrl: 'https://jira.example.com',
          apiToken: 'jira-token',
          email: 'jira@example.com',
          projectKey: 'MC',
        },
        github: {
          enabled: true,
          token: 'gh-token',
          owner: 'acme',
          repo: 'dashboard',
          prComments: true,
          commitStatus: true,
          defaultBaseBranch: 'main',
          ignoreFlakyInComments: true,
        },
      }),
    );

    mockResolveBaseRun.mockResolvedValue('base-run-1');
    mockCompareRunToBase.mockResolvedValue({
      newFailures: [{ stableId: 's1', title: 'fails one', file: 'tests/a.spec.ts' }],
      fixedTests: [],
      newTests: [],
      flakyIgnored: [],
      summary: { totalPrTests: 2, totalBaseTests: 2, newFailureCount: 1, fixedCount: 0, newTestCount: 0 },
    });
    mockGeneratePrCommentMarkdown.mockReturnValue('comparison markdown');

    const bridge = new ReporterBridge(createLogger());
    await dispatchFor(bridge, 'run-1');

    expect(mockSendSlackRunSummary).toHaveBeenCalledTimes(1);
    expect(mockSendTeamsRunSummary).toHaveBeenCalledTimes(1);
    expect(mockSendRunReportEmail).toHaveBeenCalledTimes(1);
    expect(mockCreateJiraBug).toHaveBeenCalledTimes(2);
    expect(mockPostPrComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'dashboard' }),
      123,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(mockCreateCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'dashboard' }),
      'sha-123',
      expect.objectContaining({ failed: 2 }),
    );
    expect(mockResolveBaseRun).toHaveBeenCalledWith('main', 'ws-1');
    expect(mockCompareRunToBase).toHaveBeenCalledWith('run-1', 'base-run-1', { ignoreQuarantined: true });
    expect(mockPostOrUpdatePrComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'dashboard' }),
      123,
      'comparison markdown',
    );
    expect(mockDispatchAllWebhooks).toHaveBeenCalledWith('run:end', {
      runId: 'run-1',
      status: 'failed',
      passed: 1,
      failed: 2,
      total: 3,
    });
  });

  it('skips status-specific notifications when notifyOn does not match run status', async () => {
    sqlite
      .prepare(
        `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('run-2', '2023-11-14T22:13:20.000Z', 'passed', 1, 1, 0, 0, 0);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        slack: { enabled: true, webhookUrl: 'https://slack.example', notifyOn: ['failed'] },
        teams: { enabled: true, webhookUrl: 'https://teams.example', notifyOn: ['failed'] },
      }),
    );

    const bridge = new ReporterBridge(createLogger());
    await dispatchFor(bridge, 'run-2');

    expect(mockSendSlackRunSummary).not.toHaveBeenCalled();
    expect(mockSendTeamsRunSummary).not.toHaveBeenCalled();
    expect(mockDispatchAllWebhooks).toHaveBeenCalledTimes(1);
  });
});
