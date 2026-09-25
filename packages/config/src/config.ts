import { z } from 'zod/v4';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  COOKIE_SECRET: z.string().min(32).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  VAULT_SECRET: z.string().min(32).optional(),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  WORKSPACE_ID: z.string().min(1).default('default-workspace'),
  AUTOMATE_API_KEY: z.string().min(16).optional(),
  REPORTER_SECRET: z.string().min(16).optional(),
  RUNNER_REGISTRATION_SECRET: z.string().min(16).optional(),
  ARTIFACT_ROOT: z.string().min(1).default('./var/artifacts'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(30000),
  WORKER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(2),
  KILO_GATEWAY_URL: z.string().url().optional(),
  KILO_API_KEY: z.string().min(16).optional(),
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
  const normalized = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== ''),
  );
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
