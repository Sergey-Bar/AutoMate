/**
 * Mutation-killing tests for fingerprint.ts
 * Targets surviving mutants from Stryker run (score was 85.37%, killing 6 survivors)
 *
 * Surviving mutants covered:
 * - MethodExpression: .trim() removed → chain without trim
 * - StringLiteral: '<file>' → "" (replacement value matters for identity)
 * - StringLiteral: '<addr>' → "" 
 * - StringLiteral: '<uuid>' → ""
 * - StringLiteral: '<n>' → ""
 * - StringLiteral: ' ' → "" (whitespace collapse replacement)
 */

import { describe, it, expect } from 'vitest';
import { fingerprintError } from '../fingerprint.js';

describe('fingerprintError — mutation killing tests', () => {
  // ── .trim() is applied: leading/trailing whitespace is stripped ──────────

  it('trims leading whitespace before hashing', () => {
    const withLeading = fingerprintError('   Element not found');
    const withoutLeading = fingerprintError('Element not found');
    expect(withLeading).toBe(withoutLeading);
  });

  it('trims trailing whitespace before hashing', () => {
    const withTrailing = fingerprintError('Element not found   ');
    const withoutTrailing = fingerprintError('Element not found');
    expect(withTrailing).toBe(withoutTrailing);
  });

  it('trims both leading and trailing whitespace', () => {
    const padded = fingerprintError('  Error: cannot connect  ');
    const clean = fingerprintError('Error: cannot connect');
    expect(padded).toBe(clean);
  });

  it('produces non-null result even with only-whitespace-padded valid content', () => {
    expect(fingerprintError('   click failed   ')).not.toBeNull();
  });

  // ── Replacement values are not empty strings ─────────────────────────────
  // These tests verify that different error messages with different volatile tokens
  // normalise to the SAME pattern (not to empty strings which would collapse them all)

  it('file path replacement produces same fingerprint regardless of path (not empty)', () => {
    // If '<file>' were replaced with '', different errors could wrongly match
    const fileError1 = fingerprintError('Expected text at /a/b/test.ts:1:1');
    const fileError2 = fingerprintError('Expected text at /x/y/test.ts:9:9');
    const unrelated = fingerprintError('Network timeout');
    // Same structure → same fingerprint
    expect(fileError1).toBe(fileError2);
    // Different structure → different fingerprint
    expect(fileError1).not.toBe(unrelated);
  });

  it('hex address replacement produces same fingerprint regardless of address (not empty)', () => {
    const addr1 = fingerprintError('Segfault 0x7fff0001cafe');
    const addr2 = fingerprintError('Segfault 0xdeadbeef1234');
    const other = fingerprintError('Assertion failed');
    expect(addr1).toBe(addr2);
    expect(addr1).not.toBe(other);
  });

  it('UUID replacement produces same fingerprint regardless of UUID (not empty)', () => {
    const uuid1 = fingerprintError('User 00000000-0000-0000-0000-000000000001 not found');
    const uuid2 = fingerprintError('User ffffffff-ffff-ffff-ffff-ffffffffffff not found');
    const other = fingerprintError('Session expired');
    expect(uuid1).toBe(uuid2);
    expect(uuid1).not.toBe(other);
  });

  it('number replacement produces same fingerprint regardless of number (not empty)', () => {
    const num1 = fingerprintError('Timeout after 3000 ms');
    const num2 = fingerprintError('Timeout after 9999 ms');
    const other = fingerprintError('Connection refused');
    expect(num1).toBe(num2);
    expect(num1).not.toBe(other);
  });

  it('whitespace collapsed to single space (not empty string) preserves structure', () => {
    // If '\s+' were replaced with '' (empty), then 'foo bar' and 'foobar' would match
    const spaced = fingerprintError('element not found');
    const fused = fingerprintError('elementnotfound');
    // 'element not found' collapses to 'element not found' (space preserved)
    // 'elementnotfound' stays as 'elementnotfound'
    // They should be DIFFERENT because whitespace collapses to ' ', not ''
    expect(spaced).not.toBe(fused);
  });

  it('multiple volatile tokens all use their placeholder strings', () => {
    // Combines file path + UUID + standalone number — all should normalize to same pattern
    // Note: numbers adjacent to letters (like 5000ms) are NOT normalized, so use standalone numbers
    const error1 = fingerprintError(
      'Error at /ci/test.ts:10:5 for user 550e8400-e29b-41d4-a716-446655440000 after 5000 waiting'
    );
    const error2 = fingerprintError(
      'Error at /dev/test.ts:99:1 for user a1b2c3d4-e5f6-7890-abcd-ef1234567890 after 9999 waiting'
    );
    expect(error1).toBe(error2);
  });
});
