const MAX_BODY_LINE = 100;

/**
 * Dependabot signs every commit it writes with this exact trailer, on a line of its own.
 * Its generated body names each updated directory on one line and has no setting to wrap,
 * so a grouped update across two directories cannot pass a 100-character limit.
 */
const DEPENDABOT_TRAILER = /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/mu;

/**
 * `body-max-line-length`, except for Dependabot's generated body. Only the body length is
 * exempt: the header, the type and the `scope-enum` vocabulary still apply to its commits.
 *
 * @param {{ body?: string | null, raw?: string }} parsed
 * @param {string} [_when]
 * @param {number} [value]
 * @returns {[boolean, string?]}
 */
function bodyMaxLineLengthUnlessDependabot(parsed, _when, value = MAX_BODY_LINE) {
  if (parsed.body === null || parsed.body === undefined || parsed.body === '') return [true];
  if (DEPENDABOT_TRAILER.test(parsed.raw ?? '')) return [true];
  const long = parsed.body.split('\n').some((line) => line.length > value);
  return [!long, `body's lines must not be longer than ${String(value)} characters`];
}

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    { rules: { 'body-max-line-length-unless-dependabot': bodyMaxLineLengthUnlessDependabot } },
  ],
  rules: {
    // Replaced rather than kept beside it, so a Dependabot body is not failed by the
    // built-in rule anyway. The limit is the same 100 characters for everyone else.
    'body-max-line-length': [0],
    'body-max-line-length-unless-dependabot': [2, 'always', MAX_BODY_LINE],
    // Severity 2 (error), not 1 (warning). At severity 1 an out-of-scope commit
    // printed a warning and the hook exited 0, so the rule was decorative while
    // the README claimed conventional subjects were enforced.
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'ui',
        'auth',
        'db',
        'realtime',
        'shared-contracts',
        'unified',
        'ci',
        'deps',
        'preflight',
        'workspace',
        'root',
        'hooks',
        'deploy',
        'cleanup',
        'e2e',
        'ops',
        'config',
        'docs',
        // Package and subsystem scopes the tree actually uses. Without these a
        // correct conventional commit fails the gate, which is how a rule gets
        // switched off.
        'reporting',
        'reporter',
        'orchestration',
        'tool-sdk',
        'automation',
        'runner',
        'worker',
        'migrate-cli',
        'quality',
        'plan',
        'security',
        'release',
        // Cross-cutting: appears in both apps and both build pipelines. Listed
        // here because the tree now has the subsystem, not to accommodate one
        // commit — a scope that names nothing real is how the vocabulary stops
        // meaning anything.
        'observability',
      ],
    ],
  },
};
