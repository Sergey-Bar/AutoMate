import { z } from 'zod/v4';

/**
 * The one secret floor in this repository.
 *
 * It used to be two: 32 for the cookie, session and vault secrets, and 16 for the
 * other four. The result was that the weakest credential in the system set the bar
 * for the rest — a reporter secret and a vault key were held to the same standard,
 * and the API's own startup policy restated the thresholds independently, so the two
 * could drift and did. `apps/api/src/startup-policy.ts` imports this value rather
 * than writing a number, which is the only thing that makes the drift impossible.
 *
 * 32 is not a magic number: it is the width at which PBKDF2 and HMAC-SHA256 stop
 * being the thing to worry about, and the shortest of the committed development
 * literal, so the literal passes the floor it is documented as passing.
 */
export const SECRET_MIN_LENGTH = 32;

export type SecretVariable =
  | 'COOKIE_SECRET'
  | 'SESSION_SECRET'
  | 'VAULT_SECRET'
  | 'AUTOMATE_API_KEY'
  | 'REPORTER_SECRET'
  | 'RUNNER_REGISTRATION_SECRET'
  | 'KILO_API_KEY';

/**
 * Placeholders matched by equality, per variable.
 *
 * Equality rather than substring, and that is a deliberate decision rather than a
 * lazy one. The documented quickstart values in `README.md` are real secrets with a
 * memorable prefix — `local-reporter-secret-change-me` is 30 characters and works —
 * so a check that refused any value *containing* `change-me` would refuse a working
 * configuration in order to catch a broken one, and the fix would be to weaken the
 * check.
 */
const EXACT_PLACEHOLDERS: Record<SecretVariable, readonly string[]> = {
  COOKIE_SECRET: ['automate'],
  SESSION_SECRET: ['automate'],
  VAULT_SECRET: ['change-me'],
  AUTOMATE_API_KEY: ['change-me', 'automate'],
  REPORTER_SECRET: ['change-me', 'reporter-secret'],
  RUNNER_REGISTRATION_SECRET: ['change-me', 'runner-registration-secret'],
  KILO_API_KEY: ['change-me', 'automate'],
};

/**
 * The two cookie-secret placeholders that are only recognisable as fragments.
 *
 * The committed development literal is 38 characters of `development-only-…`, and the
 * string every quickstart on earth writes is `change-me-…`; neither can be matched by
 * equality without matching the healthy values too. The cookie secret is the one
 * credential whose *value* is a signing key, so it is the one where "this looks like
 * something you copied" is worth a false positive.
 */
const COOKIE_PLACEHOLDER_FRAGMENTS = ['change-me', 'development-only'] as const;

/** Whether a configured value is documentation rather than a secret. */
export function isSecretPlaceholder(variable: SecretVariable, value: string): boolean {
  if (EXACT_PLACEHOLDERS[variable].includes(value)) return true;
  return (
    variable === 'COOKIE_SECRET' && COOKIE_PLACEHOLDER_FRAGMENTS.some((f) => value.includes(f))
  );
}

/**
 * One secret schema, used by all seven variables.
 *
 * The placeholder check is written first and as a separate refinement on purpose. At a
 * 32-character floor a 9-character `change-me` fails the length check, and an operator
 * told only "too small" is not told to stop copying the example — so every assertion
 * that a placeholder is refused used to be unreachable in the real startup path, where
 * the schema parses before the API's policy ever runs. Zod collects both issues, so
 * `COOKIE_SECRET=change-me` now reports that it is a placeholder *and* that it is too
 * short, and the first thing an operator reads is the one that fixes it.
 */
function secretSchema(variable: SecretVariable) {
  return z
    .string()
    .refine((value) => !isSecretPlaceholder(variable, value), {
      message: `${variable} must not be a placeholder`,
    })
    .min(SECRET_MIN_LENGTH);
}

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  COOKIE_SECRET: secretSchema('COOKIE_SECRET').optional(),
  SESSION_SECRET: secretSchema('SESSION_SECRET').optional(),
  VAULT_SECRET: secretSchema('VAULT_SECRET').optional(),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  WORKSPACE_ID: z.string().min(1).default('default-workspace'),
  AUTOMATE_API_KEY: secretSchema('AUTOMATE_API_KEY').optional(),
  REPORTER_SECRET: secretSchema('REPORTER_SECRET').optional(),
  RUNNER_REGISTRATION_SECRET: secretSchema('RUNNER_REGISTRATION_SECRET').optional(),
  ARTIFACT_ROOT: z.string().min(1).default('./var/artifacts'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(30000),
  WORKER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(2),
  KILO_GATEWAY_URL: z.string().url().optional(),
  KILO_API_KEY: secretSchema('KILO_API_KEY').optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  SESSION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SSE_REPLAY_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  RETENTION_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl?: string;
  cookieSecret: string;
  sessionSecret?: string;
  vaultSecret?: string;
  publicAppUrl: string;
  workspaceId: string;
  installationApiKey?: string;
  reporterSecret?: string;
  runnerRegistrationSecret?: string;
  artifactRoot: string;
  workerPollIntervalMs: number;
  workerLeaseMs: number;
  workerLeaseDurationMs: number;
  workerMaxAttempts: number;
  kiloGatewayUrl?: string;
  kiloApiKey?: string;
  ollamaBaseUrl?: string;
  sessionTtlHours: number;
  sessionRetentionDays: number;
  sseReplayRetentionHours: number;
  auditRetentionDays: number;
  retentionSweepIntervalSeconds: number;
};

export function parseConfig(
  input: Record<string, string | undefined>,
  options: { requireProductionSecrets?: boolean } = {},
): AppConfig {
  const normalized = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''));
  const parsed = EnvironmentSchema.parse(normalized);
  const requireProductionSecrets =
    options.requireProductionSecrets ?? parsed.NODE_ENV === 'production';
  const cookieSecret = parsed.COOKIE_SECRET ?? parsed.SESSION_SECRET;
  if (!cookieSecret && requireProductionSecrets) throw new Error('COOKIE_SECRET is required');
  if (!parsed.DATABASE_URL && requireProductionSecrets) throw new Error('DATABASE_URL is required');
  if (!parsed.VAULT_SECRET && requireProductionSecrets) throw new Error('VAULT_SECRET is required');
  if (parsed.KILO_GATEWAY_URL && !parsed.KILO_API_KEY) {
    throw new Error('KILO_API_KEY is required with KILO_GATEWAY_URL');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    // The one committed fallback literal in the configuration layer, and it is a
    // 38-character value so that it satisfies the floor above it. It is a *published
    // signing key*, so it is never handed to a production composition: the API's
    // `getConfig` nulls it out for production and the startup policy refuses it by
    // name. Deriving it per process instead would be better, and would also mean a
    // developer's sessions do not survive a restart — recorded rather than done
    // here, because changing it is a behaviour change for every local install and
    // this row is about the floor, not about the fallback.
    cookieSecret: cookieSecret ?? 'development-only-cookie-secret-32-chars',
    sessionSecret: parsed.SESSION_SECRET,
    vaultSecret: parsed.VAULT_SECRET,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    workspaceId: parsed.WORKSPACE_ID,
    installationApiKey: parsed.AUTOMATE_API_KEY,
    reporterSecret: parsed.REPORTER_SECRET,
    runnerRegistrationSecret: parsed.RUNNER_REGISTRATION_SECRET,
    artifactRoot: parsed.ARTIFACT_ROOT,
    workerPollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    workerLeaseMs: parsed.WORKER_LEASE_MS,
    workerLeaseDurationMs: parsed.WORKER_LEASE_DURATION_MS,
    workerMaxAttempts: parsed.WORKER_MAX_ATTEMPTS,
    kiloGatewayUrl: parsed.KILO_GATEWAY_URL,
    kiloApiKey: parsed.KILO_API_KEY,
    ollamaBaseUrl: parsed.OLLAMA_BASE_URL,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    sessionRetentionDays: parsed.SESSION_RETENTION_DAYS,
    sseReplayRetentionHours: parsed.SSE_REPLAY_RETENTION_HOURS,
    auditRetentionDays: parsed.AUDIT_RETENTION_DAYS,
    retentionSweepIntervalSeconds: parsed.RETENTION_SWEEP_INTERVAL_SECONDS,
  };
}
