import { describe, expect, it, vi } from 'vitest';
import {
  attemptsOf,
  ConnectorHttpError,
  executeWithRetry,
  isRetryableStatus,
} from './src/index.js';

/** A sleep that records the backoff it was asked for instead of waiting. */
function recordingSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe('which statuses are worth retrying', () => {
  it('retries the statuses that mean "not now"', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it('does not retry a status that means "not ever"', () => {
    // A 400 or a 404 will fail identically on the third attempt, so retrying it
    // only spends the caller's timeout budget.
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe('executeWithRetry', () => {
  it('returns on the first success, having slept not at all', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const { waits, sleep } = recordingSleep();
    const result = await executeWithRetry(operation, { retries: 2, sleep });
    expect(result).toEqual({ value: 'ok', attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('retries a retryable status and reports the attempt it succeeded on', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ConnectorHttpError(503, 'offline'))
      .mockResolvedValue('ok');
    const result = await executeWithRetry(operation, { retries: 2, sleep: async () => undefined });
    expect(result).toEqual({ value: 'ok', attempts: 2 });
  });

  it('backs off exponentially, so a struggling service is not hammered', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(500, 'offline'));
    const { waits, sleep } = recordingSleep();
    await expect(executeWithRetry(operation, { retries: 3, sleep })).rejects.toThrow('offline');
    // 100ms, 200ms, 400ms: the first retry is immediate-ish, the third is not.
    expect(waits).toEqual([100, 200, 400]);
  });

  it('stops at exactly `retries` extra attempts, not one more', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(500, 'offline'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined }),
    ).rejects.toThrow('offline');
    // 1 initial + 2 retries. The old arithmetic made this 4.
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(400, 'bad request'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined }),
    ).rejects.toThrow('bad request');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error that is not an HTTP status at all', async () => {
    // A DNS failure or a socket hang-up carries no status. Treating it as
    // retryable would turn one connection problem into three.
    const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined }),
    ).rejects.toThrow('ECONNREFUSED');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller cancels, without spending the backoff', async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new ConnectorHttpError(503, 'offline');
    });
    const { waits, sleep } = recordingSleep();
    await expect(
      executeWithRetry(operation, { retries: 5, signal: controller.signal, sleep }),
    ).rejects.toThrow('cancelled');
    // The abort is honoured before the retry, so the operation runs once and the
    // caller is not made to wait out a backoff it has already cancelled.
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('is not cancelled by an absent signal', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ConnectorHttpError(503, 'offline'))
      .mockResolvedValue('ok');
    const result = await executeWithRetry(operation, { retries: 2, sleep: async () => undefined });
    expect(result.attempts).toBe(2);
  });

  it('stamps the real attempt count onto the error it gives up with', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(503, 'offline'));
    const failure = await executeWithRetry(operation, {
      retries: 2,
      sleep: async () => undefined,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectorHttpError);
    // The adapter reports this as `attempts` in its result. Reporting a hard-coded
    // 1 instead is a wrong number in the evidence trail.
    expect(attemptsOf(failure)).toBe(3);
  });

  it('reports one attempt for an error that never got that far', () => {
    expect(attemptsOf(new ConnectorHttpError(500, 'offline'))).toBe(1);
    expect(attemptsOf(new Error('plain'))).toBe(1);
    expect(attemptsOf('a string')).toBe(1);
    expect(attemptsOf(undefined)).toBe(1);
  });
});
