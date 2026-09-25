import {
  checkEnvExample,
  checkCoverageThresholds,
  checkDockerCors,
  checkGitignore,
  checkCookieSecret,
  checkApiKey,
  checkReporterSecret,
  checkStartupPolicy,
  checkAuthPlugin,
  checkRateLimitPlugin,
} from './hardening-checks.js';

describe('checkEnvExample', () => {
  it('passes when content exists with no suspicious secrets', () => {
    const content = 'COOKIE_SECRET=your-secret-here\nAUTOMATE_DASHBOARD_API_KEY=change-me\n';
    const result = checkEnvExample(content);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('no apparent real secrets');
  });

  it('fails when content is null', () => {
    const result = checkEnvExample(null);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('.env.example not found');
  });

  it('fails when content contains a real secret value (long non-placeholder)', () => {
    const content = 'API_KEY=not-a-real-secret-value-1234567890\n';
    const result = checkEnvExample(content);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('may contain real secrets');
  });

  it('passes when secret variable has a URL value (not treated as suspicious)', () => {
    const content = 'TOKEN=https://api.example.com/v1/auth/token/abcdef1234567890\n';
    const result = checkEnvExample(content);
    expect(result.pass).toBe(true);
  });

  it('passes when secret variable has a placeholder value', () => {
    const content = 'SECRET=your-secret-placeholder-here-change-me\n';
    const result = checkEnvExample(content);
    expect(result.pass).toBe(true);
  });
});

describe('checkCoverageThresholds', () => {
  it('passes when all config files contain "thresholds"', () => {
    const configs = [
      { path: 'apps/server/vitest.config.ts', content: 'thresholds: { statements: 93 }' },
      { path: 'apps/client/vitest.config.ts', content: 'coverage: { thresholds: { lines: 94 } }' },
    ];
    const result = checkCoverageThresholds(configs);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('Coverage thresholds configured');
  });

  it('fails when a config is missing the "thresholds" keyword', () => {
    const configs = [
      { path: 'apps/server/vitest.config.ts', content: 'thresholds: { statements: 93 }' },
      { path: 'apps/client/vitest.config.ts', content: 'coverage: { reporter: ["text"] }' },
    ];
    const result = checkCoverageThresholds(configs);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('apps/client/vitest.config.ts');
  });

  it('fails when a config file content is null (file not found)', () => {
    const configs = [
      { path: 'apps/server/vitest.config.ts', content: null },
    ];
    const result = checkCoverageThresholds(configs);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('file not found');
  });
});

describe('checkDockerCors', () => {
  it('passes when compose files use a specific domain for CORS_ORIGIN', () => {
    const files = [
      { path: 'docker-compose.yml', content: 'CORS_ORIGIN=https://dashboard.example.com\n' },
    ];
    const result = checkDockerCors(files);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('do not use wildcard');
  });

  it('fails when a compose file has CORS_ORIGIN=*', () => {
    const files = [
      { path: 'docker-compose.yml', content: 'CORS_ORIGIN=*\n' },
    ];
    const result = checkDockerCors(files);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('Wildcard CORS_ORIGIN=*');
    expect(result.message).toContain('docker-compose.yml');
  });

  it('passes when compose file content is null (file not found — skip)', () => {
    const files = [
      { path: 'docker-compose.prod.yml', content: null },
    ];
    const result = checkDockerCors(files);
    expect(result.pass).toBe(true);
  });

  it('fails when CORS_ORIGIN: "*" uses YAML syntax with quotes', () => {
    const files = [
      { path: 'docker-compose.yml', content: '      CORS_ORIGIN: "*"\n' },
    ];
    const result = checkDockerCors(files);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('Wildcard CORS_ORIGIN=*');
  });
});

describe('checkGitignore', () => {
  it('passes when .gitignore contains a .env line', () => {
    const content = 'node_modules\n.env\ndist\n';
    const result = checkGitignore(content);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('.gitignore includes .env');
  });

  it('fails when content is null', () => {
    const result = checkGitignore(null);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('.gitignore not found');
  });

  it('fails when .gitignore exists but does not include .env', () => {
    const content = 'node_modules\ndist\n.DS_Store\n';
    const result = checkGitignore(content);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('does not include .env');
  });

  it('passes when .gitignore uses .env.* pattern', () => {
    const content = 'node_modules\n.env.*\ndist\n';
    const result = checkGitignore(content);
    expect(result.pass).toBe(true);
  });
});

describe('checkCookieSecret', () => {
  it('passes when COOKIE_SECRET is present', () => {
    const content = 'COOKIE_SECRET=your-secret-here\nAUTOMATE_DASHBOARD_API_KEY=change-me\n';
    const result = checkCookieSecret(content);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('COOKIE_SECRET documented');
  });

  it('fails when content is null', () => {
    const result = checkCookieSecret(null);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('.env.example not found');
  });

  it('fails when COOKIE_SECRET is absent from content', () => {
    const content = 'AUTOMATE_DASHBOARD_API_KEY=change-me\nREPORTER_SECRET=change-me\n';
    const result = checkCookieSecret(content);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('COOKIE_SECRET not found');
  });
});

describe('checkApiKey', () => {
  it('passes when AUTOMATE_DASHBOARD_API_KEY is present', () => {
    const content = 'AUTOMATE_DASHBOARD_API_KEY=your-secret-key\nCOOKIE_SECRET=change-me\n';
    const result = checkApiKey(content);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('AUTOMATE_DASHBOARD_API_KEY documented');
  });

  it('fails when content is null', () => {
    const result = checkApiKey(null);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('.env.example not found');
  });

  it('fails when AUTOMATE_DASHBOARD_API_KEY is absent', () => {
    const content = 'COOKIE_SECRET=change-me\nREPORTER_SECRET=change-me\n';
    const result = checkApiKey(content);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('AUTOMATE_DASHBOARD_API_KEY not found');
  });
});

describe('checkReporterSecret', () => {
  it('passes when REPORTER_SECRET is present', () => {
    const content = 'REPORTER_SECRET=your-secret-here\nCOOKIE_SECRET=change-me\n';
    const result = checkReporterSecret(content);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('REPORTER_SECRET documented');
  });

  it('fails when content is null', () => {
    const result = checkReporterSecret(null);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('.env.example not found');
  });

  it('fails when REPORTER_SECRET is absent', () => {
    const content = 'COOKIE_SECRET=change-me\nAUTOMATE_DASHBOARD_API_KEY=change-me\n';
    const result = checkReporterSecret(content);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('REPORTER_SECRET not found');
  });
});

describe('checkStartupPolicy', () => {
  it('passes when the file exists', () => {
    const result = checkStartupPolicy(true);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('startup-policy.ts exists');
  });

  it('fails when the file does not exist', () => {
    const result = checkStartupPolicy(false);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('startup-policy.ts not found');
  });
});

describe('checkAuthPlugin', () => {
  it('passes when the auth plugin file exists', () => {
    const result = checkAuthPlugin(true);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('Auth plugin');
    expect(result.message).toContain('exists');
  });

  it('fails when the auth plugin file does not exist', () => {
    const result = checkAuthPlugin(false);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('Auth plugin not found');
  });
});

describe('checkRateLimitPlugin', () => {
  it('passes when the rate-limit plugin file exists', () => {
    const result = checkRateLimitPlugin(true);
    expect(result.pass).toBe(true);
    expect(result.message).toContain('Rate-limit plugin');
    expect(result.message).toContain('exists');
  });

  it('fails when the rate-limit plugin file does not exist', () => {
    const result = checkRateLimitPlugin(false);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('Rate-limit plugin not found');
  });
});
