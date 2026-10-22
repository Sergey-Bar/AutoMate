import { describe, expect, it } from 'vitest';

import { byConfidenceThenId, categoryForScriptName, dedupeByKey } from './detector.js';

describe('categoryForScriptName', () => {
  it.each([
    ['test:e2e', 'e2e'],
    ['test:end-to-end', 'e2e'],
    ['test:endtoend', 'e2e'],
    ['playwright', 'e2e'],
    ['cypress:run', 'e2e'],
    ['test:e2e-integration', 'e2e'],
    ['test:perf', 'performance'],
    ['load-test', 'performance'],
    ['k6', 'performance'],
    ['benchmark', 'performance'],
    ['test:security', 'security'],
    ['zap', 'security'],
    ['vuln-check', 'security'],
    ['test:integration', 'integration'],
    ['test:contract', 'integration'],
    ['test', 'unit'],
    ['test:watch', 'unit'],
    ['lint', 'unit'],
  ] as const)('%s is %s', (name, expected) => {
    expect(categoryForScriptName(name)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(categoryForScriptName('Test:E2E')).toBe('e2e');
  });

  it('reads a script named for unit tests as a unit suite', () => {
    // `it\b` matches the tail of "unit", so an explicitly unit-labelled script was
    // classified as an integration suite.
    expect(categoryForScriptName('test:unit')).toBe('unit');
    expect(categoryForScriptName('unit')).toBe('unit');
    expect(categoryForScriptName('test:unit:watch')).toBe('unit');
  });

  it('does not read an ordinary word that merely contains a security or load stem as that category', () => {
    expect(categoryForScriptName('test:second-pass')).toBe('unit');
    expect(categoryForScriptName('test:download')).toBe('unit');
  });

  it('still reads the short form "it" as an integration suite', () => {
    expect(categoryForScriptName('test:it')).toBe('integration');
    expect(categoryForScriptName('it')).toBe('integration');
  });
});

describe('dedupeByKey', () => {
  it('keeps the first of each identity and preserves order', () => {
    const items = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 },
    ];
    expect(dedupeByKey(items, (item) => item.id)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });

  it('returns an empty list for an empty list', () => {
    expect(dedupeByKey([], (item: string) => item)).toEqual([]);
  });
});

describe('byConfidenceThenId', () => {
  it('orders higher confidence first', () => {
    const sorted = [
      { id: 'low', confidence: 0.2 },
      { id: 'high', confidence: 0.9 },
    ].sort(byConfidenceThenId);
    expect(sorted.map((item) => item.id)).toEqual(['high', 'low']);
  });

  it('breaks a tie by id so the proposal is stable', () => {
    const sorted = [
      { id: 'b', confidence: 0.5 },
      { id: 'a', confidence: 0.5 },
    ].sort(byConfidenceThenId);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b']);
    expect(byConfidenceThenId({ id: 'a', confidence: 1 }, { id: 'a', confidence: 1 })).toBe(0);
  });
});
