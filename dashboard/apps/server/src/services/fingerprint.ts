/**
 * fingerprint.ts
 *
 * Normalizes error messages to produce a stable fingerprint string.
 * The fingerprint strips volatile tokens (file paths, line numbers, memory
 * addresses, UUIDs, hex strings, standalone numbers) so that semantically
 * identical errors from different runs hash to the same value.
 */
import { createHash } from 'crypto';

/**
 * Normalize an error message string to remove volatile tokens.
 * Returns a shorter, stable string suitable for hashing.
 */
function normalize(message: string): string {
  return message
    // Strip full file paths like /path/to/file.ts:12:34 or .\path\to.js:5:1
    .replace(/[\w./\\-]+\.(ts|tsx|js|jsx|mjs|cjs):\d+:\d+/gi, '<file>')
    // Strip hex memory addresses like 0x7fff1234abcd
    .replace(/0x[0-9a-f]{4,}/gi, '<addr>')
    // Strip UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    // Strip standalone numbers with 2+ digits (not adjacent to letters)
    .replace(/(?<![a-zA-Z])\b\d{2,}\b(?![a-zA-Z])/g, '<n>')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Produce a 12-character hex fingerprint from an error message.
 * Returns null for empty/falsy input.
 */
export function fingerprintError(message: string | null | undefined): string | null {
  if (!message) return null;
  const normalized = normalize(message);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}
