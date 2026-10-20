import { describe, expect, it } from 'vitest';
import { RunnerApiError } from './protocol.js';
import { whileUnreachable } from './wait-for-api.js';

/** What `fetch` throws when nothing is listening. */
const unreachable = (): Error => new TypeError('fetch failed');

describe('waiting for the API to come up', () => {
  const instant = { timeoutMs: 1_000, intervalMs: 10, sleep: () => Promise.resolve() };

  it('returns the first answer when the API is already up', async () => {
    let calls = 0;
    const answer = await whileUnreachable(() => {
      calls += 1;
      return Promise.resolve('registered');
    }, instant);
    expect(answer).toBe('registered');
    expect(calls).toBe(1);
  });

  it('keeps trying while the connection is refused, then succeeds', async () => {
    let calls = 0;
    const answer = await whileUnreachable(() => {
      calls += 1;
      return calls < 4 ? Promise.reject(unreachable()) : Promise.resolve('registered');
    }, instant);
    expect(answer).toBe('registered');
    expect(calls).toBe(4);
  });

  it('treats a timed-out request like a refused connection, and says it is waiting', async () => {
    let calls = 0;
    const waited: unknown[] = [];
    const answer = await whileUnreachable(
      () => {
        calls += 1;
        return calls < 3
          ? Promise.reject(Object.assign(new Error('slow'), { name: 'TimeoutError' }))
          : Promise.resolve('registered');
      },
      { ...instant, onWait: (error) => waited.push(error) },
    );
    expect(answer).toBe('registered');
    expect(waited).toHaveLength(2);
  });

  it('gives up with the last connection error once the time is spent', async () => {
    let clock = 0;
    const failure = whileUnreachable(() => Promise.reject(unreachable()), {
      timeoutMs: 100,
      intervalMs: 40,
      now: () => clock,
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });
    await expect(failure).rejects.toThrow('fetch failed');
  });

  it('does not retry an answer from the API, because a wrong secret will not get better', async () => {
    let calls = 0;
    const refusal = new RunnerApiError(403, 'RUNNER_REGISTRATION_UNAUTHORIZED');
    await expect(
      whileUnreachable(() => {
        calls += 1;
        return Promise.reject(refusal);
      }, instant),
    ).rejects.toBe(refusal);
    expect(calls).toBe(1);
  });
});
