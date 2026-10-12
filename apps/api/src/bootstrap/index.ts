import { Config, ConfigProvider, Effect, Option } from 'effect';
import type { AppConfig } from '@automate/config';

/**
 * The value in an `Option`, or `undefined`.
 *
 * **Twenty fields needed the same sentence**, each as a two-line ternary
 * spread across the object below — and one of them (`cookieSecret`) had
 * fallen back to `sessionSecret` while the rest had not, which is the kind
 * of drift that comes from a rule restated per field. The mapping from
 * `Option` to plain configuration is one idea and lives in one place.
 */
function optional(option: Option.Option<string>): string | undefined {
  return Option.getOrUndefined(option);
}

/**
 * Get validated configuration. This is the primary export for the rest of the API.
 *
 * Uses Effect's ConfigProvider to parse and validate environment variables,
 * then returns a plain AppConfig object.
 */
export const getConfig = (): AppConfig => {
  const provider = ConfigProvider.fromEnv();

  const configEffect = Config.all({
    nodeEnv: Config.Literals(['development', 'test', 'production'], 'NODE_ENV').pipe(
      Config.withDefault('development'),
    ),
    host: Config.String('HOST').pipe(Config.withDefault('127.0.0.1')),
    port: Config.Int('PORT').pipe(Config.withDefault(3000)),
    databaseUrl: Config.String('DATABASE_URL').pipe(Config.option),
    cookieSecret: Config.String('COOKIE_SECRET').pipe(Config.option),
    sessionSecret: Config.String('SESSION_SECRET').pipe(Config.option),
    vaultSecret: Config.String('VAULT_SECRET').pipe(Config.option),
    publicAppUrl: Config.String('PUBLIC_APP_URL').pipe(Config.withDefault('http://localhost:5173')),
    workspaceId: Config.String('WORKSPACE_ID').pipe(Config.withDefault('default-workspace')),
    automateApiKey: Config.String('AUTOMATE_API_KEY').pipe(Config.option),
    reporterSecret: Config.String('REPORTER_SECRET').pipe(Config.option),
    runnerRegistrationSecret: Config.String('RUNNER_REGISTRATION_SECRET').pipe(Config.option),
    artifactRoot: Config.String('ARTIFACT_ROOT').pipe(Config.withDefault('./var/artifacts')),
    workerPollIntervalMs: Config.Int('WORKER_POLL_INTERVAL_MS').pipe(Config.withDefault(1000)),
    workerLeaseDurationMs: Config.Int('WORKER_LEASE_DURATION_MS').pipe(Config.withDefault(30000)),
    workerMaxAttempts: Config.Int('WORKER_MAX_ATTEMPTS').pipe(Config.withDefault(2)),
    kiloGatewayUrl: Config.String('KILO_GATEWAY_URL').pipe(Config.option),
    kiloApiKey: Config.String('KILO_API_KEY').pipe(Config.option),
    ollamaBaseUrl: Config.String('OLLAMA_BASE_URL').pipe(Config.option),
    sessionTtlHours: Config.Int('SESSION_TTL_HOURS').pipe(Config.withDefault(24)),
    sessionRetentionDays: Config.Int('SESSION_RETENTION_DAYS').pipe(Config.withDefault(30)),
    sseReplayRetentionHours: Config.Int('SSE_REPLAY_RETENTION_HOURS').pipe(Config.withDefault(24)),
    auditRetentionDays: Config.Int('AUDIT_RETENTION_DAYS').pipe(Config.withDefault(365)),
    retentionSweepIntervalSeconds: Config.Int('RETENTION_SWEEP_INTERVAL_SECONDS').pipe(
      Config.withDefault(3600),
    ),
    projectRoot: Config.String('AUTOMATE_PROJECT_ROOT').pipe(Config.option),
    // Object store settings
    objectStoreEndpoint: Config.String('OBJECT_STORE_ENDPOINT').pipe(Config.option),
    objectStoreBucket: Config.String('OBJECT_STORE_BUCKET').pipe(Config.option),
    objectStoreRegion: Config.String('OBJECT_STORE_REGION').pipe(Config.option),
    objectStoreAccessKeyId: Config.String('OBJECT_STORE_ACCESS_KEY_ID').pipe(Config.option),
    objectStoreSecretAccessKey: Config.String('OBJECT_STORE_SECRET_ACCESS_KEY').pipe(Config.option),
    objectStoreForcePathStyle: Config.Boolean('OBJECT_STORE_FORCE_PATH_STYLE').pipe(
      Config.withDefault(false),
    ),
    objectStoreAllowInsecureHttp: Config.Boolean('OBJECT_STORE_ALLOW_INSECURE').pipe(
      Config.withDefault(false),
    ),
    objectStoreMaxBytes: Config.Int('OBJECT_STORE_MAX_BYTES').pipe(Config.option),
    objectStoreTimeoutMs: Config.Int('OBJECT_STORE_TIMEOUT_MS').pipe(Config.option),
    artifactReadFallbackRoot: Config.String('ARTIFACT_READ_FALLBACK_ROOT').pipe(Config.option),
  });

  const config = Effect.runSync(configEffect.parse(provider));

  // Build the objectStore config if all required fields are present
  const objectStore =
    Option.isSome(config.objectStoreEndpoint) &&
    Option.isSome(config.objectStoreBucket) &&
    Option.isSome(config.objectStoreRegion) &&
    Option.isSome(config.objectStoreAccessKeyId) &&
    Option.isSome(config.objectStoreSecretAccessKey)
      ? {
          endpoint: config.objectStoreEndpoint.value,
          bucket: config.objectStoreBucket.value,
          region: config.objectStoreRegion.value,
          accessKeyId: config.objectStoreAccessKeyId.value,
          secretAccessKey: config.objectStoreSecretAccessKey.value,
          forcePathStyle: config.objectStoreForcePathStyle,
          allowInsecureHttp: config.objectStoreAllowInsecureHttp,
          maxBytes: Option.isSome(config.objectStoreMaxBytes)
            ? config.objectStoreMaxBytes.value
            : 64 * 1024 * 1024,
          timeoutMs: Option.isSome(config.objectStoreTimeoutMs)
            ? config.objectStoreTimeoutMs.value
            : 15000,
        }
      : undefined;

  // cookieSecret falls back to SESSION_SECRET if not set
  // The one deliberate cascade: a cookie secret may be given either way, and
  // an install with neither falls back to a development-only value rather than
  // borrowing the session secret silently.
  const cookieSecret =
    optional(config.cookieSecret) ??
    optional(config.sessionSecret) ??
    'development-only-cookie-secret-32-chars';

  return {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    databaseUrl: optional(config.databaseUrl),
    cookieSecret,
    sessionSecret: optional(config.sessionSecret),
    vaultSecret: optional(config.vaultSecret),
    publicAppUrl: config.publicAppUrl,
    workspaceId: config.workspaceId,
    installationApiKey: optional(config.automateApiKey),
    reporterSecret: optional(config.reporterSecret),
    runnerRegistrationSecret: optional(config.runnerRegistrationSecret),
    artifactRoot: config.artifactRoot,
    workerPollIntervalMs: config.workerPollIntervalMs,
    workerLeaseDurationMs: config.workerLeaseDurationMs,
    workerMaxAttempts: config.workerMaxAttempts,
    kiloGatewayUrl: optional(config.kiloGatewayUrl),
    kiloApiKey: optional(config.kiloApiKey),
    ollamaBaseUrl: optional(config.ollamaBaseUrl),
    sessionTtlHours: config.sessionTtlHours,
    sessionRetentionDays: config.sessionRetentionDays,
    sseReplayRetentionHours: config.sseReplayRetentionHours,
    auditRetentionDays: config.auditRetentionDays,
    retentionSweepIntervalSeconds: config.retentionSweepIntervalSeconds,
    projectRoot: optional(config.projectRoot),
    objectStore,
    artifactReadFallbackRoot: optional(config.artifactReadFallbackRoot),
  } satisfies AppConfig;
};

export { type AppConfig } from '@automate/config';
