/**
 * lib/hardening-checks.ts
 * Pure validation functions for production hardening checks.
 * Each function accepts file content as parameters (no filesystem access),
 * making them unit-testable without requiring the filesystem.
 */

export type CheckResult = { pass: boolean; message: string };

/** 1. .env.example exists and does NOT contain real secrets */
export function checkEnvExample(envExampleContent: string | null): CheckResult {
  if (envExampleContent === null) {
    return { pass: false, message: '.env.example not found — create it with documented placeholders' };
  }

  const secretKeyPattern = /^(\w*(?:API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)\w*)\s*=\s*(.*)$/i;
  const suspicious: string[] = [];

  // Process line-by-line to avoid CRLF false positives with multiline regex
  const lines = envExampleContent.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.startsWith('#') || !line.includes('=')) continue;
    const lineMatch = secretKeyPattern.exec(line);
    if (lineMatch === null) continue;
    const key = lineMatch[1]!;
    const value = lineMatch[2]!.trim();
    // A value is suspicious if it's long (>20 chars) and doesn't look like a URL or placeholder
    const isUrl = /^https?:\/\//i.test(value);
    const isPlaceholder = /your[-_]|placeholder|example|change[-_]?me/i.test(value);
    const isNumeric = /^\d+$/.test(value);
    const isBool = value === 'true' || value === 'false';
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
export function checkCoverageThresholds(
  configs: Array<{ path: string; content: string | null }>,
): CheckResult {
  const missing: string[] = [];
  for (const cfg of configs) {
    if (cfg.content === null) {
      missing.push(`${cfg.path} (file not found)`);
      continue;
    }
    if (!cfg.content.includes('thresholds')) {
      missing.push(cfg.path);
    }
  }

  if (missing.length > 0) {
    return {
      pass: false,
      message: `Coverage thresholds not configured in: ${missing.join(', ')}`,
    };
  }

  return { pass: true, message: 'Coverage thresholds configured in server and client vitest configs' };
}

/** 3. Docker compose files do NOT use wildcard CORS_ORIGIN=* */
export function checkDockerCors(
  composeFiles: Array<{ path: string; content: string | null }>,
): CheckResult {
  const wildcardFiles: string[] = [];
  for (const file of composeFiles) {
    if (file.content === null) continue; // missing file — skip this compose file
    // Match CORS_ORIGIN: "*" or CORS_ORIGIN=* or CORS_ORIGIN: * (bare)
    if (/CORS_ORIGIN[:\s="']*\*['"]?\s*$/m.test(file.content)) {
      wildcardFiles.push(file.path);
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
export function checkGitignore(gitignoreContent: string | null): CheckResult {
  if (gitignoreContent === null) {
    return { pass: false, message: '.gitignore not found' };
  }

  const lines = gitignoreContent.split('\n').map((l) => l.trim());
  const hasEnv = lines.some((l) => l === '.env' || l === '.env.*' || l === '*.env');

  if (!hasEnv) {
    return { pass: false, message: '.gitignore does not include .env — add it to prevent committing secrets' };
  }

  return { pass: true, message: '.gitignore includes .env' };
}

/** 5. COOKIE_SECRET is documented in .env.example */
export function checkCookieSecret(envExampleContent: string | null): CheckResult {
  if (envExampleContent === null) {
    return { pass: false, message: '.env.example not found' };
  }
  if (!envExampleContent.includes('COOKIE_SECRET')) {
    return {
      pass: false,
      message: 'COOKIE_SECRET not found in .env.example — add COOKIE_SECRET=your-secret-here',
    };
  }
  return { pass: true, message: 'COOKIE_SECRET documented in .env.example' };
}

/** 6. AUTOMATE_DASHBOARD_API_KEY is documented in .env.example */
export function checkApiKey(envExampleContent: string | null): CheckResult {
  if (envExampleContent === null) {
    return { pass: false, message: '.env.example not found' };
  }
  if (!envExampleContent.includes('AUTOMATE_DASHBOARD_API_KEY')) {
    return {
      pass: false,
      message: 'AUTOMATE_DASHBOARD_API_KEY not found in .env.example — add AUTOMATE_DASHBOARD_API_KEY=your-secret-key',
    };
  }
  return { pass: true, message: 'AUTOMATE_DASHBOARD_API_KEY documented in .env.example' };
}

/** 7. REPORTER_SECRET is documented in .env.example */
export function checkReporterSecret(envExampleContent: string | null): CheckResult {
  if (envExampleContent === null) {
    return { pass: false, message: '.env.example not found' };
  }
  if (!envExampleContent.includes('REPORTER_SECRET')) {
    return {
      pass: false,
      message: 'REPORTER_SECRET not found in .env.example — add REPORTER_SECRET=your-secret-here',
    };
  }
  return { pass: true, message: 'REPORTER_SECRET documented in .env.example' };
}

/** 8. Server startup-policy.ts exists */
export function checkStartupPolicy(fileExists: boolean): CheckResult {
  if (!fileExists) {
    return {
      pass: false,
      message: 'startup-policy.ts not found at apps/server/src/services/startup-policy.ts — create it to enforce production startup constraints',
    };
  }
  return { pass: true, message: 'Server startup-policy.ts exists' };
}

/** 9. Auth plugin exists */
export function checkAuthPlugin(fileExists: boolean): CheckResult {
  if (!fileExists) {
    return {
      pass: false,
      message: 'Auth plugin not found at apps/server/src/plugins/auth.ts — authentication middleware is required',
    };
  }
  return { pass: true, message: 'Auth plugin (apps/server/src/plugins/auth.ts) exists' };
}

/** 10. Rate limit plugin exists */
export function checkRateLimitPlugin(fileExists: boolean): CheckResult {
  if (!fileExists) {
    return {
      pass: false,
      message: 'Rate-limit plugin not found at apps/server/src/plugins/rate-limit.ts — rate limiting is required for production',
    };
  }
  return { pass: true, message: 'Rate-limit plugin (apps/server/src/plugins/rate-limit.ts) exists' };
}
