/**
 * `.gitleaksignore` may hold exact fingerprints and nothing broader.
 *
 * gitleaks reads the file on its own and also accepts `<path>:<rule>:<line>` — the same
 * line in **every** commit — so a file that starts narrow can widen silently. Only the
 * commit-scoped shape is allowed: a full 40-character commit, a path with no glob, a rule
 * id and a line number. One finding in one commit, and nothing a later commit can hide in.
 */

const FINGERPRINT = /^[0-9a-f]{40}:[^*?:\s]+:[a-z0-9][a-z0-9-]*:\d+$/u;

/**
 * @param {string} source the text of `.gitleaksignore`
 * @returns {string[]} one message per entry that is not an exact fingerprint
 */
export function gitleaksIgnoreProblems(source) {
  /** @type {string[]} */
  const problems = [];
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (FINGERPRINT.test(line)) continue;
    problems.push(
      `line ${String(index + 1)}: ${line} is not an exact fingerprint ` +
        '(<40-hex commit>:<path>:<rule>:<line>), so it would exempt more than one finding',
    );
  }
  return problems;
}
