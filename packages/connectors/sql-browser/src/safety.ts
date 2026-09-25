export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Regex matching SQL keywords that perform mutations.
 * Anchored to word boundaries, case-insensitive.
 */
export const FORBIDDEN_KEYWORDS =
  /\b(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|MERGE|RENAME|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i;

/**
 * Validates that a SQL string is a read-only SELECT query.
 * Returns `{ ok: true }` if safe, `{ ok: false, reason }` otherwise.
 */
export function validateSQL(sql: string): ValidateResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { ok: false, reason: 'SQL query must not be empty' };
  }

  // Only allow SELECT, WITH (CTEs), and EXPLAIN as statement prefixes
  if (!/^(SELECT|WITH|EXPLAIN)\b/i.test(trimmed)) {
    return { ok: false, reason: 'Only SELECT, WITH, and EXPLAIN statements are allowed' };
  }

  // Strip a single trailing semicolon, then reject if any remain (multi-statement)
  const stripped = trimmed.replace(/;\s*$/, '');
  if (stripped.includes(';')) {
    return { ok: false, reason: 'Multiple statements are not allowed' };
  }

  const match = FORBIDDEN_KEYWORDS.exec(stripped);
  if (match) {
    return { ok: false, reason: `Forbidden keyword: ${match[1].toUpperCase()}` };
  }

  return { ok: true };
}
