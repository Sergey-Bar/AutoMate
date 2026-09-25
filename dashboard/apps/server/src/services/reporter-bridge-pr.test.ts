/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB insert chain
const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) });
const mockSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });

vi.mock('../db/client.js', () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    run: vi.fn(),
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// Mock all integration imports to prevent side effects
vi.mock('./integrations/slack.js', () => ({ sendSlackRunSummary: vi.fn() }));
vi.mock('./integrations/jira.js', () => ({ createJiraBug: vi.fn() }));
vi.mock('./integrations/github.js', () => ({ postPrComment: vi.fn(), createCommitStatus: vi.fn() }));
vi.mock('./integrations/webhooks.js', () => ({ dispatchAllWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./integrations/email.js', () => ({ sendRunReportEmail: vi.fn() }));
vi.mock('./integrations/teams.js', () => ({ sendTeamsRunSummary: vi.fn() }));
vi.mock('./trend-backfill.js', () => ({ updateTrendsForDate: vi.fn() }));
vi.mock('./auto-quarantine.js', () => ({ autoQuarantineCheck: vi.fn() }));
vi.mock('./fingerprint.js', () => ({ fingerprintError: vi.fn().mockReturnValue(null) }));

describe('ReporterBridge PR Metadata', () => {
  type ReporterBridgeInstance = Awaited<typeof import('./reporter-bridge.js')>['ReporterBridge'];
  let bridge: InstanceType<ReporterBridgeInstance>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { ReporterBridge } = await import('./reporter-bridge.js');
    bridge = new ReporterBridge({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ConstructorParameters<ReporterBridgeInstance>[0]);
  });

  it('should persist PR metadata when present in run:start payload', async () => {
    const event = JSON.stringify({
      type: 'run:start',
      runId: 'test-run-1',
      payload: {
        total: 10,
        config: { workers: 4 },
        pr: {
          prNumber: 42,
          prBranch: 'feat/cool-feature',
          baseBranch: 'main',
          commitAuthor: 'testuser',
        },
        branch: 'feat/cool-feature',
        commitSha: 'abc123def456',
      },
    });

    await bridge.handleReporterEvent(event);

    expect(mockInsert).toHaveBeenCalled();
    const insertValues = mockValues.mock.calls[0][0];
    expect(insertValues.prNumber).toBe(42);
    expect(insertValues.prBranch).toBe('feat/cool-feature');
    expect(insertValues.baseBranch).toBe('main');
    expect(insertValues.commitAuthor).toBe('testuser');
    expect(insertValues.branch).toBe('feat/cool-feature');
    expect(insertValues.commitSha).toBe('abc123def456');
  });

  it('should persist null PR fields when PR metadata is absent', async () => {
    const event = JSON.stringify({
      type: 'run:start',
      runId: 'test-run-2',
      payload: {
        total: 5,
        config: {},
      },
    });

    await bridge.handleReporterEvent(event);

    expect(mockInsert).toHaveBeenCalled();
    const insertValues = mockValues.mock.calls[0][0];
    expect(insertValues.prNumber).toBeNull();
    expect(insertValues.prBranch).toBeNull();
    expect(insertValues.baseBranch).toBeNull();
    expect(insertValues.commitAuthor).toBeNull();
  });
});
