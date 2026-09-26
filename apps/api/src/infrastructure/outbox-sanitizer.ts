/**
 * Outbox payload sanitizer — the single copy of this policy.
 *
 * Two layers, because a denylist alone is not enough in either direction:
 *
 *  1. Structure is **allowlisted** at the envelope level. A new top-level key
 *     appears in the published stream only by being added to
 *     {@link ALLOWED_KEYS}. The previous denylist silently dropped
 *     `fencingToken` (it matches `/token/`) while letting a credential stored
 *     under an innocuous key through.
 *  2. Values are **scanned** for credential shapes, at every depth. A secret
 *     whose key looks harmless is still redacted before it is persisted.
 *
 * `leaseId` is deliberately absent from the allowlist: it is a lease
 * credential, and an SSE consumer must never be able to act as the job holder.
 */

const MAX_DEPTH = 5;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 1024;
const MAX_KEYS = 64;

export const REDACTED = '[redacted]';

/** Top-level keys permitted in an outbox payload. Everything else is dropped. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'aggregateId',
  'artifact',
  'attempt',
  'error',
  'evaluation',
  'eventId',
  'fencingToken',
  'jobId',
  'occurredAt',
  'outcome',
  'payload',
  'phase',
  'runId',
  'sequence',
  'status',
  'summary',
  'testId',
  'type',
  'version',
]);

/**
 * Credential shapes. Deliberately excludes hex digests: a sha256 checksum or
 * content fingerprint is legitimate evidence and is frequently published.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abopsr]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
];

/**
 * Key names that always denote a credential, applied at *nested* levels where
 * the shape is domain-owned and cannot be allowlisted. The top level needs no
 * such list: it is an allowlist, and `fencingToken` survives there because it
 * is explicitly permitted rather than accidentally permitted.
 */
const SENSITIVE_KEY = /secret|password|credential|api[-_]?key|authorization|cookie|private/i;

/** True when a string looks like a credential, whatever it is called. */
export function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/** True when a key name denotes a credential. */
export function looksLikeSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (looksLikeSecret(value)) return REDACTED;
    return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
  }
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value))
    return value.slice(0, MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') return sanitizeNested(value as Record<string, unknown>, depth + 1);
  return null;
}

/**
 * Nested domain data (a test payload, an artifact descriptor) is not
 * allowlisted — its shape is owned by the domain — but sensitive key names are
 * dropped, values are scanned, and depth, breadth and text length are bounded.
 */
function sanitizeNested(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, item] of Object.entries(value)) {
    if (kept >= MAX_KEYS) break;
    if (looksLikeSensitiveKey(key)) continue;
    kept += 1;
    sanitized[key] = sanitizeValue(item, depth);
  }
  return sanitized;
}

/**
 * Sanitizes a top-level outbox envelope. Strictly allowlisted: a key appears in
 * the durable stream only by being added to {@link ALLOWED_KEYS}.
 */
export function sanitizeOutboxEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    sanitized[key] = sanitizeValue(item, 0);
  }
  return sanitized;
}

/**
 * Sanitizes a domain payload whose shape is not owned by this module — a
 * runner event payload, a test descriptor, an artifact descriptor. Credential
 * key names are dropped and values are scanned; depth, breadth and text
 * length are bounded. Used both for nested envelope values and by the durable
 * realtime bus, which sanitizes an event payload at this level.
 */
export function sanitizeOutboxNested(
  value: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const sanitized = sanitizeValue(value, depth);
  return sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}
