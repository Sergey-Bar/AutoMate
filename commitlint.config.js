export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
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
        'automation',
        'runner',
        'worker',
        'migrate-cli',
        'quality',
        'plan',
        'security',
        'release',
      ],
    ],
  },
};
