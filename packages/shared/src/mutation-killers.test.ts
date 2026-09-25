/**
 * Targeted mutation-killing tests for packages/shared/src/index.ts
 *
 * Surviving mutants:
 * - StringLiteral mutants on line 52 (ExecutionStatusSchema enum values: 'running', 'success', 'error', 'timeout')
 * - Regex mutants on line 78 (TOOL_NAME_PATTERN): removes ^ anchor, removes $ anchor
 * - ConditionalExpression mutant on line 81 (parseJsonSafe !value check always true)
 */
import { describe, expect, it } from 'vitest';
import { TOOL_NAME_PATTERN, parseJsonSafe, ExecutionStatusSchema } from './index.js';

describe('TOOL_NAME_PATTERN — mutation killers (regex anchors)', () => {
  // Kills Regex mutant removing ^ anchor: /[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/
  // Without ^, patterns with an invalid prefix (non-letter start) would still match
  // because without ^ the match can start anywhere in the string
  it('rejects toolName starting with a digit (invalid per ^ anchor rule) — kills ^ anchor mutant', () => {
    // '1github.create_issue' fails because ^ requires start with [a-z]
    // Without ^: the regex would find 'github.create_issue' inside the string and match
    expect(TOOL_NAME_PATTERN.test('1github.create_issue')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('123.tool')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('_connector.tool')).toBe(false);
  });

  it('rejects toolName with leading space — kills ^ anchor mutant', () => {
    // ' github.create' — starts with space, invalid
    // Without ^: the regex could match 'github.create' inside ' github.create'
    expect(TOOL_NAME_PATTERN.test(' github.create')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('\ngithub.create_issue')).toBe(false);
  });

  // Kills Regex mutant removing $ anchor: /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*/
  // Without $, patterns with a suffix would still match
  it('rejects toolName with trailing characters after tool name — kills $ anchor mutant', () => {
    expect(TOOL_NAME_PATTERN.test('github.create ')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('github.create\n')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('github.create_issue.extra')).toBe(false);
  });

  it('accepts exact valid formats with both anchors — confirms anchors work', () => {
    expect(TOOL_NAME_PATTERN.test('github.create_issue')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('jira.search_issues')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('slack.post_summary')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('sql-browser.query')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('a.b')).toBe(true);
  });

  it('rejects names without a dot separator', () => {
    expect(TOOL_NAME_PATTERN.test('github')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('create_issue')).toBe(false);
  });

  it('rejects names starting with a dot', () => {
    expect(TOOL_NAME_PATTERN.test('.create')).toBe(false);
  });

  it('rejects names with uppercase letters', () => {
    expect(TOOL_NAME_PATTERN.test('GitHub.create_issue')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('github.Create_issue')).toBe(false);
  });
});

describe('parseJsonSafe — mutation killers (conditional expression)', () => {
  // Kills ConditionalExpression mutant: !value always true → always returns fallback
  it('returns parsed object for valid JSON string — kills always-true conditional mutant', () => {
    const result = parseJsonSafe<{ key: string }>('{"key":"hello"}', { key: 'default' });
    // If mutant survives (always returns fallback), this would return { key: 'default' }
    expect(result).toEqual({ key: 'hello' });
    expect(result).not.toEqual({ key: 'default' });
  });

  it('returns parsed array for valid JSON array string — kills always-true conditional mutant', () => {
    const result = parseJsonSafe<number[]>('[1,2,3]', []);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toEqual([]);
  });

  it('returns parsed number for valid JSON number string — kills always-true conditional mutant', () => {
    const result = parseJsonSafe<number>('42', 0);
    expect(result).toBe(42);
    expect(result).not.toBe(0);
  });

  it('returns fallback for null — confirms falsy check works', () => {
    const result = parseJsonSafe(null, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('returns fallback for empty string — confirms falsy check works', () => {
    const result = parseJsonSafe('', 'default');
    expect(result).toBe('default');
  });

  it('returns fallback for invalid JSON — confirms parse error handling', () => {
    const result = parseJsonSafe('not-json', []);
    expect(result).toEqual([]);
  });

  it('returns fallback for partial JSON — confirms parse error handling', () => {
    const result = parseJsonSafe('{"key":}', { ok: false });
    expect(result).toEqual({ ok: false });
  });
});

describe('ExecutionStatusSchema — mutation killers (StringLiteral enum values)', () => {
  // Kills StringLiteral mutants on line 52 — each enum value replaced with ''
  it('accepts "running" status — kills StringLiteral mutant replacing running with ""', () => {
    const result = ExecutionStatusSchema.safeParse('running');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('running');
  });

  it('accepts "success" status — kills StringLiteral mutant replacing success with ""', () => {
    const result = ExecutionStatusSchema.safeParse('success');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('success');
  });

  it('accepts "error" status — kills StringLiteral mutant replacing error with ""', () => {
    const result = ExecutionStatusSchema.safeParse('error');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('error');
  });

  it('accepts "timeout" status — kills StringLiteral mutant replacing timeout with ""', () => {
    const result = ExecutionStatusSchema.safeParse('timeout');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('timeout');
  });

  it('rejects empty string — confirms enum does not accept "" (mutant value)', () => {
    const result = ExecutionStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects unknown status values', () => {
    expect(ExecutionStatusSchema.safeParse('pending').success).toBe(false);
    expect(ExecutionStatusSchema.safeParse('failed').success).toBe(false);
  });

  it('has exactly 4 valid options', () => {
    expect(ExecutionStatusSchema.options).toHaveLength(4);
    expect(ExecutionStatusSchema.options).toContain('running');
    expect(ExecutionStatusSchema.options).toContain('success');
    expect(ExecutionStatusSchema.options).toContain('error');
    expect(ExecutionStatusSchema.options).toContain('timeout');
  });
});
