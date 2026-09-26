import { parseConfig, type AppConfig as CanonicalConfig } from '@automate/config';
import { DEVELOPMENT_COOKIE_SECRET } from './startup-policy.js';
import {
  normalizeObjectStoreSettings,
  type ObjectStoreSettings,
} from './infrastructure/s3-artifact-bytes.js';

export type AppConfig = Omit<Partial<CanonicalConfig>, 'nodeEnv' | 'port'> & {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  cookieSecret?: string;
  reporterSecret?: string;
  runnerRegistrationSecret?: string;
  apiKey?: string;
  vaultSecret?: string;
  objectStore?: ObjectStoreSettings;
  artifactReadFallbackRoot?: string;
};

const OBJECT_STORE_VARIABLES = {
  endpoint: 'OBJECT_STORE_ENDPOINT',
  bucket: 'OBJECT_STORE_BUCKET',
  region: 'OBJECT_STORE_REGION',
  accessKeyId: 'OBJECT_STORE_ACCESS_KEY_ID',
  secretAccessKey: 'OBJECT_STORE_SECRET_ACCESS_KEY',
  forcePathStyle: 'OBJECT_STORE_FORCE_PATH_STYLE',
  allowInsecureHttp: 'OBJECT_STORE_ALLOW_INSECURE',
  maxBytes: 'OBJECT_STORE_MAX_BYTES',
  timeoutMs: 'OBJECT_STORE_TIMEOUT_MS',
} as const;

const OBJECT_STORE_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const OBJECT_STORE_FALSY = new Set(['0', 'false', 'no', 'off']);

function positiveInteger(value: string | undefined, variable: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${variable} must be a positive integer`);
  }
  return parsed;
}

/**
 * Reads the S3-compatible object store configuration. Configuration is
 * all-or-nothing: a half-configured store is a deployment mistake, so it throws
 * naming the missing variables instead of composing an adapter that would fail
 * on the first artifact. Being entirely absent is only acceptable outside
 * production, where checkProductionPolicy refuses the local filesystem store.
 */
export function readObjectStoreSettings(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStoreSettings | undefined {
  const value = (field: keyof typeof OBJECT_STORE_VARIABLES): string | undefined => {
    const raw = env[OBJECT_STORE_VARIABLES[field]];
    return raw === undefined || raw === '' ? undefined : raw;
  };
  const required = ['endpoint', 'bucket', 'region', 'accessKeyId', 'secretAccessKey'] as const;
  const requiredConfigured = required.filter((field) => value(field) !== undefined);
  if (requiredConfigured.length === 0) return undefined;
  const missing = required.filter((field) => value(field) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Object store configuration is incomplete; set ${missing
        .map((field) => OBJECT_STORE_VARIABLES[field])
        .join(', ')}`,
    );
  }
  const forcePathStyle = value('forcePathStyle');
  if (
    forcePathStyle !== undefined &&
    !OBJECT_STORE_TRUTHY.has(forcePathStyle) &&
    !OBJECT_STORE_FALSY.has(forcePathStyle)
  ) {
    throw new Error(`${OBJECT_STORE_VARIABLES.forcePathStyle} must be a boolean`);
  }
  const allowInsecureHttp = value('allowInsecureHttp');
  if (
    allowInsecureHttp !== undefined &&
    !OBJECT_STORE_TRUTHY.has(allowInsecureHttp) &&
    !OBJECT_STORE_FALSY.has(allowInsecureHttp)
  ) {
    throw new Error(`${OBJECT_STORE_VARIABLES.allowInsecureHttp} must be a boolean`);
  }
  return normalizeObjectStoreSettings({
    endpoint: value('endpoint'),
    bucket: value('bucket'),
    region: value('region'),
    accessKeyId: value('accessKeyId'),
    secretAccessKey: value('secretAccessKey'),
    forcePathStyle:
      forcePathStyle === undefined ? undefined : OBJECT_STORE_TRUTHY.has(forcePathStyle),
    allowInsecureHttp:
      allowInsecureHttp === undefined ? undefined : OBJECT_STORE_TRUTHY.has(allowInsecureHttp),
    maxBytes: positiveInteger(value('maxBytes'), OBJECT_STORE_VARIABLES.maxBytes),
    timeoutMs: positiveInteger(value('timeoutMs'), OBJECT_STORE_VARIABLES.timeoutMs),
  });
}

export function getConfig(): AppConfig {
  // Production secret requirements are enforced by checkProductionPolicy so the
  // API owns one startup contract (and its error messages) instead of two.
  const canonical = parseConfig(process.env, { requireProductionSecrets: false });
  return {
    ...canonical,
    // parseConfig substitutes a development-only cookie secret when none is
    // configured. Never hand that literal to a production composition; the
    // startup policy rejects the missing secret before any secret is used.
    cookieSecret:
      canonical.nodeEnv === 'production' && canonical.cookieSecret === DEVELOPMENT_COOKIE_SECRET
        ? undefined
        : canonical.cookieSecret,
    apiKey: canonical.installationApiKey,
    runnerRegistrationSecret: canonical.runnerRegistrationSecret,
    objectStore: readObjectStoreSettings(),
    artifactReadFallbackRoot: process.env['ARTIFACT_READ_FALLBACK_ROOT']?.trim() || undefined,
  };
}
