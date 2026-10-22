import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ConnectorHttpError,
  ConnectorRejectionError,
  executeWithRetry,
  isRetryableStatus,
  MAX_RETRY_BACKOFF_MS,
} from './index.js';

/**
 * Property suite for invariants RETRY-1 .. RETRY-3 in `docs/quality/property-invariants.json`.
 *
 * Fixed seed and `numRuns`, so a red run is reproducible on any host. Time is never real:
 * `sleep` is injected and records the backoff it was asked for.
 */
const SEED = 20261022;
const params = { seed: SEED, numRuns: 300 } as const;

const RETRYABLE = [408, 425, 429, 500, 502, 503, 504] as const;

interface Run {
  waits: number[];
  calls: number;
  outcome: 'resolved' | 'rejected';
  attempts: number;
}

/** Fails `failures` times with `status`, then succeeds. Never waits for real. */
async function run(options: {
  retries: number;
  failures: number;
  status: number;
  idempotent: boolean | undefined;
  rejection?: boolean;
}): Promise<Run> {
  const waits: number[] = [];
  let calls = 0;
  try {
    const result = await executeWithRetry(
      () => {
        calls += 1;
        if (calls <= options.failures) {
          return Promise.reject(
            options.rejection
              ? new ConnectorRejectionError(options.status, 'rejected')
              : new ConnectorHttpError(options.status, 'failed'),
          );
        }
        return Promise.resolve('ok');
      },
      {
        retries: options.retries,
        ...(options.idempotent === undefined ? {} : { idempotent: options.idempotent }),
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    return { waits, calls, outcome: 'resolved', attempts: result.attempts };
  } catch (error) {
    const attempts = error instanceof ConnectorHttpError ? error.attempts : -1;
    return { waits, calls, outcome: 'rejected', attempts };
  }
}

const retriesArb = fc.integer({ min: 0, max: 40 });
const failuresArb = fc.integer({ min: 0, max: 60 });
const statusArb = fc.constantFrom(...RETRYABLE);

describe('RETRY-1: attempts never exceed retries + 1', () => {
  it('a permanently failing idempotent operation makes exactly retries + 1 calls', async () => {
    await fc.assert(
      fc.asyncProperty(retriesArb, statusArb, async (retries, status) => {
        const result = await run({
          retries,
          failures: Number.POSITIVE_INFINITY,
          status,
          idempotent: true,
        });
        expect(result.outcome).toBe('rejected');
        expect(result.calls).toBe(retries + 1);
        expect(result.attempts).toBe(retries + 1);
        expect(result.waits).toHaveLength(retries);
      }),
      params,
    );
  });

  it('never makes more calls than the budget allows, whatever the failure count', async () => {
    await fc.assert(
      fc.asyncProperty(retriesArb, failuresArb, statusArb, async (retries, failures, status) => {
        const result = await run({ retries, failures, status, idempotent: true });
        expect(result.calls).toBeLessThanOrEqual(retries + 1);
        expect(result.outcome).toBe(failures <= retries ? 'resolved' : 'rejected');
        if (result.outcome === 'resolved') expect(result.attempts).toBe(failures + 1);
      }),
      params,
    );
  });

  it('never retries what is not safe to repeat, or what will not clear', async () => {
    await fc.assert(
      fc.asyncProperty(
        retriesArb,
        fc.constantFrom(false, undefined),
        statusArb,
        fc.constantFrom(400, 401, 403, 404, 409, 422),
        async (retries, idempotent, retryable, permanent) => {
          // Not idempotent, not rejected: one call. A 502 after a create made three issues.
          expect((await run({ retries, failures: 99, status: retryable, idempotent })).calls).toBe(
            1,
          );
          // Idempotent but permanent: one call, because the third attempt fails identically.
          expect(
            (await run({ retries, failures: 99, status: permanent, idempotent: true })).calls,
          ).toBe(1);
        },
      ),
      {
        ...params,
        examples: [
          [0, false, 502, 400],
          [3, undefined, 429, 404],
        ],
      },
    );
  });

  it('a known rejection is retried within the same budget even when not idempotent', async () => {
    await fc.assert(
      fc.asyncProperty(retriesArb, async (retries) => {
        const result = await run({
          retries,
          failures: Number.POSITIVE_INFINITY,
          status: 429,
          idempotent: false,
          rejection: true,
        });
        expect(result.calls).toBe(retries + 1);
      }),
      params,
    );
  });
});

describe('RETRY-2: backoff is bounded and monotone', () => {
  it('every delay lies in [100, MAX_RETRY_BACKOFF_MS] and never decreases', async () => {
    await fc.assert(
      fc.asyncProperty(retriesArb, statusArb, async (retries, status) => {
        const { waits } = await run({
          retries,
          failures: Number.POSITIVE_INFINITY,
          status,
          idempotent: true,
        });
        for (const wait of waits) {
          expect(wait).toBeGreaterThanOrEqual(100);
          expect(wait).toBeLessThanOrEqual(MAX_RETRY_BACKOFF_MS);
        }
        for (let index = 1; index < waits.length; index += 1) {
          expect(waits[index] as number).toBeGreaterThanOrEqual(waits[index - 1] as number);
        }
      }),
      // 30 retries is 100 * 2 ** 29 ms, about 620 days, if nothing caps the schedule.
      {
        ...params,
        examples: [
          [30, 503],
          [40, 429],
        ],
      },
    );
  });

  it('starts at the base and doubles until the ceiling', async () => {
    const { waits } = await run({
      retries: 12,
      failures: Number.POSITIVE_INFINITY,
      status: 503,
      idempotent: true,
    });
    expect(waits.slice(0, 4)).toEqual([100, 200, 400, 800]);
    expect(waits.at(-1)).toBe(MAX_RETRY_BACKOFF_MS);
  });
});

describe('RETRY-3: retryability is a decision about a status, and only about a status', () => {
  it('is true exactly for the listed transient statuses and false for no status', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (status) => {
        expect(isRetryableStatus(status)).toBe((RETRYABLE as readonly number[]).includes(status));
      }),
      { ...params, examples: [[500], [499], [0]] },
    );
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe('the property harness can fail', () => {
  it('refutes a deliberately wrong bound with a replayable counterexample', async () => {
    // "Backoff never exceeds 1 s" is false for retries >= 4. If this ever passes, the
    // generators have stopped reaching deep retry budgets and RETRY-2 proves nothing.
    const outcome = await fc.check(
      fc.asyncProperty(retriesArb, async (retries) => {
        const { waits } = await run({
          retries,
          failures: Number.POSITIVE_INFINITY,
          status: 503,
          idempotent: true,
        });
        return Math.max(0, ...waits) <= 1_000;
      }),
      params,
    );
    expect(outcome.failed).toBe(true);
    expect((outcome.counterexample as number[])[0]).toBeGreaterThanOrEqual(4);
  });
});
