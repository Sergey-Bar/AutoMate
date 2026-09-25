import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PRECEDENCE,
  classifyFailure,
  classifyFailures,
  toFailureClassificationRecord,
  type FailureInput,
  type TaxonomyRule,
} from './failure-taxonomy.js';

function makeInput(overrides: Partial<FailureInput> = {}): FailureInput {
  return {
    resultId: 'result-1',
    errorMessage: 'Generic test failure',
    errorStack: null,
    testName: 'should run',
    runId: 'run-1',
    ...overrides,
  };
}

describe('failure taxonomy classifier', () => {
  it('exposes deterministic precedence order', () => {
    expect(CATEGORY_PRECEDENCE).toEqual([
      'infra_issue',
      'env_issue',
      'test_debt',
      'flaky',
      'app_bug',
      'unknown',
    ]);
  });

  it('returns same category and confidence for same input', () => {
    const input = makeInput({ errorMessage: 'connect ECONNREFUSED 127.0.0.1:3000' });

    const first = classifyFailure(input);
    const second = classifyFailure(input);

    expect(second).toEqual(first);
  });

  it('classifies infra_issue patterns', () => {
    expect(classifyFailure(makeInput({ errorMessage: 'connect ECONNREFUSED 127.0.0.1:3000' })).category).toBe('infra_issue');
    expect(classifyFailure(makeInput({ errorMessage: 'pod terminated: OOMKilled' })).category).toBe('infra_issue');
    expect(classifyFailure(makeInput({ errorMessage: 'write failed: no space left on device' })).category).toBe('infra_issue');
  });

  it('classifies env_issue patterns', () => {
    expect(classifyFailure(makeInput({ errorMessage: 'missing env API_KEY' })).category).toBe('env_issue');
    expect(classifyFailure(makeInput({ errorMessage: 'EADDRINUSE: port 3000 in use' })).category).toBe('env_issue');
    expect(classifyFailure(makeInput({ errorMessage: 'SSL certificate verify failed' })).category).toBe('env_issue');
  });

  it('classifies test_debt patterns', () => {
    expect(classifyFailure(makeInput({ errorMessage: 'TODO: pending implementation for this suite' })).category).toBe('test_debt');
    expect(classifyFailure(makeInput({ errorMessage: 'FIXME remove hardcoded selector' })).category).toBe('test_debt');
  });

  it('classifies flaky patterns', () => {
    expect(classifyFailure(makeInput({ errorMessage: 'Test timeout after 30000ms' })).category).toBe('flaky');
    expect(classifyFailure(makeInput({ errorMessage: 'Intermittent failure observed; retry passed' })).category).toBe('flaky');
  });

  it('classifies app_bug assertion patterns', () => {
    expect(classifyFailure(makeInput({ errorMessage: 'AssertionError: expected 1 but received 2' })).category).toBe('app_bug');
    expect(classifyFailure(makeInput({ errorMessage: 'expect(user.name).toEqual("alice") failed' })).category).toBe('app_bug');
  });

  it('returns unknown when no rules match', () => {
    const result = classifyFailure(makeInput({ errorMessage: 'banana spaceship kaleidoscope' }));
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.matchedRuleId).toBeNull();
  });

  it('enforces precedence when multiple builtin categories match', () => {
    const result = classifyFailure(makeInput({
      errorMessage: 'AssertionError timeout while socket hang up',
    }));

    expect(result.category).toBe('infra_issue');
    expect(result.confidence).toBe(0.8);
  });

  it('gives higher confidence when multiple builtin rules in same category match', () => {
    const result = classifyFailure(makeInput({
      errorMessage: 'timeout timed out while waitFor timeout',
    }));

    expect(result.category).toBe('flaky');
    expect(result.confidence).toBe(0.85);
  });

  it('gives db rules precedence over builtin rules', () => {
    const rules: TaxonomyRule[] = [
      {
        id: 'rule-db-1',
        category: 'test_debt',
        matchType: 'contains',
        pattern: 'assertionerror',
        field: 'error_message',
        priority: 1,
        enabled: true,
      },
    ];

    const result = classifyFailure(
      makeInput({ errorMessage: 'AssertionError: expected true but received false' }),
      rules,
    );

    expect(result.category).toBe('test_debt');
    expect(result.confidence).toBe(0.9);
    expect(result.matchedRuleId).toBe('rule-db-1');
  });

  it('uses db exact and regex confidence values correctly', () => {
    const exactRule: TaxonomyRule = {
      id: 'rule-exact',
      category: 'env_issue',
      matchType: 'exact',
      pattern: 'missing env api_key',
      field: 'error_message',
      priority: 1,
      enabled: true,
    };
    const regexRule: TaxonomyRule = {
      id: 'rule-regex',
      category: 'infra_issue',
      matchType: 'regex',
      pattern: 'ECONNREFUSED\\s+127\\.0\\.0\\.1',
      field: 'error_message',
      priority: 1,
      enabled: true,
    };

    const exact = classifyFailure(makeInput({ errorMessage: 'missing env api_key' }), [exactRule]);
    const regex = classifyFailure(
      makeInput({ errorMessage: 'connect ECONNREFUSED 127.0.0.1:3000' }),
      [regexRule],
    );

    expect(exact.confidence).toBe(1);
    expect(regex.confidence).toBe(0.9);
  });

  it('keeps manual category assignments unchanged', () => {
    const result = classifyFailure(makeInput({
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:3000',
      manualCategory: 'app_bug',
      isManualOverride: true,
    }));

    expect(result.category).toBe('app_bug');
    expect(result.confidence).toBe(1);
    expect(result.evidence.toLowerCase()).toContain('manual override');
  });

  it('classifies batches in order', () => {
    const batch = classifyFailures([
      makeInput({ errorMessage: 'missing env API_KEY' }),
      makeInput({ errorMessage: 'AssertionError: expected 1 but received 2', resultId: 'result-2' }),
      makeInput({ errorMessage: 'unknown unstructured issue', resultId: 'result-3' }),
    ]);

    expect(batch).toHaveLength(3);
    expect(batch.map((entry) => entry.category)).toEqual(['env_issue', 'app_bug', 'unknown']);
  });

  it('builds a persistable classification record with evidence', () => {
    const input = makeInput({ errorMessage: 'connect ETIMEDOUT 10.0.0.1' });
    const classification = classifyFailure(input);
    const record = toFailureClassificationRecord(input, classification);

    expect(record).toMatchObject({
      resultId: input.resultId,
      runId: input.runId,
      category: 'infra_issue',
      confidence: 0.8,
      matchedRuleId: null,
      evidence: expect.stringContaining('ETIMEDOUT'),
    });
    expect(new Date(record.classifiedAt).toISOString()).toBe(record.classifiedAt);
  });
});
