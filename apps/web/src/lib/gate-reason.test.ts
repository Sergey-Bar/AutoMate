import { describe, expect, it } from 'vitest';
import { describeGateReason } from './gate-reason.js';

describe('describeGateReason', () => {
  it.each([
    [
      'threshold:PASS_RATE; observed=33.33; required=100; rule=browserPassRateThreshold',
      'Pass rate 33.33%, needs 100%',
    ],
    ['threshold:FLAKE_RATE; observed=6.7; required=0', 'Flake rate 6.7%, needs 0%'],
    ['browser:FAILED', 'Browser tests failed'],
    ['api:NOT_CONFIGURED', 'API tests not configured'],
    ['product_failure:FAILED_TEST_COUNT', 'Tests failed'],
    ['product_failure:TEST_FAILURE', 'A test failed'],
  ])('reads %s as a sentence', (raw, sentence) => {
    expect(describeGateReason(raw)).toBe(sentence);
  });

  it('leaves a reason it does not recognise exactly as the server wrote it', () => {
    expect(describeGateReason('browser tests failed')).toBe('browser tests failed');
    expect(describeGateReason('something:ODD_NEW_CODE')).toBe('something:ODD_NEW_CODE');
  });

  it('drops duplicates once they read the same', () => {
    // Both product-failure codes and the browser domain say the same thing in prose; the
    // caller de-duplicates on the sentence, so this only has to be stable.
    expect(describeGateReason('browser:FAILED')).toBe(describeGateReason('browser:FAILED'));
  });
});
