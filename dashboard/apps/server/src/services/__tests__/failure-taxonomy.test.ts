/**
 * Tests for services/failure-taxonomy.ts
 *
 * Covers:
 *  - classifyFailure: manual override, DB rules (exact/contains/regex), builtin patterns, unknown
 *  - classifyFailures: batch wrapper
 *  - toFailureClassificationRecord: mapping helper
 *  - evaluateRule internals: disabled rules, empty target, invalid regex, no match
 *  - classifyWithBuiltins: all builtin categories + multiple pattern matches → confidence 0.85
 *  - CATEGORY_PRECEDENCE ordering
 */
import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  classifyFailures,
  toFailureClassificationRecord,
  CATEGORY_PRECEDENCE,
  type FailureInput,
  type TaxonomyRule,
  type TaxonomyRuleField,
} from '../failure-taxonomy.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<FailureInput> = {}): FailureInput {
  return {
    resultId: 'result-1',
    errorMessage: null,
    errorStack: null,
    testName: 'some test',
    runId: 'run-1',
    filePath: null,
    manualCategory: null,
    isManualOverride: false,
    ...overrides,
  };
}

function makeRule(overrides: Partial<TaxonomyRule> = {}): TaxonomyRule {
  return {
    id: 'rule-1',
    category: 'app_bug',
    matchType: 'contains',
    pattern: 'assertion failed',
    field: 'error_message',
    priority: 1,
    enabled: true,
    ...overrides,
  };
}

// ── CATEGORY_PRECEDENCE ───────────────────────────────────────────────────────

describe('CATEGORY_PRECEDENCE', () => {
  it('exports the expected category order', () => {
    expect(CATEGORY_PRECEDENCE).toEqual([
      'infra_issue',
      'env_issue',
      'test_debt',
      'flaky',
      'app_bug',
      'unknown',
    ]);
  });
});

// ── classifyFailure: manual override ─────────────────────────────────────────

describe('classifyFailure — manual override', () => {
  it('returns the manual category when isManualOverride is true and manualCategory is set', () => {
    const input = makeInput({ isManualOverride: true, manualCategory: 'infra_issue' });
    const result = classifyFailure(input);
    expect(result.category).toBe('infra_issue');
    expect(result.confidence).toBe(1);
    expect(result.matchedRuleId).toBeNull();
    expect(result.evidence).toContain("Manual override preserved for category 'infra_issue'");
  });

  it('does NOT use manual override when isManualOverride is false even if manualCategory is set', () => {
    const input = makeInput({
      isManualOverride: false,
      manualCategory: 'infra_issue',
      errorMessage: 'ECONNREFUSED connecting to DB',
    });
    const result = classifyFailure(input);
    // Falls through to builtins — matches infra_issue via ECONNREFUSED
    expect(result.category).toBe('infra_issue');
    expect(result.matchedRuleId).toBeNull(); // from builtins, not DB rule
  });
});

// ── classifyFailure: DB rules ─────────────────────────────────────────────────

describe('classifyFailure — DB rules', () => {
  it('matches a DB rule with matchType "contains"', () => {
    const rule = makeRule({ matchType: 'contains', pattern: 'assertion failed', field: 'error_message', category: 'app_bug' });
    const input = makeInput({ errorMessage: 'AssertionError: assertion failed in step 3' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('app_bug');
    expect(result.confidence).toBe(0.9);
    expect(result.matchedRuleId).toBe('rule-1');
    expect(result.evidence).toContain("Matched DB contains rule 'rule-1' on error_message");
  });

  it('matches a DB rule with matchType "exact"', () => {
    const rule = makeRule({ matchType: 'exact', pattern: 'timeout exceeded', field: 'error_message', category: 'flaky' });
    const input = makeInput({ errorMessage: 'timeout exceeded' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('flaky');
    expect(result.confidence).toBe(1);
    expect(result.matchedRuleId).toBe('rule-1');
    expect(result.evidence).toContain("Matched DB exact rule 'rule-1' on error_message");
  });

  it('exact match is case-insensitive via normalize', () => {
    const rule = makeRule({ matchType: 'exact', pattern: 'TIMEOUT EXCEEDED', field: 'error_message', category: 'flaky' });
    const input = makeInput({ errorMessage: 'timeout exceeded' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('flaky');
  });

  it('matches a DB rule with matchType "regex"', () => {
    const rule = makeRule({ matchType: 'regex', pattern: 'ERR_\\d+', field: 'error_message', category: 'infra_issue' });
    const input = makeInput({ errorMessage: 'Error code ERR_404 not found' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('infra_issue');
    expect(result.confidence).toBe(0.9);
    expect(result.matchedRuleId).toBe('rule-1');
    expect(result.evidence).toContain('/ERR_\\d+/i');
  });

  it('skips a disabled DB rule', () => {
    const rule = makeRule({ enabled: false, matchType: 'contains', pattern: 'assertion failed', field: 'error_message' });
    const input = makeInput({ errorMessage: 'assertion failed' });
    // No DB rules match → falls through to builtins → matches app_bug via AssertionError patterns? No.
    // "assertion failed" matches builtin app_bug pattern /assertion failed/i
    const result = classifyFailure(input, [rule]);
    expect(result.matchedRuleId).toBeNull(); // builtins don't set a rule ID
    expect(result.category).toBe('app_bug');
  });

  it('returns null for DB rule when field value is empty', () => {
    const rule = makeRule({ matchType: 'contains', pattern: 'error', field: 'error_message' });
    // error_message is null → field value empty → rule skipped
    const input = makeInput({ errorMessage: null, errorStack: null });
    const result = classifyFailure(input, [rule]);
    // Falls through to builtins → no match → unknown
    expect(result.category).toBe('unknown');
  });

  it('returns null for DB rule when regex is invalid and does not throw', () => {
    const rule = makeRule({ matchType: 'regex', pattern: '[invalid(', field: 'error_message', category: 'infra_issue' });
    const input = makeInput({ errorMessage: 'some error' });
    // Invalid regex → caught → rule returns null → falls through to builtins
    const result = classifyFailure(input, [rule]);
    expect(result.matchedRuleId).toBeNull();
  });

  it('sorts DB rules by priority ascending then by id', () => {
    const highPriority = makeRule({ id: 'rule-a', priority: 1, category: 'flaky', matchType: 'contains', pattern: 'timeout' });
    const lowPriority = makeRule({ id: 'rule-b', priority: 10, category: 'app_bug', matchType: 'contains', pattern: 'timeout' });
    const input = makeInput({ errorMessage: 'timeout in step 2' });
    const result = classifyFailure(input, [lowPriority, highPriority]);
    // Higher priority (lower number) wins
    expect(result.category).toBe('flaky');
    expect(result.matchedRuleId).toBe('rule-a');
  });

  it('matches DB rule on error_stack field', () => {
    const rule = makeRule({ field: 'error_stack', pattern: 'at SomeFunction', matchType: 'contains', category: 'test_debt' });
    const input = makeInput({ errorStack: 'Error\n  at SomeFunction (file.ts:10)' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('test_debt');
    expect(result.matchedRuleId).toBe('rule-1');
  });

  it('matches DB rule on test_name field', () => {
    const rule = makeRule({ field: 'test_name', pattern: 'login flow', matchType: 'contains', category: 'app_bug' });
    const input = makeInput({ testName: 'login flow test' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('app_bug');
  });

  it('matches DB rule on test_title field (alias for test_name)', () => {
    const rule = makeRule({ field: 'test_title', pattern: 'checkout', matchType: 'contains', category: 'app_bug' });
    const input = makeInput({ testName: 'checkout should succeed' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('app_bug');
  });

  it('matches DB rule on file_path field', () => {
    const rule = makeRule({ field: 'file_path', pattern: 'auth.spec', matchType: 'contains', category: 'env_issue' });
    const input = makeInput({ filePath: 'tests/auth.spec.ts' });
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('env_issue');
  });

  it('valueForRuleField hits default case for unrecognised field and evaluateRule returns null', () => {
    // Cast an unknown string to exercise the `default: return ''` branch in valueForRuleField
    const rule = makeRule({ field: 'unknown_field' as unknown as TaxonomyRuleField, matchType: 'contains', pattern: 'anything' });
    const input = makeInput({ errorMessage: null, errorStack: null, testName: 'plain test', filePath: null });
    // valueForRuleField returns '' for the unknown field → target falsy → evaluateRule returns null
    // Falls through to builtins with no matching patterns → unknown
    const result = classifyFailure(input, [rule]);
    expect(result.category).toBe('unknown');
  });
});

// ── classifyFailure: builtins ─────────────────────────────────────────────────

describe('classifyFailure — builtin patterns', () => {
  it('classifies infra_issue via ECONNREFUSED in error_message', () => {
    const input = makeInput({ errorMessage: 'connect ECONNREFUSED 127.0.0.1:5432' });
    const result = classifyFailure(input);
    expect(result.category).toBe('infra_issue');
    expect(result.confidence).toBe(0.8);
    expect(result.matchedRuleId).toBeNull();
    expect(result.evidence).toContain('infra_issue');
  });

  it('classifies infra_issue via out of memory in error_stack', () => {
    const input = makeInput({ errorStack: 'FATAL ERROR: out of memory' });
    const result = classifyFailure(input);
    expect(result.category).toBe('infra_issue');
  });

  it('classifies env_issue via missing env in error_message', () => {
    const input = makeInput({ errorMessage: 'missing env variable DATABASE_URL' });
    const result = classifyFailure(input);
    expect(result.category).toBe('env_issue');
  });

  it('classifies env_issue via EADDRINUSE in error_message', () => {
    const input = makeInput({ errorMessage: 'listen EADDRINUSE :::3000' });
    const result = classifyFailure(input);
    expect(result.category).toBe('env_issue');
  });

  it('classifies test_debt via fixme in test name', () => {
    const input = makeInput({ testName: 'FIXME: this test is broken' });
    const result = classifyFailure(input);
    expect(result.category).toBe('test_debt');
  });

  it('classifies test_debt via "not implemented" in error_message', () => {
    const input = makeInput({ errorMessage: 'not implemented yet' });
    const result = classifyFailure(input);
    expect(result.category).toBe('test_debt');
  });

  it('classifies flaky via timeout in error_message', () => {
    const input = makeInput({ errorMessage: 'Test timeout exceeded: 30000ms' });
    const result = classifyFailure(input);
    expect(result.category).toBe('flaky');
  });

  it('classifies flaky via race condition in error_message', () => {
    const input = makeInput({ errorMessage: 'race condition detected' });
    const result = classifyFailure(input);
    expect(result.category).toBe('flaky');
  });

  it('classifies app_bug via AssertionError in error_message', () => {
    const input = makeInput({ errorMessage: 'AssertionError: expected true but got false' });
    const result = classifyFailure(input);
    expect(result.category).toBe('app_bug');
  });

  it('classifies app_bug via toBe in error_message', () => {
    const input = makeInput({ errorMessage: 'Expected toBe 5 but received 3' });
    const result = classifyFailure(input);
    expect(result.category).toBe('app_bug');
  });

  it('returns unknown when no patterns match', () => {
    const input = makeInput({ errorMessage: null, errorStack: null, testName: 'plain test name', filePath: null });
    const result = classifyFailure(input);
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.matchedRuleId).toBeNull();
    expect(result.evidence).toBe('No DB or builtin taxonomy rules matched');
  });

  it('returns confidence 0.85 when multiple builtin patterns match for same category', () => {
    // Two infra patterns: ECONNREFUSED and ETIMEDOUT both match
    const input = makeInput({ errorMessage: 'ECONNREFUSED and ETIMEDOUT' });
    const result = classifyFailure(input);
    expect(result.category).toBe('infra_issue');
    expect(result.confidence).toBe(0.85);
  });

  it('uses CATEGORY_PRECEDENCE: infra_issue wins over env_issue', () => {
    // "permission denied" matches both env_issue and infra_issue (EPERM/EACCES)
    const input = makeInput({ errorMessage: 'permission denied EACCES and environment variable missing' });
    const result = classifyFailure(input);
    // infra_issue comes first in precedence
    expect(result.category).toBe('infra_issue');
  });

  it('searches errorMessage, errorStack, testName, and filePath for builtins', () => {
    // Pattern only in filePath
    const input = makeInput({
      errorMessage: null,
      errorStack: null,
      testName: 'normal test',
      filePath: 'tests/FIXME-this-is-broken.spec.ts',
    });
    const result = classifyFailure(input);
    expect(result.category).toBe('test_debt');
  });
});

// ── classifyFailures: batch wrapper ──────────────────────────────────────────

describe('classifyFailures', () => {
  it('classifies an empty array and returns []', () => {
    expect(classifyFailures([])).toEqual([]);
  });

  it('classifies multiple inputs independently', () => {
    const inputs: FailureInput[] = [
      makeInput({ errorMessage: 'ECONNREFUSED' }),
      makeInput({ errorMessage: null, testName: 'plain test', errorStack: null }),
      makeInput({ isManualOverride: true, manualCategory: 'test_debt' }),
    ];
    const results = classifyFailures(inputs);
    expect(results).toHaveLength(3);
    expect(results[0].category).toBe('infra_issue');
    expect(results[1].category).toBe('unknown');
    expect(results[2].category).toBe('test_debt');
  });

  it('passes DB rules to each classification', () => {
    const rule = makeRule({ category: 'env_issue', matchType: 'contains', pattern: 'missing config' });
    const inputs = [
      makeInput({ errorMessage: 'missing config file' }),
      makeInput({ errorMessage: 'unrelated error' }),
    ];
    const results = classifyFailures(inputs, [rule]);
    expect(results[0].category).toBe('env_issue');
    expect(results[0].matchedRuleId).toBe('rule-1');
    // second doesn't match the DB rule, falls through to builtins → unknown
    expect(results[1].matchedRuleId).toBeNull();
  });
});

// ── toFailureClassificationRecord ────────────────────────────────────────────

describe('toFailureClassificationRecord', () => {
  it('maps input + classification to a FailureClassificationRecord', () => {
    const input = makeInput({ resultId: 'r-123', runId: 'run-456' });
    const classification = {
      category: 'flaky' as const,
      confidence: 0.8,
      matchedRuleId: null,
      evidence: 'Matched builtin flaky pattern(s): timeout',
    };
    const record = toFailureClassificationRecord(input, classification);
    expect(record.resultId).toBe('r-123');
    expect(record.runId).toBe('run-456');
    expect(record.category).toBe('flaky');
    expect(record.confidence).toBe(0.8);
    expect(record.matchedRuleId).toBeNull();
    expect(record.evidence).toBe('Matched builtin flaky pattern(s): timeout');
    expect(record.classifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes matchedRuleId when a DB rule matched', () => {
    const input = makeInput({ resultId: 'r-789', runId: 'run-101' });
    const classification = {
      category: 'app_bug' as const,
      confidence: 0.9,
      matchedRuleId: 'rule-42',
      evidence: "Matched DB contains rule 'rule-42' on error_message: 'assertion'",
    };
    const record = toFailureClassificationRecord(input, classification);
    expect(record.matchedRuleId).toBe('rule-42');
  });
});
