import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Flush pending microtasks so fire-and-forget async work can complete. */
async function flushPromises(): Promise<void> {
  // Multiple rounds are needed: first to enter the async function, then to
  // resolve the awaited mock inside it.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// ── Hoist mocks so they are available when vi.mock factory runs ───────────────
const mockLoadRetentionConfig = vi.hoisted(() => vi.fn());
const mockRunRetentionCleanup = vi.hoisted(() => vi.fn());

vi.mock('../data-retention.js', () => ({
  loadRetentionConfig: mockLoadRetentionConfig,
  runRetentionCleanup: mockRunRetentionCleanup,
}));

import { createRetentionRunner } from '../retention-runner.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_CLEANUP_RESULT = {
  deletedRuns: 0,
  deletedResults: 0,
  deletedNlQueries: 0,
  deletedAttachments: 0,
  durationMs: 10,
};

const makeEnabledConfig = () => ({
  enabled: true,
  testResultDays: 90,
  nlQueryHistoryDays: 30,
  attachmentDays: 60,
  trendsDays: -1,
});

const makeDisabledConfig = () => ({
  ...makeEnabledConfig(),
  enabled: false,
});

const makeLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createRetentionRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    mockRunRetentionCleanup.mockResolvedValue(MOCK_CLEANUP_RESULT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Factory shape ─────────────────────────────────────────────────────────
  it('returns object with start, stop, isRunning, runNow methods', () => {
    const runner = createRetentionRunner();
    expect(typeof runner.start).toBe('function');
    expect(typeof runner.stop).toBe('function');
    expect(typeof runner.isRunning).toBe('function');
    expect(typeof runner.runNow).toBe('function');
  });

  // ── start() when disabled ─────────────────────────────────────────────────
  it('start() when retention disabled: logs info, does NOT start interval, isRunning() returns false', () => {
    mockLoadRetentionConfig.mockReturnValue(makeDisabledConfig());
    const logger = makeLogger();
    const runner = createRetentionRunner({ logger });

    runner.start();

    expect(runner.isRunning()).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
  });

  // ── start() when enabled ──────────────────────────────────────────────────
  it('start() when enabled: runs cleanup immediately, starts interval, isRunning() returns true', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner({ intervalMs: 60_000 });

    runner.start();
    await flushPromises();

    expect(runner.isRunning()).toBe(true);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);

    runner.stop();
  });

  // ── interval fires ────────────────────────────────────────────────────────
  it('after interval fires: calls runRetentionCleanup again', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner({ intervalMs: 60_000 });

    runner.start();
    await flushPromises(); // initial run

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  // ── stop() ────────────────────────────────────────────────────────────────
  it('stop() clears interval, isRunning() returns false', () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner({ intervalMs: 60_000 });

    runner.start();
    expect(runner.isRunning()).toBe(true);

    runner.stop();
    expect(runner.isRunning()).toBe(false);
  });

  it('stop() when not running: no-op, no error', () => {
    const runner = createRetentionRunner();
    expect(() => runner.stop()).not.toThrow();
    expect(runner.isRunning()).toBe(false);
  });

  // ── start() already running ───────────────────────────────────────────────
  it('start() when already running: logs warning, no-op (does not start a second interval)', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const logger = makeLogger();
    const runner = createRetentionRunner({ logger, intervalMs: 60_000 });

    runner.start();
    runner.start(); // second call — should warn and return

    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Only the first start()'s immediate run should be in-flight
    await flushPromises();
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);

    runner.stop();
  });

  // ── runNow() ──────────────────────────────────────────────────────────────
  it('runNow() calls runRetentionCleanup directly and returns result', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner();

    const result = await runner.runNow();

    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);
    expect(result).toEqual(MOCK_CLEANUP_RESULT);
  });

  // ── config re-read each cycle ─────────────────────────────────────────────
  it('interval re-reads config each cycle (loadRetentionConfig called multiple times)', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner({ intervalMs: 60_000 });

    runner.start();
    await flushPromises(); // initial run

    await vi.advanceTimersByTimeAsync(60_000); // tick 1
    await vi.advanceTimersByTimeAsync(60_000); // tick 2

    // start() reads once + initial runCycle reads once + 2 interval ticks = 4 calls minimum
    expect(mockLoadRetentionConfig.mock.calls.length).toBeGreaterThanOrEqual(4);

    runner.stop();
  });

  // ── config disabled mid-run ───────────────────────────────────────────────
  it('when config.enabled becomes false: skips cleanup but interval continues running', async () => {
    mockLoadRetentionConfig
      .mockReturnValueOnce(makeEnabledConfig()) // start() enabled check
      .mockReturnValueOnce(makeEnabledConfig()) // initial runCycle
      .mockReturnValue(makeDisabledConfig());   // all subsequent ticks

    const logger = makeLogger();
    const runner = createRetentionRunner({ logger, intervalMs: 60_000 });

    runner.start();
    await flushPromises(); // initial cleanup (enabled)
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);

    // First interval tick — disabled now → skips cleanup, interval still active
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runner.isRunning()).toBe(true);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1); // no additional call
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/skipped.*disabled/i));

    runner.stop();
  });

  // ── errors caught and logged ──────────────────────────────────────────────
  it('error in runRetentionCleanup is caught and logged, does not crash server', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    mockRunRetentionCleanup.mockRejectedValue(new Error('DB connection lost'));
    const logger = makeLogger();
    const runner = createRetentionRunner({ logger, intervalMs: 60_000 });

    runner.start();
    await flushPromises(); // initial run throws

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    );
    // Interval is still running — error didn't crash it
    expect(runner.isRunning()).toBe(true);

    runner.stop();
  });

  // ── custom intervalMs ─────────────────────────────────────────────────────
  it('custom intervalMs is respected — fires at exactly intervalMs, not before', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner({ intervalMs: 5_000 });

    runner.start();
    await flushPromises(); // initial run (count: 1)

    // At 4999ms: should not have fired again
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);

    // At exactly 5000ms: fires second time
    await vi.advanceTimersByTimeAsync(1);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  // ── default intervalMs 3_600_000 ─────────────────────────────────────────
  it('default intervalMs is 3_600_000 — fires at 1 hour boundary', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    const runner = createRetentionRunner(); // no intervalMs option

    runner.start();
    await flushPromises(); // initial run (count: 1)

    // At 3_599_999ms: should NOT have fired again
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);

    // At exactly 3_600_000ms: fires second time
    await vi.advanceTimersByTimeAsync(1);
    expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  // ── RETENTION_INTERVAL_MS env var ────────────────────────────────────────
  it('RETENTION_INTERVAL_MS env var overrides default interval', async () => {
    mockLoadRetentionConfig.mockReturnValue(makeEnabledConfig());
    process.env.RETENTION_INTERVAL_MS = '10000';

    try {
      const runner = createRetentionRunner(); // reads env var at construction

      runner.start();
      await flushPromises(); // initial run (count: 1)

      // At 9999ms: should not have fired again
      await vi.advanceTimersByTimeAsync(9_999);
      expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(1);

      // At exactly 10000ms: fires second time
      await vi.advanceTimersByTimeAsync(1);
      expect(mockRunRetentionCleanup).toHaveBeenCalledTimes(2);

      runner.stop();
    } finally {
      delete process.env.RETENTION_INTERVAL_MS;
    }
  });
});
