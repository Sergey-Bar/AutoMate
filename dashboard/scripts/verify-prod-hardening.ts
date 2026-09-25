#!/usr/bin/env tsx
/**
 * scripts/verify-prod-hardening.ts
 * Validates production hardening requirements are met.
 * Exit 0 = all checks pass, Exit 1 = failures found.
 *
 * Run from Automate root:
 *   npx tsx scripts/verify-prod-hardening.ts
 */

import fs from 'node:fs';
import path from 'node:path';
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
} from '../apps/server/src/lib/hardening-checks.js';

const ROOT = process.cwd();

type CheckResult = { pass: boolean; message: string };

function fileContent(relPath: string): string | null {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf-8');
}

// ─── Runner ──────────────────────────────────────────────────────────────────

interface NamedResult extends CheckResult {
  name: string;
}

function run(name: string, fn: () => CheckResult): NamedResult {
  try {
    return { name, ...fn() };
  } catch (err) {
    return { name, pass: false, message: `Error: ${(err as Error).message}` };
  }
}

const checks: NamedResult[] = [
  run('.env.example exists with no real secrets', () => checkEnvExample(fileContent('.env.example'))),
  run('Coverage thresholds configured in vitest.config.ts', () =>
    checkCoverageThresholds([
      { path: 'apps/server/vitest.config.ts', content: fileContent('apps/server/vitest.config.ts') },
      { path: 'apps/client/vitest.config.ts', content: fileContent('apps/client/vitest.config.ts') },
    ]),
  ),
  run('Docker compose does not use CORS_ORIGIN=*', () =>
    checkDockerCors([
      { path: 'docker-compose.yml', content: fileContent('docker-compose.yml') },
      { path: 'docker-compose.prod.yml', content: fileContent('docker-compose.prod.yml') },
    ]),
  ),
  run('.gitignore includes .env', () => checkGitignore(fileContent('.gitignore'))),
  run('COOKIE_SECRET documented in .env.example', () => checkCookieSecret(fileContent('.env.example'))),
  run('AUTOMATE_DASHBOARD_API_KEY documented in .env.example', () =>
    checkApiKey(fileContent('.env.example')),
  ),
  run('REPORTER_SECRET documented in .env.example', () =>
    checkReporterSecret(fileContent('.env.example')),
  ),
  run('Server startup-policy.ts exists', () =>
    checkStartupPolicy(
      fs.existsSync(path.join(ROOT, 'apps/server/src/services/startup-policy.ts')),
    ),
  ),
  run('Auth plugin exists', () =>
    checkAuthPlugin(fs.existsSync(path.join(ROOT, 'apps/server/src/plugins/auth.ts'))),
  ),
  run('Rate-limit plugin exists', () =>
    checkRateLimitPlugin(fs.existsSync(path.join(ROOT, 'apps/server/src/plugins/rate-limit.ts'))),
  ),
];

// ─── Output ──────────────────────────────────────────────────────────────────

console.log('');
console.log('Production Hardening Verification — Automate');
console.log('=======================================================');
console.log('');

for (const result of checks) {
  const icon = result.pass ? '✓' : '✗';
  const line = result.pass
    ? `${icon} ${result.message}`
    : `${icon} ${result.message}`;
  console.log(line);
}

const passed = checks.filter((c) => c.pass).length;
const total = checks.length;
const failed = total - passed;

console.log('');
if (failed === 0) {
  console.log(`Results: ${passed}/${total} checks passed`);
} else {
  console.log(`Results: ${passed}/${total} checks passed — ${failed} failure${failed === 1 ? '' : 's'}`);
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
