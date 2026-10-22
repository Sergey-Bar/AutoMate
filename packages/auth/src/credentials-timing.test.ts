import { beforeEach, describe, expect, it, vi } from 'vitest';

const compare = vi.hoisted(() => vi.fn());

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  compare.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: compare };
});

import { verifySharedSecret } from './credentials.js';

/**
 * `verifySharedSecret` promises that an empty input and a length mismatch still burn one
 * constant-time comparison, so they are not distinguishable by timing from a real one.
 * That promise is a side effect, which is why two mutants that deleted the burn survived
 * every behavioural assertion: the return value is `false` either way. A call count is
 * the only observable.
 */
describe('verifySharedSecret burns a comparison on every rejection path', () => {
  beforeEach(() => {
    compare.mockClear();
  });

  it('compares once for an empty input', () => {
    expect(verifySharedSecret('', 'configured-secret')).toBe(false);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('compares once for a length mismatch', () => {
    expect(verifySharedSecret('short', 'configured-secret')).toBe(false);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('compares once for a same-length wrong value and once for the right one', () => {
    expect(verifySharedSecret('configured-secreT', 'configured-secret')).toBe(false);
    expect(verifySharedSecret('configured-secret', 'configured-secret')).toBe(true);
    expect(compare).toHaveBeenCalledTimes(2);
  });
});
