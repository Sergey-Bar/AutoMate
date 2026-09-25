/**
 * Sanitise error values before logging so that secrets embedded in error
 * objects (apiKey, token, password, …) are never written to stdout/stderr.
 *
 * Sentry receives the **original** unsanitised value — it has its own
 * scrubbing pipeline.
 */

const SENSITIVE_KEY_RE = /^(apikey|api_key|token|password|secret|authorization|cookie|credential)$/i;

export function sanitizeError(value: unknown): unknown {
  if (value == null) return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : val;
    }
    return out;
  }

  // Primitives (string, number, boolean, bigint, symbol) pass through as-is
  return value;
}
