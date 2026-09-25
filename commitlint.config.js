export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [1, 'always', [
      'api', 'web', 'ui', 'auth', 'db', 'realtime', 'shared-contracts', 'unified', 'ci', 'deps', 'preflight', 'workspace', 'root', 'hooks', 'deploy', 'cleanup', 'e2e', 'ops', 'config', 'docs'
    ]],
  },
};
