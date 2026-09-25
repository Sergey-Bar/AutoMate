import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResiliencePolicy } from './resilience.js';
import { ConnectorError } from './errors.js';

describe('createResiliencePolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a policy with default options', () => {
    const policy = createResiliencePolicy();
    expect(policy).toBeDefined();
    expect(typeof policy.execute).toBe('function');
  });

  it('creates a policy with custom options', () => {
    const policy = createResiliencePolicy({
      maxAttempts: 2,
      timeoutMs: 5_000,
      consecutiveFailures: 3,
      halfOpenAfterMs: 10_000,
    });
    expect(policy).toBeDefined();
    expect(typeof policy.execute).toBe('function');
  });

  it('executes fn and returns its result', async () => {
    const policy = createResiliencePolicy({ maxAttempts: 1 });
    const result = await policy.execute(async () => 'hello');
    expect(result).toBe('hello');
  });

  it('retries ConnectorError with kind=transient up to maxAttempts', async () => {
    // Large timeoutMs so the timeout fake-timer does not fire before retries complete
    const policy = createResiliencePolicy({
      maxAttempts: 3,
      timeoutMs: 600_000,
      consecutiveFailures: 10,
      halfOpenAfterMs: 600_000,
    });
    let calls = 0;
    const prom = policy.execute(async () => {
      calls++;
      if (calls < 3) throw new ConnectorError('transient error', 'transient');
      return 'success';
    });
    // Fire ExponentialBackoff delays between retries
    await vi.runAllTimersAsync();
    const result = await prom;
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('does NOT retry ConnectorError with kind=permanent', async () => {
    const policy = createResiliencePolicy({ maxAttempts: 3, timeoutMs: 600_000 });
    let calls = 0;
    await expect(
      policy.execute(async () => {
        calls++;
        throw new ConnectorError('permanent error', 'permanent');
      })
    ).rejects.toThrow('permanent error');
    expect(calls).toBe(1);
  });

  it('does NOT retry ConnectorError with kind=unknown', async () => {
    const policy = createResiliencePolicy({ maxAttempts: 3, timeoutMs: 600_000 });
    let calls = 0;
    await expect(
      policy.execute(async () => {
        calls++;
        throw new ConnectorError('unknown error', 'unknown');
      })
    ).rejects.toThrow('unknown error');
    expect(calls).toBe(1);
  });

  it('does NOT retry plain Error objects', async () => {
    const policy = createResiliencePolicy({ maxAttempts: 3, timeoutMs: 600_000 });
    let calls = 0;
    await expect(
      policy.execute(async () => {
        calls++;
        throw new Error('plain error');
      })
    ).rejects.toThrow('plain error');
    expect(calls).toBe(1);
  });

  it('opens circuit after N consecutive transient failures', async () => {
    // maxAttempts=0 → 0 retries (1 total attempt per execute) so each call
    // counts exactly ONE failure in the circuit breaker — no backoff timers.
    const policy = createResiliencePolicy({
      maxAttempts: 0,
      consecutiveFailures: 3,
      halfOpenAfterMs: 30_000,
      timeoutMs: 600_000,
    });

    // 3 consecutive transient failures → circuit opens
    for (let i = 0; i < 3; i++) {
      await expect(
        policy.execute(async () => {
          throw new ConnectorError('transient', 'transient');
        })
      ).rejects.toThrow();
    }

    // Circuit is open — fn should NOT be called on next execute
    let fnCalled = false;
    await expect(
      policy.execute(async () => {
        fnCalled = true;
        return 'ok';
      })
    ).rejects.toThrow();
    expect(fnCalled).toBe(false);
  });

  it('half-opens circuit after halfOpenAfterMs allowing a retry', async () => {
    const policy = createResiliencePolicy({
      maxAttempts: 0,
      consecutiveFailures: 3,
      halfOpenAfterMs: 1_000,
      timeoutMs: 600_000,
    });

    // Open the circuit with 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      await expect(
        policy.execute(async () => {
          throw new ConnectorError('transient', 'transient');
        })
      ).rejects.toThrow();
    }

    // Advance fake clock past halfOpenAfterMs
    await vi.advanceTimersByTimeAsync(1_100);

    // Circuit half-opens: one probe is allowed through
    const result = await policy.execute(async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('timeout cancels long-running operations (Aggressive strategy)', async () => {
    const policy = createResiliencePolicy({
      maxAttempts: 0,
      timeoutMs: 100,
      consecutiveFailures: 10,
      halfOpenAfterMs: 600_000,
    });

    const prom = policy.execute(async () => {
      // A long-running operation that won't finish within timeoutMs
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5_000);
      });
      return 'done';
    });

    // Advance past 100ms timeout — Aggressive strategy races fn with rejection,
    // so the 100ms timeout wins over the 5s fn timer
    await vi.advanceTimersByTimeAsync(200);
    await expect(prom).rejects.toThrow();
  });

  it('compose: retry + circuit-breaker + timeout work together', async () => {
    const policy = createResiliencePolicy({
      maxAttempts: 2,
      timeoutMs: 600_000,
      consecutiveFailures: 10,
      halfOpenAfterMs: 600_000,
    });

    let calls = 0;
    const prom = policy.execute(async () => {
      calls++;
      if (calls < 2) throw new ConnectorError('transient', 'transient');
      return 'done';
    });

    await vi.runAllTimersAsync();
    const result = await prom;
    expect(result).toBe('done');
    expect(calls).toBe(2);
  });
});
