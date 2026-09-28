import { describe, expect, it, vi } from 'vitest';
import {
  attemptsOf,
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  executeWithRetry,
  isRetryableStatus,
  optionalObject,
  requireString,
  type ConnectorManifest,
} from './index.js';

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

  it('does not retry when no status arrived at all', () => {
    // The absent case is in the signature rather than in each adapter, and this is the
    // assertion that makes it worth being there. A `fetch` that rejects is a socket
    // hang-up, not a server: nothing answered, so nothing says the request was refused.
    // Two adapters invented a 500 for it, and `isRetryableStatus(500)` is `true`, so a
    // dead socket was reported as a transient fault that would never clear — and the
    // caller spent its whole budget on it.
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe('executeWithRetry', () => {
  it('falls back to a real backoff when the caller supplies no sleep', async () => {
    // Every other case injects a recording sleep, which is right for asserting
    // *when* the policy backs off and wrong for proving it does. This is the only
    // path through the default `setTimeout`, and a default that resolved
    // immediately would turn a struggling remote into a hot loop at exactly the
    // moment the policy exists to relieve — so the elapsed time is the assertion.
    const started = Date.now();
    const attempt = failing(a502, 1);
    const result = await executeWithRetry(attempt.operation, { retries: 2, idempotent: true });

    expect(result.value).toBe('done');
    expect(result.attempts).toBe(2);
    // 100ms is the first backoff step. The floor is 90 to stay honest about
    // timer resolution without letting a fast machine pass a no-op.
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });

  it('returns on the first success, having slept not at all', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const { waits, sleep } = recordingSleep();
    const result = await executeWithRetry(operation, { retries: 2, sleep, idempotent: true });
    expect(result).toEqual({ value: 'ok', attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('retries a retryable status and reports the attempt it succeeded on', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ConnectorHttpError(503, 'offline'))
      .mockResolvedValue('ok');
    const result = await executeWithRetry(operation, {
      retries: 2,
      sleep: async () => undefined,
      idempotent: true,
    });
    expect(result).toEqual({ value: 'ok', attempts: 2 });
  });

  it('backs off exponentially, so a struggling service is not hammered', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(500, 'offline'));
    const { waits, sleep } = recordingSleep();
    await expect(
      executeWithRetry(operation, { retries: 3, sleep, idempotent: true }),
    ).rejects.toThrow('offline');
    // 100ms, 200ms, 400ms: the first retry is immediate-ish, the third is not.
    expect(waits).toEqual([100, 200, 400]);
  });

  it('stops at exactly `retries` extra attempts, not one more', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(500, 'offline'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined, idempotent: true }),
    ).rejects.toThrow('offline');
    // 1 initial + 2 retries. The old arithmetic made this 4.
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(400, 'bad request'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined, idempotent: true }),
    ).rejects.toThrow('bad request');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error that is not an HTTP status at all', async () => {
    // A DNS failure or a socket hang-up carries no status. Treating it as
    // retryable would turn one connection problem into three.
    const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined, idempotent: true }),
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
      executeWithRetry(operation, {
        retries: 5,
        signal: controller.signal,
        sleep,
        idempotent: true,
      }),
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
    const result = await executeWithRetry(operation, {
      retries: 2,
      sleep: async () => undefined,
      idempotent: true,
    });
    expect(result.attempts).toBe(2);
  });

  it('stamps the real attempt count onto the error it gives up with', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(503, 'offline'));
    const failure = await executeWithRetry(operation, {
      retries: 2,
      sleep: async () => undefined,
      idempotent: true,
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

const manifest: ConnectorManifest = {
  name: 'test',
  version: '1.0.0',
  operations: {
    getIssue: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
    createIssue: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
  },
};

const noSleep = { sleep: async () => undefined };

/**
 * The input helpers, on their own.
 *
 * `ConnectorRequest.input` is `unknown`, so these two are the only thing standing
 * between a malformed call and a runtime failure at the far end of a network round
 * trip. All three adapters use both, so their edge cases are shared behaviour: a
 * helper that quietly forwards `undefined` is a connector that sends
 * `{"text": undefined}` and finds out from the remote.
 */
describe('reading a connector input', () => {
  it('names the field when the input is not an object at all', () => {
    // Every adapter reaches a required field before it has any shape to read, so
    // "not an object" is the *first* thing a malformed call hits — not an exotic
    // case. The message says `input` rather than `input.<field>` on purpose: the
    // field is not missing, the container is.
    for (const input of ['a string', 42, true, null, undefined]) {
      expect(() => requireString(input, 'channel')).toThrow(/input must be an object/);
      expect(() => requireString(input, 'channel')).toThrow(ConnectorInputError);
    }
  });

  it('names the field when it is absent, blank, or not a string', () => {
    for (const value of [undefined, null, '', '   ', 42, {}, []]) {
      expect(() => requireString({ channel: value }, 'channel')).toThrow(
        'input.channel must be a non-empty string',
      );
    }
  });

  it('returns a present string, whitespace and all', () => {
    // It refuses a *blank* value but does not silently trim a real one. Trimming
    // would change what the caller asked to be sent, and the caller can trim.
    expect(requireString({ channel: ' C123 ' }, 'channel')).toBe(' C123 ');
  });

  it('treats every non-object optional field as absent rather than forwarding it', () => {
    // The default has to be a usable object, because callers spread the result
    // straight into a request body. Returning `undefined` here would produce
    // `Object.assign(body, undefined)`, which is a no-op that hides the omission
    // instead of making it.
    for (const value of [undefined, null, 'a string', 42, ['a', 'b']]) {
      expect(optionalObject({ blocks: value }, 'blocks')).toEqual({});
    }
    expect(optionalObject('not an object', 'blocks')).toEqual({});
    expect(optionalObject(null, 'blocks')).toEqual({});
  });

  it('forwards a nested object whole, because that is the escape hatch', () => {
    // Slack's `fields` exists for block-kit payloads, and a block kit payload is a
    // nested object. An array is refused because a body field that is an array is
    // a caller's mistake about which field they meant, and it would serialise into
    // a body the remote rejects for reasons the caller cannot see.
    expect(optionalObject({ blocks: { section: { text: 'hi' } } }, 'blocks')).toEqual({
      section: { text: 'hi' },
    });
  });
});

/** A counter that fails `times` times with `failure`, then succeeds. */
function failing(failure: () => unknown, times: number) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    operation: async () => {
      calls += 1;
      if (calls <= times) throw failure();
      return 'done';
    },
  };
}

const a502 = () => new ConnectorHttpError(502, 'bad gateway');

describe('the retry policy consults the manifest', () => {
  it('retries a 502 for an operation the manifest calls idempotent', async () => {
    const attempt = failing(a502, 2);
    const result = await executeWithRetry(attempt.operation, {
      ...noSleep,
      retries: 2,
      idempotent: true,
    });

    expect(result.value).toBe('done');
    expect(result.attempts).toBe(3);
  });

  it('does not retry a 502 for an operation the manifest calls non-idempotent', async () => {
    // Finding P-13. A 502 arriving *after* the remote system did the work is the
    // ambiguous case: the issue exists, the response failed to say so. Retrying produces a
    // second issue and reports one failure. `manifest.operations[op].idempotent` is in the
    // same package and was never read — `executeWithRetry` had no parameter through which
    // it could arrive.
    const attempt = failing(a502, 1);
    await expect(
      executeWithRetry(attempt.operation, { ...noSleep, retries: 2, idempotent: false }),
    ).rejects.toThrow('bad gateway');

    expect(attempt.calls).toBe(1);
  });

  it('still refuses a non-retryable status for an idempotent operation', async () => {
    const attempt = failing(() => new ConnectorHttpError(400, 'bad request'), 1);
    await expect(
      executeWithRetry(attempt.operation, { ...noSleep, retries: 2, idempotent: true }),
    ).rejects.toThrow('bad request');

    expect(attempt.calls).toBe(1);
  });

  it('retries a known rejection even for a non-idempotent operation', async () => {
    // The distinction that keeps the two rows consistent. A rate limit is a refusal
    // *before* the work happened, so repeating it cannot duplicate anything — and
    // refusing to retry it means a rate-limited caller is told to fail rather than to
    // wait, which is the wrong instruction. A rejection is a claim the remote system
    // makes about having done nothing; a 502 is a claim about the response only.
    const attempt = failing(() => new ConnectorRejectionError(429, 'rate limited'), 2);
    const result = await executeWithRetry(attempt.operation, {
      ...noSleep,
      retries: 2,
      idempotent: false,
    });

    expect(result.value).toBe('done');
    expect(attempt.calls).toBe(3);
  });

  it('records the attempt count on the failure it gives up on', async () => {
    const attempt = failing(a502, 5);
    let thrown: unknown;
    try {
      await executeWithRetry(attempt.operation, { ...noSleep, retries: 2, idempotent: true });
    } catch (error) {
      thrown = error;
    }

    expect(attemptsOf(thrown)).toBe(3);
  });

  it('honours a cancellation before waiting out the backoff', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempt = failing(a502, 1);
    await expect(
      executeWithRetry(attempt.operation, {
        retries: 2,
        idempotent: true,
        signal: controller.signal,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/cancelled/);

    expect(attempt.calls).toBe(1);
  });
});

describe('a refusal of an unknown operation names the real ones', () => {
  it('lists what the manifest declares', async () => {
    // The three named defects all had the same root: an adapter that answered whatever it
    // was asked. A dispatcher that can only say "no" leaves a caller guessing, so the
    // refusal carries the spellings.
    const { operationSpec } = await import('./index.js');
    expect(() => operationSpec(manifest, 'createEveryIssue')).toThrow(/createIssue, getIssue/);
    expect(operationSpec(manifest, 'createIssue')).toEqual({
      sideEffecting: true,
      idempotent: false,
      timeoutMs: 10_000,
    });
  });
});
