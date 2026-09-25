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

const ROOT = process.cwd();

type CheckResult = { pass: boolean; message: string };

function fileContent(relPath: string): string | null {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf-8');
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/** 1. .env.example exists and does NOT contain real secrets */
function checkEnvExample(): CheckResult {
  const content = fileContent('.env.example');
  if (content === null) {
    return { pass: false, message: '.env.example not found — create it with documented placeholders' };
  }

  const secretKeyPattern = /^(\w*(?:API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)\w*)\s*=\s*(.*)$/i;
  const suspicious: string[] = [];

  // Process line-by-line to avoid CRLF false positives with multiline regex
  const lines = content.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.startsWith('#') || !line.includes('=')) continue;
    const lineMatch = secretKeyPattern.exec(line);
    if (lineMatch === null) continue;
    const key = lineMatch[1];
    const value = lineMatch[2].trim();
    const isUrl = /^https?:\/\//i.test(value);
    const isPlaceholder = /your[-_]|placeholder|example|change[-_]?me/i.test(value);
    const isNumeric = /^\d+$/.test(value);
    const isBool = value === 'true' || value === 'false';
    // A "real" secret heuristic: >20 chars, not a URL/placeholder/numeric/bool
    if (!isUrl && !isPlaceholder && !isNumeric && !isBool && value.length > 20) {
      suspicious.push(`${key}=${value.slice(0, 6)}***`);
    }
  }

  if (suspicious.length > 0) {
    return {
      pass: false,
      message: `.env.example may contain real secrets: ${suspicious.join(', ')} — replace with placeholders`,
    };
  }

  return { pass: true, message: '.env.example exists with no apparent real secrets' };
}

/** 2. Coverage thresholds configured in vitest.config.ts files */
function checkCoverageThresholds(): CheckResult {
  const configs = [
    'apps/server/vitest.config.ts',
    'apps/web/vitest.config.ts',
  ];

  const missing: string[] = [];
  for (const cfg of configs) {
    const content = fileContent(cfg);
    if (content === null) {
      missing.push(`${cfg} (file not found)`);
      continue;
    }
    if (!content.includes('thresholds')) {
      missing.push(cfg);
    }
  }

  if (missing.length > 0) {
    return {
      pass: false,
      message: `Coverage thresholds not configured in: ${missing.join(', ')}`,
    };
  }

  return { pass: true, message: 'Coverage thresholds configured in server and web vitest configs' };
}

/** 3. Docker compose files do NOT use wildcard CORS_ORIGIN=* */
function checkDockerCors(): CheckResult {
  const composeFiles = [
    'docker-compose.yml',
    'docker-compose.prod.yml',
  ];

  const wildcardFiles: string[] = [];
  for (const file of composeFiles) {
    const content = fileContent(file);
    if (content === null) continue; // missing file — skip
    if (/CORS_ORIGIN[:\s="']*\*['"]?\s*$/m.test(content)) {
      wildcardFiles.push(file);
    }
  }

  if (wildcardFiles.length > 0) {
    return {
      pass: false,
      message: `Wildcard CORS_ORIGIN=* found in: ${wildcardFiles.join(', ')} — restrict to your domain`,
    };
  }

  return { pass: true, message: 'Docker compose files do not use wildcard CORS_ORIGIN=*' };
}

/** 4. .gitignore includes .env */
function checkGitignore(): CheckResult {
  const content = fileContent('.gitignore');
  if (content === null) {
    return { pass: false, message: '.gitignore not found' };
  }

  const lines = content.split('\n').map((l) => l.trim());
  const hasEnv = lines.some((l) => l === '.env' || l === '.env.*' || l === '*.env');

  if (!hasEnv) {
    return { pass: false, message: '.gitignore does not include .env — add it to prevent committing secrets' };
  }

  return { pass: true, message: '.gitignore includes .env' };
}

/** 5. VAULT_PASSWORD is documented in .env.example with a placeholder (not a real value) */
function checkVaultPassword(): CheckResult {
  const content = fileContent('.env.example');
  if (content === null) {
    return { pass: false, message: '.env.example not found — document VAULT_PASSWORD=your-password-here' };
  }

  if (!content.includes('VAULT_PASSWORD')) {
    return {
      pass: false,
      message: 'VAULT_PASSWORD not found in .env.example — add VAULT_PASSWORD= (empty placeholder)',
    };
  }

  // Check that the value is empty or a placeholder (not a real secret)
  const match = content.match(/^VAULT_PASSWORD[ \t]*=[ \t]*(.*)$/m);
  if (match) {
    const value = match[1].trim();
    if (value.length > 20) {
      return {
        pass: false,
        message: 'VAULT_PASSWORD in .env.example appears to contain a real value — use an empty placeholder',
      };
    }
  }

  return { pass: true, message: 'VAULT_PASSWORD documented in .env.example with a placeholder' };
}

/** 6. AUTOMATE_API_KEY is documented in .env.example */
function checkAutomateApiKey(): CheckResult {
  const content = fileContent('.env.example');
  if (content === null) {
    return { pass: false, message: '.env.example not found' };
  }

  if (!content.includes('AUTOMATE_API_KEY')) {
    return {
      pass: false,
      message: 'AUTOMATE_API_KEY not found in .env.example — add AUTOMATE_API_KEY=your-key-here',
    };
  }

  return { pass: true, message: 'AUTOMATE_API_KEY documented in .env.example' };
}

/** 7. Security headers plugin exists */
function checkSecurityHeaders(): CheckResult {
  const candidates = [
    'apps/server/src/plugins/security-headers.ts',
    'apps/server/src/plugins/security.ts',
  ];

  const serverSrc = fileContent('apps/server/src/index.ts') ?? fileContent('apps/server/src/app.ts') ?? '';
  const hasCspInCode =
    /(?:csp|content-security-policy|helmet|security.?header)/i.test(serverSrc);

  const pluginExists = candidates.some((p) => {
    const abs = path.join(ROOT, p);
    return fs.existsSync(abs);
  });

  if (!pluginExists && !hasCspInCode) {
    return {
      pass: false,
      message:
        'No security headers plugin found in apps/server/src/plugins/ — add security-headers.ts with CSP/X-Frame-Options',
    };
  }

  const found = candidates.find((p) => fs.existsSync(path.join(ROOT, p))) ?? 'server code';
  return { pass: true, message: `Security headers configured (${found})` };
}

/** 8. Rate limit is configured */
function checkRateLimit(): CheckResult {
  const rateLimitPlugin = 'apps/server/src/plugins/rate-limit.ts';
  const abs = path.join(ROOT, rateLimitPlugin);

  if (fs.existsSync(abs)) {
    return { pass: true, message: 'Rate-limit plugin exists (apps/server/src/plugins/rate-limit.ts)' };
  }

  // Fall back: check .env.example documents RATE_LIMIT config
  const envContent = fileContent('.env.example');
  if (envContent && envContent.includes('RATE_LIMIT')) {
    return { pass: true, message: 'Rate limiting documented in .env.example (RATE_LIMIT_MAX / RATE_LIMIT_WINDOW)' };
  }

  return {
    pass: false,
    message: 'Rate limiting not configured — add apps/server/src/plugins/rate-limit.ts or document RATE_LIMIT_MAX in .env.example',
  };
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
  run('.env.example exists with no real secrets', checkEnvExample),
  run('Coverage thresholds configured in vitest.config.ts', checkCoverageThresholds),
  run('Docker compose does not use CORS_ORIGIN=*', checkDockerCors),
  run('.gitignore includes .env', checkGitignore),
  run('VAULT_PASSWORD documented in .env.example', checkVaultPassword),
  run('AUTOMATE_API_KEY documented in .env.example', checkAutomateApiKey),
  run('Security headers plugin configured', checkSecurityHeaders),
  run('Rate limiting configured', checkRateLimit),
];

// ─── Output ──────────────────────────────────────────────────────────────────

console.log('');
console.log('Production Hardening Verification — Automate');
console.log('=============================================');
console.log('');

for (const result of checks) {
  const icon = result.pass ? '✓' : '✗';
  console.log(`${icon} ${result.message}`);
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
