/**
 * Targeted mutation-killing tests for sql-browser/src/safety.ts.
 *
 * Surviving mutants:
 * - MethodExpression on line 17: sql.trim() → sql (removes .trim() call)
 * - StringLiteral on line 20: 'SQL query must not be empty' → ''
 */
import { describe, expect, it } from 'vitest';
import { validateSQL } from './safety.js';

describe('safety.ts — mutation killers', () => {
  // Kills MethodExpression mutant on line 17: sql.trim() → sql
  // If .trim() is removed, whitespace-only strings remain truthy,
  // bypassing the empty check and proceeding to the prefix check
  // which gives a different error message.
  it('whitespace-only SQL is rejected with "empty" reason — kills .trim() MethodExpression mutant', () => {
    const result = validateSQL('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // With trim() working: '   '.trim() === '' → reason is 'SQL query must not be empty'
      // Without trim(): '   ' is truthy → proceeds to prefix check → different reason
      expect(result.reason).toBe('SQL query must not be empty');
    }
  });

  it('tab-only SQL is rejected with "empty" reason — kills .trim() MethodExpression mutant', () => {
    const result = validateSQL('\t\t\t');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('SQL query must not be empty');
    }
  });

  it('newline-only SQL is rejected with "empty" reason — kills .trim() MethodExpression mutant', () => {
    const result = validateSQL('\n\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('SQL query must not be empty');
    }
  });

  it('mixed whitespace SQL is rejected with "empty" reason — kills .trim() MethodExpression mutant', () => {
    const result = validateSQL('  \t\n  ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('SQL query must not be empty');
    }
  });

  it('SQL with leading whitespace before SELECT is valid — confirms .trim() works correctly', () => {
    // '  SELECT 1  '.trim() = 'SELECT 1' → valid
    // Without .trim(): '  SELECT 1  ' fails prefix check → would fail
    const result = validateSQL('  SELECT * FROM users  ');
    expect(result.ok).toBe(true);
  });

  it('SQL with leading newline before SELECT is valid — confirms .trim() works correctly', () => {
    const result = validateSQL('\nSELECT id FROM users\n');
    expect(result.ok).toBe(true);
  });

  // Kills StringLiteral mutant on line 20: 'SQL query must not be empty' → ''
  // If the string is replaced with '', the empty check still returns {ok: false} but with reason ''
  it('empty string SQL has non-empty error reason — kills StringLiteral "" mutant (line 20)', () => {
    const result = validateSQL('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Mutant replaces reason string with '' → reason would be ''
      expect(result.reason).not.toBe('');
      expect(result.reason).toBeTruthy();
    }
  });

  it('empty SQL reason is exactly "SQL query must not be empty" — kills StringLiteral mutant', () => {
    const result = validateSQL('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('SQL query must not be empty');
    }
  });

  it('empty SQL reason contains "SQL query" — confirms message structure', () => {
    const result = validateSQL('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('SQL query');
      expect(result.reason).toContain('empty');
    }
  });
});
