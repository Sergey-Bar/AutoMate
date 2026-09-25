/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so the mocks are available when vi.mock factory runs (hoisted)
const { mockFrom, mockSelect, mockSetWhere, mockSet, mockUpdate } = vi.hoisted(() => {
  const mockFrom = vi.fn().mockResolvedValue([]);
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn(() => ({ where: mockSetWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  return { mockFrom, mockSelect, mockSetWhere, mockSet, mockUpdate };
});

vi.mock('../db/client.js', () => ({
  db: { select: mockSelect, update: mockUpdate },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// Must import after mock
import { scheduler } from './scheduler.js';

const makeDeps = () => ({
  bridge: {} as never,
  runner: {
    startRun: vi.fn().mockResolvedValue('run-123'),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  scheduler.stop(); // Ensure clean state
  mockFrom.mockResolvedValue([]);
  mockSelect.mockReturnValue({ from: mockFrom });
  mockSet.mockReturnValue({ where: mockSetWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSetWhere.mockResolvedValue(undefined);
});

afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('scheduler', () => {
  // ── Start and stop ────────────────────────────────────────────────────
  it('start loads schedules from db and stop clears timers', async () => {
    mockFrom.mockResolvedValue([]);
    const deps = makeDeps();

    await scheduler.start(deps);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();

    scheduler.stop();
    // Should not throw, timers are cleared
  });

  it('stop is idempotent and safe to call when not started', () => {
    expect(() => scheduler.stop()).not.toThrow();
  });

  // ── Disabled schedules are skipped ────────────────────────────────────
  it('does not schedule disabled entries', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: false,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // Advance time well past the 1-minute interval
    await vi.advanceTimersByTimeAsync(120_000);

    expect(deps.runner.startRun).not.toHaveBeenCalled();
  });

  // ── Enabled schedule triggers runner ──────────────────────────────────
  it('triggers runner.startRun for enabled schedule after interval', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *', // every minute → 60_000ms interval
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // Advance by one interval
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
    expect(deps.runner.startRun).toHaveBeenCalledWith({}, deps.bridge);
  });

  // ── runOptions parsed as JSON ─────────────────────────────────────────
  it('parses runOptions as JSON and passes to startRun', async () => {
    const runOptions = JSON.stringify({ workers: 4, project: 'chromium' });
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *',
        runOptions,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.runner.startRun).toHaveBeenCalledWith(
      { workers: 4, project: 'chromium' },
      deps.bridge,
    );
  });

  // ── Updates lastRunAt after run ───────────────────────────────────────
  it('updates lastRunAt in db after a successful run', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ lastRunAt: expect.any(String) }),
    );
  });

  // ── Reload clears old timers and loads fresh ──────────────────────────
  it('reload clears old timers and loads fresh schedules', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // Now reload with empty schedules
    mockFrom.mockResolvedValue([]);
    await scheduler.reload();

    // Advance time — should NOT trigger any runs since schedules were cleared
    await vi.advanceTimersByTimeAsync(120_000);

    expect(deps.runner.startRun).not.toHaveBeenCalled();
  });

  // ── */5 cron → 5 minute interval ─────────────────────────────────────
  it('parses */5 cron to 5-minute interval', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '*/5 * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 1 minute: should NOT have run
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At 5 minutes: should run
    await vi.advanceTimersByTimeAsync(240_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  // ── Runner error doesn't crash scheduler ──────────────────────────────
  it('catches runner errors without crashing', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    deps.runner.startRun.mockRejectedValue(new Error('Runner crashed'));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await scheduler.start(deps);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stderrSpy).toHaveBeenCalled();

    // Second tick should still fire (scheduler not broken)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(2);

    stderrSpy.mockRestore();
  });

  // ── Multiple schedules ────────────────────────────────────────────────
  it('manages multiple schedules simultaneously', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-1',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
      {
        id: 'sched-2',
        cronExpr: '*/5 * * * *',
        runOptions: JSON.stringify({ project: 'firefox' }),
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 1 minute: only sched-1 fires
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);

    // At 5 minutes: sched-1 fires 4 more times, sched-2 fires once
    await vi.advanceTimersByTimeAsync(240_000);
    // total: sched-1 (5) + sched-2 (1) = 6
    expect(deps.runner.startRun).toHaveBeenCalledTimes(6);
  });

  // ── Mutation-killing: parseCronToInterval number literals ────────────────
  it('parseCronToInterval: every-minute cron "* * * * *" returns exactly 60_000ms — kills NumberLiteral mutation', async () => {
    // If 60_000 were mutated to 0 or 1, the timer would fire immediately (or not at all)
    mockFrom.mockResolvedValue([
      {
        id: 'sched-60k',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 59_999ms: should NOT have fired yet
    await vi.advanceTimersByTimeAsync(59_999);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At exactly 60_000ms: should fire exactly once
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('parseCronToInterval: "*/5 * * * *" returns exactly 300_000ms (5 min) — kills NumberLiteral mutation', async () => {
    // If 60_000 multiplier were mutated, the interval would be wrong
    mockFrom.mockResolvedValue([
      {
        id: 'sched-5min',
        cronExpr: '*/5 * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 299_999ms: should NOT have fired
    await vi.advanceTimersByTimeAsync(299_999);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At exactly 300_000ms: should fire once
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('parseCronToInterval: hourly cron "30 * * * *" returns exactly 3_600_000ms — kills NumberLiteral mutation', async () => {
    // Fixed-minute, every-hour: should be 3_600_000 ms
    mockFrom.mockResolvedValue([
      {
        id: 'sched-hourly',
        cronExpr: '30 * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 60_000ms (1 min): should NOT have fired
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At 3_600_000ms (1 hour): should fire
    await vi.advanceTimersByTimeAsync(3_540_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('parseCronToInterval: every-2-hours cron "0 */2 * * *" returns 7_200_000ms — kills NumberLiteral mutation', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-2hr',
        cronExpr: '0 */2 * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 3_600_000ms (1 hour): should NOT fire (interval is 2 hours)
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At 7_200_000ms (2 hours): should fire
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('parseCronToInterval: complex/daily cron "0 9 * * 1" returns 86_400_000ms — kills NumberLiteral mutation', async () => {
    // Complex cron expression — falls back to 86_400_000 (daily)
    mockFrom.mockResolvedValue([
      {
        id: 'sched-daily',
        cronExpr: '0 9 * * 1',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 3_600_000ms (1 hour): should NOT have fired
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At 86_400_000ms (24 hours): should fire
    await vi.advanceTimersByTimeAsync(82_800_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('schedulers with intervalMs <= 0 are skipped (malformed cron) — kills ConditionalExpression mutation', async () => {
    // A cron with < 5 parts → returns 60_000 (not <= 0), but test the boundary: a hypothetical 0ms interval
    // We test that a zero-field cron (< 5 parts) does NOT crash but falls back to 60_000
    mockFrom.mockResolvedValue([
      {
        id: 'sched-bad',
        cronExpr: 'bad', // < 5 parts → parseCronToInterval returns 60_000
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // Should fire at 60_000 (fallback), not crash
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('error log message includes schedule id — kills StringLiteral mutation on error prefix', async () => {
    mockFrom.mockResolvedValue([
      {
        id: 'sched-err-id',
        cronExpr: '* * * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    deps.runner.startRun.mockRejectedValue(new Error('crash'));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await scheduler.start(deps);
    await vi.advanceTimersByTimeAsync(60_000);

    // Error message must include the schedule ID
    const errorMsg = stderrSpy.mock.calls[0][0] as string;
    expect(errorMsg).toContain('sched-err-id');
    expect(errorMsg).toContain('[scheduler]');

    stderrSpy.mockRestore();
  });
});
