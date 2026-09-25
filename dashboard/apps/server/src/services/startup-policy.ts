/**
 * apps/server/src/services/startup-policy.ts
 *
 * Production startup policy enforcement — validates critical configuration
 * and fails fast on insecure or missing settings before serving any traffic.
 *
 * Usage:
 *   enforceStartupPolicy(app.log)  // call early in bootstrap(), before plugins
 *
 * Only active when NODE_ENV === 'production'. In dev/test, returns no violations.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface StartupPolicyViolation {
  field: string;
  message: string;
  severity: 'fatal' | 'warning';
}

// ── Dev fallback values that must never reach production ─────────────────────

const DEV_COOKIE_SECRET = 'automate-dev-secret';
const INSECURE_API_KEY = 'changeme';

// ── Core check (pure, no side-effects) ───────────────────────────────────────

/**
 * Returns an array of policy violations for the current environment.
 * Always returns an empty array when NODE_ENV is not 'production'.
 */
export function checkStartupPolicy(): StartupPolicyViolation[] {
  if (process.env.NODE_ENV !== 'production') {
    return [];
  }

  const violations: StartupPolicyViolation[] = [];

  // ── COOKIE_SECRET ──────────────────────────────────────────────────────────
  if (!process.env.COOKIE_SECRET) {
    violations.push({
      field: 'COOKIE_SECRET',
      message: 'COOKIE_SECRET is not set. A secure secret is required in production for session signing.',
      severity: 'fatal',
    });
  } else if (process.env.COOKIE_SECRET === DEV_COOKIE_SECRET) {
    violations.push({
      field: 'COOKIE_SECRET',
      message:
        `COOKIE_SECRET is set to the development fallback value "${DEV_COOKIE_SECRET}". ` +
        'Set a unique, random secret before running in production.',
      severity: 'fatal',
    });
  }

  // ── AUTOMATE_DASHBOARD_API_KEY ─────────────────────────────────────────────
  if (!process.env.AUTOMATE_DASHBOARD_API_KEY) {
    violations.push({
      field: 'AUTOMATE_DASHBOARD_API_KEY',
      message: 'AUTOMATE_DASHBOARD_API_KEY is not set. An API key is required in production.',
      severity: 'fatal',
    });
  } else if (process.env.AUTOMATE_DASHBOARD_API_KEY === INSECURE_API_KEY) {
    violations.push({
      field: 'AUTOMATE_DASHBOARD_API_KEY',
      message:
        `AUTOMATE_DASHBOARD_API_KEY is set to the insecure default value "${INSECURE_API_KEY}". ` +
        'Set a secure API key before running in production.',
      severity: 'fatal',
    });
  }

  // ── CORS_ORIGIN ────────────────────────────────────────────────────────────
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
    violations.push({
      field: 'CORS_ORIGIN',
      message:
        'CORS_ORIGIN is not set or set to "*". ' +
        'Set CORS_ORIGIN to your dashboard URL (e.g. https://dashboard.example.com) to restrict cross-origin access.',
      severity: 'warning',
    });
  }

  // ── REPORTER_SECRET ────────────────────────────────────────────────────────
  const reporterViolation = checkReporterSecret();
  if (reporterViolation) {
    violations.push(reporterViolation);
  }

  // ── AUTOMATE_SERVICE_SECRET ────────────────────────────────────────────────
  const serviceSecretViolation = checkServiceSecret();
  if (serviceSecretViolation) {
    violations.push(serviceSecretViolation);
  }

  return violations;
}

// ── checkReporterSecret ───────────────────────────────────────────────────────

/**
 * Validates that REPORTER_SECRET is set when the reporter WebSocket port is
 * exposed in production. Without a shared secret, the reporter endpoint accepts
 * unauthenticated connections from any source.
 *
 * Severity: fatal in production (unauthenticated reporter access is a security risk).
 * Only evaluated when NODE_ENV === 'production' (caller guards via checkStartupPolicy).
 */
export function checkReporterSecret(): StartupPolicyViolation | null {
  if (!process.env.REPORTER_SECRET) {
    return {
      field: 'REPORTER_SECRET',
      message:
        'REPORTER_SECRET is not set. The reporter WebSocket endpoint accepts unauthenticated connections. ' +
        'Set REPORTER_SECRET to require a shared secret from reporters.',
      severity: 'fatal',
    };
  }
  return null;
}

// ── checkServiceSecret ────────────────────────────────────────────────────────

/**
 * Validates that AUTOMATE_SERVICE_SECRET is set when service-to-service features
 * are enabled in production. Without a service secret, the external trigger and
 * session-validate endpoints fail closed with 503 — but having the features enabled
 * without a secret configured is a misconfiguration that should be caught at startup.
 *
 * Severity: fatal in production when FEATURE_EXTERNAL_TRIGGER or FEATURE_SESSION_VALIDATE
 * is enabled without a service secret.
 * Only evaluated when NODE_ENV === 'production' (caller guards via checkStartupPolicy).
 */
export function checkServiceSecret(): StartupPolicyViolation | null {
  const externalTriggerEnabled = process.env.FEATURE_EXTERNAL_TRIGGER === 'true';
  const sessionValidateEnabled = process.env.FEATURE_SESSION_VALIDATE === 'true';
  if ((externalTriggerEnabled || sessionValidateEnabled) && !process.env.AUTOMATE_SERVICE_SECRET) {
    return {
      field: 'AUTOMATE_SERVICE_SECRET',
      message:
        'AUTOMATE_SERVICE_SECRET is not set but service features are enabled ' +
        '(FEATURE_EXTERNAL_TRIGGER or FEATURE_SESSION_VALIDATE). ' +
        'Set AUTOMATE_SERVICE_SECRET to a secure random secret to enable service-to-service authentication.',
      severity: 'fatal',
    };
  }
  return null;
}

// ── Logger interface ──────────────────────────────────────────────────────────

export interface PolicyLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

// ── Enforcement (with side-effects) ──────────────────────────────────────────

/**
 * Enforces the startup policy: logs warnings and exits on fatal violations.
 * Call early in bootstrap, before plugin/route registration.
 *
 * @param logger - Optional logger (e.g. app.log). Falls back to stderr/stdout.
 */
export function enforceStartupPolicy(logger?: PolicyLogger): void {
  const log: PolicyLogger = logger ?? {
    info: (msg: string) => process.stdout.write(`[startup-policy] ${msg}\n`),
    warn: (msg: string) => process.stderr.write(`[startup-policy] WARN: ${msg}\n`),
  };

  const violations = checkStartupPolicy();

  for (const v of violations) {
    if (v.severity === 'warning') {
      log.warn(`[startup-policy] WARNING — ${v.field}: ${v.message}`);
    }
  }

  const fatals = violations.filter((v) => v.severity === 'fatal');
  if (fatals.length > 0) {
    for (const v of fatals) {
      process.stderr.write(`[startup-policy] FATAL — ${v.field}: ${v.message}\n`);
    }
    process.exit(1);
  }

  if (violations.length === 0) {
    log.info('[startup-policy] All startup policy checks passed.');
  }
}
