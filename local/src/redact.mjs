/**
 * Redaction at the edge (R-017, R-018, T-06, T-11).
 *
 * Two different jobs, kept apart:
 *
 * - `redactPersonal` removes what identifies the person or machine (absolute paths, the user
 *   name, the host name) from anything shown, exported or put in diagnostics.
 * - `redactSecrets` removes credentials from command output: values the user registered,
 *   and strings shaped like common credentials. Pattern redaction is best effort; it misses
 *   credentials it does not recognise, and the interface says so.
 */
import os from 'node:os';

export const PLACEHOLDER = '[redacted]';

/** @param {string} value */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {{ roots?: string[], hostName?: string, homeDir?: string, userName?: string }} [options]
 *   `roots` are repository roots, replaced by `<repo>` so paths below them stay readable
 * @returns {string}
 */
export function redactPersonal(text, options = {}) {
  let out = String(text);
  const replacements = [];
  for (const root of options.roots ?? []) {
    replacements.push([root, '<repo>'], [root.replaceAll('\\', '/'), '<repo>']);
  }
  const home = options.homeDir ?? os.homedir();
  replacements.push([home, '~'], [home.replaceAll('\\', '/'), '~']);
  for (const [literal, replacement] of replacements) {
    if (literal.length > 2) out = out.replace(new RegExp(escapeRegExp(literal), 'gi'), replacement);
  }
  const host = options.hostName ?? os.hostname();
  if (host.length > 2) out = out.replace(new RegExp(`\\b${escapeRegExp(host)}\\b`, 'gi'), '<host>');
  const user = options.userName ?? safeUserName();
  if (user.length > 2) out = out.replace(new RegExp(`\\b${escapeRegExp(user)}\\b`, 'gi'), '<user>');
  // Whatever absolute path remains is replaced, keeping the last segment for context.
  // Both patterns match the whole path as one flat run and take the last segment afterwards,
  // because a repeated segment group is the shape `security/detect-unsafe-regex` refuses.
  out = out.replace(
    /(?:file:\/\/\/)?[A-Za-z]:[\\/][^\s"'<>|:*?]*/g,
    (path) => `<path>/${path.split(/[\\/]/).pop()}`,
  );
  out = out.replace(
    /(?<![\w.])\/(?:home|Users|root|var|tmp|opt|etc)\/[^\s"'<>]*/g,
    (path) => `<path>/${path.split('/').pop()}`,
  );
  return out;
}

function safeUserName() {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

/** Shapes of common credentials. Best effort by nature. */
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?[^\s"']{6,}/gi,
];

/**
 * @param {string} text
 * @param {string[]} [registered] literal secret values the user or the runner registered
 * @returns {string}
 */
export function redactSecrets(text, registered = []) {
  let out = String(text);
  for (const value of registered) {
    if (value.length >= 4) out = out.replaceAll(value, PLACEHOLDER);
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, PLACEHOLDER);
  return out;
}
