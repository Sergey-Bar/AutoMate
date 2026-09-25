/**
 * scheduler-branches.test.ts
 *
 * Additional branch coverage for parseCronToInterval:
 * covers isNaN fallback branches for invalid cron number components.
 */
/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { scheduler } from './scheduler.js';

const makeDeps = () => ({
  bridge: {} as never,
  runner: {
    startRun: vi.fn().mockResolvedValue('run-ok'),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  scheduler.stop();
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

describe('scheduler — parseCronToInterval isNaN branches', () => {
  it('*/notanumber minute → isNaN returns 60_000ms fallback', async () => {
    // minute = '*/notanumber' → parseInt('notanumber', 10) = NaN → falls back to 60_000
    mockFrom.mockResolvedValue([
      {
        id: 'sched-nan-min',
        cronExpr: '*/notanumber * * * *',
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

    // At 60_000ms: fallback fires
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });

  it('0 */notanumber hour → isNaN returns 3_600_000ms fallback', async () => {
    // minute = '0' (fixed, not '*/...') → skips minute-based branch
    // hour = '*/notanumber' → parseInt('notanumber', 10) = NaN → falls back to 3_600_000
    mockFrom.mockResolvedValue([
      {
        id: 'sched-nan-hr',
        cronExpr: '0 */notanumber * * *',
        runOptions: null,
        enabled: true,
        lastRunAt: null,
        createdAt: '2024-01-01',
      },
    ]);

    const deps = makeDeps();
    await scheduler.start(deps);

    // At 60_000ms (1 minute): should NOT have fired (interval is 3_600_000)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.runner.startRun).not.toHaveBeenCalled();

    // At 3_600_000ms (1 hour): should fire
    await vi.advanceTimersByTimeAsync(3_540_000);
    expect(deps.runner.startRun).toHaveBeenCalledTimes(1);
  });
});
