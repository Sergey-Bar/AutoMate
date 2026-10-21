import { describe, expect, it } from 'vitest';
import { describeGateReason } from './gate-reason.js';

/**
 * Every shape `evaluateQualityGate` (apps/api/src/execution/quality-gate.ts) writes, spelled
 * exactly as its `refusal()` helper spells it — `code; key=value; …`, keys in the order the
 * gate passes them. A fixture in a shape the server never produces is a test of nothing.
 */
describe('describeGateReason', () => {
  it.each([
    [
      'threshold:PASS_RATE; observed=33.33; required=100; rule=browserPassRateThreshold',
      'Pass rate 33.33%, needs 100%',
    ],
    ['threshold:FLAKY_RATE; observed=6.70; max=0; rule=maxFlakyRate', 'Flaky rate 6.70%, limit 0%'],
    [
      'threshold:DURATION; observed=125000; max=60000; unit=ms; rule=maxDurationMs',
      'Duration 2.1 min, limit 1.0 min',
    ],
    [
      'threshold:PER_RULE_PASS_RATE; observed=80.00; required=95; domain=api; rule=rules[api].minimumPassRate',
      'API pass rate 80.00%, needs 95%',
    ],
    ['browser:FAILED', 'Browser tests failed'],
    ['api:NOT_CONFIGURED', 'API tests not configured'],
    ['browser:UNKNOWN', 'Browser tests have no verdict'],
    ['security:WARNING', 'Security checks warned'],
    ['browser:MISSING_EVIDENCE', 'Browser tests are missing required evidence'],
    ['product_failure:FAILED_TEST_COUNT', 'Tests failed'],
    // Emitted when the run's outcome is failed or its phase blocked — not only on a test.
    ['product_failure:TEST_FAILURE', 'The run failed'],
    ['evidence:NO_TESTS', 'No tests ran'],
    ['evidence:MISSING_REQUIRED_EVIDENCE', 'Required evidence is missing'],
    ['runner_lost:RUNNER_INFRASTRUCTURE', 'The runner was lost'],
    ['infra_failed:RUNNER_INFRASTRUCTURE', 'The runner infrastructure failed'],
    ['config_failed:CONFIGURATION', 'The run was misconfigured'],
    ['cancelled:EXECUTION_CANCELLED', 'The run was cancelled'],
    ['timed_out:EXECUTION_TIMEOUT', 'The run timed out'],
  ])('reads %s as a sentence', (raw, sentence) => {
    expect(describeGateReason(raw)).toBe(sentence);
  });

  it('keeps two domains failing at the same numbers apart', () => {
    const api = describeGateReason(
      'threshold:PER_RULE_PASS_RATE; observed=80.00; required=95; domain=api; rule=x',
    );
    const browser = describeGateReason(
      'threshold:PER_RULE_PASS_RATE; observed=80.00; required=95; domain=browser; rule=y',
    );
    expect(api).not.toBe(browser);
  });

  it('leaves a reason it does not recognise exactly as the server wrote it', () => {
    expect(describeGateReason('browser tests failed')).toBe('browser tests failed');
    expect(describeGateReason('something:ODD_NEW_CODE')).toBe('something:ODD_NEW_CODE');
    expect(describeGateReason('threshold:NEW_METRIC; observed=1')).toBe(
      'threshold:NEW_METRIC; observed=1',
    );
  });
});
