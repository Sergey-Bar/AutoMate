/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import { fingerprintError } from './fingerprint.js';

describe('fingerprintError', () => {
  // ── Null / empty input ──────────────────────────────────────────────────
  it('returns null for null input', () => {
    expect(fingerprintError(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(fingerprintError(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(fingerprintError('')).toBeNull();
  });

  // ── Valid output format ─────────────────────────────────────────────────
  it('returns a 12-character hex string for valid input', () => {
    const result = fingerprintError('some error message');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(12);
    expect(result).toMatch(/^[0-9a-f]{12}$/);
  });

  // ── Normalization: file paths ───────────────────────────────────────────
  it('normalizes file paths so different paths yield same fingerprint', () => {
    const a = fingerprintError('Error at /home/user/project/test.ts:10:5');
    const b = fingerprintError('Error at /ci/build/test.ts:99:12');
    expect(a).toBe(b);
  });

  it('normalizes Windows-style file paths', () => {
    const a = fingerprintError('Error at .\\src\\foo.js:1:1');
    const b = fingerprintError('Error at /home/user/src/foo.js:22:33');
    expect(a).toBe(b);
  });

  // ── Normalization: hex addresses ────────────────────────────────────────
  it('normalizes hex memory addresses', () => {
    const a = fingerprintError('Segfault at 0x7fff1234abcd');
    const b = fingerprintError('Segfault at 0xdeadbeef0000');
    expect(a).toBe(b);
  });

  // ── Normalization: UUIDs ────────────────────────────────────────────────
  it('normalizes UUIDs', () => {
    const a = fingerprintError('Failed for user 550e8400-e29b-41d4-a716-446655440000');
    const b = fingerprintError('Failed for user a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(a).toBe(b);
  });

  // ── Normalization: standalone numbers ───────────────────────────────────
  it('normalizes standalone multi-digit numbers', () => {
    const a = fingerprintError('Timeout after 3000 waiting for selector');
    const b = fingerprintError('Timeout after 5000 waiting for selector');
    expect(a).toBe(b);
  });

  // ── Normalization: whitespace ───────────────────────────────────────────
  it('normalizes whitespace differences', () => {
    const a = fingerprintError('Error:   cannot   find   element');
    const b = fingerprintError('Error: cannot find element');
    expect(a).toBe(b);
  });

  // ── Deterministic ───────────────────────────────────────────────────────
  it('same error message always returns same fingerprint', () => {
    const msg = 'Expected element to be visible';
    expect(fingerprintError(msg)).toBe(fingerprintError(msg));
  });

  // ── Different errors → different fingerprints ───────────────────────────
  it('semantically different errors produce different fingerprints', () => {
    const a = fingerprintError('Element not found');
    const b = fingerprintError('Network request failed');
    expect(a).not.toBe(b);
  });

  it('different assertion messages produce different fingerprints', () => {
    const a = fingerprintError('Expected true to be false');
    const b = fingerprintError('Expected element to have text "hello"');
    expect(a).not.toBe(b);
  });

  // ── Complex real-world error ────────────────────────────────────────────
  it('handles complex Playwright error with file paths', () => {
    const a = fingerprintError(
      'locator.click: Timeout exceeded.\nCall log:\n  - waiting for locator at /home/ci/tests/login.spec.ts:42:15'
    );
    const b = fingerprintError(
      'locator.click: Timeout exceeded.\nCall log:\n  - waiting for locator at /Users/dev/tests/login.spec.ts:10:3'
    );
    expect(a).toBe(b);
  });

  it('does not normalize numbers attached to letters like 3000ms', () => {
    const a = fingerprintError('Timeout 3000ms exceeded');
    const b = fingerprintError('Timeout 5000ms exceeded');
    // 3000ms and 5000ms are not standalone numbers (adjacent to 'ms'), so different fingerprints
    expect(a).not.toBe(b);
  });

  // ── Mutation-killing: fingerprint length is exactly 12 ──────────────────

  it('fingerprint length is exactly 12 (not 11 or 13) — kills NumberLiteral slice(0, 12) mutation', () => {
    const result = fingerprintError('some error message');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(12);
    expect(result!.length).not.toBe(11);
    expect(result!.length).not.toBe(13);
    expect(result!.length).not.toBe(64); // full sha256
  });

  it('fingerprint uses SHA-256 hex output (lowercase hex chars only) — kills StringLiteral "hex" mutation', () => {
    const result = fingerprintError('test error');
    expect(result).not.toBeNull();
    // Must be lowercase hex only (not base64 or uppercase)
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).not.toMatch(/[A-Z]/);
  });

  it('fingerprintError returns null for null (falsy guard works) — kills BlockStatement {} mutation', () => {
    expect(fingerprintError(null)).toBeNull();
    expect(fingerprintError(undefined)).toBeNull();
  });

  it('fingerprintError returns null for empty string (falsy guard) — kills ConditionalExpression mutation', () => {
    // Empty string is falsy → should return null, not try to hash it
    const result = fingerprintError('');
    expect(result).toBeNull();
  });

  it('fingerprintError returns non-null string for non-empty message — kills ConditionalExpression inversion mutation', () => {
    // If (!message) were mutated to (message), it would return null for non-empty input
    const result = fingerprintError('a');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('normalize: UUID replacement pattern works correctly — kills StringLiteral regex mutation', () => {
    // If UUID regex were mutated to empty string or wrong pattern, UUIDs would survive
    const a = fingerprintError('Error for session 550e8400-e29b-41d4-a716-446655440000 expired');
    const b = fingerprintError('Error for session 11111111-2222-3333-4444-555555555555 expired');
    expect(a).toBe(b);
    // And it's different from a message without UUID
    const c = fingerprintError('Error for session expired');
    expect(a).not.toBe(c);
  });

  it('normalize: hex address replacement works correctly — kills StringLiteral regex mutation', () => {
    // Different hex addresses → same fingerprint after normalization
    const a = fingerprintError('Process crashed at 0xdeadbeef1234');
    const b = fingerprintError('Process crashed at 0x1234deadbeef');
    expect(a).toBe(b);
  });

  it('normalize: whitespace collapse produces same fingerprint — kills StringLiteral " " space mutation', () => {
    // Extra internal whitespace should be collapsed
    const a = fingerprintError('element  not   found');
    const b = fingerprintError('element not found');
    expect(a).toBe(b);
  });

  it('normalize: leading/trailing whitespace trimmed — kills MethodExpression .trim() mutation', () => {
    const a = fingerprintError('  element not found  ');
    const b = fingerprintError('element not found');
    expect(a).toBe(b);
  });
});
