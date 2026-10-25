import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

const defaultProjectRoot = fileURLToPath(new URL('../fixtures/playwright-smoke/', import.meta.url));
const defaultApiCollectionRoot = fileURLToPath(new URL('../fixtures/api-smoke/', import.meta.url));
const defaultK6ScriptRoot = fileURLToPath(new URL('../fixtures/k6/', import.meta.url));
const defaultSpoolRoot = join(tmpdir(), 'automate-runner-spool');

function csv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function origins(value: string): string[] {
  return [
    ...new Set(
      csv(value).map((item) => {
        const url = new URL(item);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error(`Invalid runner target URL: ${item}`);
        }
        return url.origin;
      }),
    ),
  ];
}

/**
 * Whether the API address keeps the runner's credentials off an open network: https, this
 * machine, or a single-label name — a compose service such as `http://api:3000`, which only
 * resolves inside the container network.
 */
function isSafeApiUrl(apiUrl: string): boolean {
  const url = new URL(apiUrl);
  if (url.protocol === 'https:') return true;
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return (
    host === 'localhost' || host === '::1' || /^127\./u.test(host) || /^[a-z0-9-]+$/u.test(host)
  );
}

const RunnerConfigSchema = z
  .object({
    apiUrl: z
      .string()
      .url()
      .transform((value) => value.replace(/\/$/u, '')),
    instanceId: z.string().min(1),
    name: z.string().min(1).optional(),
    version: z.string().min(1).default('1.0.0'),
    registrationSecret: z.string().min(1).optional(),
    credential: z.string().min(1).optional(),
    capabilities: z.string().default('playwright,chromium,api').transform(csv),
    labels: z.string().default('').transform(csv),
    slots: z.coerce.number().int().min(1).max(32).default(1),
    maxConcurrentJobs: z.coerce.number().int().min(1).max(32).default(1),
    pollIntervalMs: z.coerce.number().int().min(100).max(60_000).default(1_000),
    heartbeatIntervalMs: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
    requestTimeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    shutdownTimeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    healthHost: z.string().min(1).default('0.0.0.0'),
    healthPort: z.coerce.number().int().min(0).max(65_535).default(3002),
    workspaceRoot: z.string().min(1).default(tmpdir()),
    /**
     * Where registered repositories live on this host.
     *
     * The generic spawn mode resolves every `workingDirectory` against this and
     * refuses anything that escapes it, so it is a **boundary** and not a
     * convenience: a job whose `cwd` is `../../etc` cannot be executed at all.
     * Defaulted to the same root the Playwright adapter uses so a single-project
     * install works with no extra configuration.
     */
    repoRoot: z.string().min(1).default(defaultProjectRoot),
    playwrightProjectRoot: z.string().min(1).default(defaultProjectRoot),
    /**
     * Where Bruno collections live on this host. A job's `apiCollection` is resolved against it
     * and refused if it leaves it, as `repoRoot` does for a generic command.
     */
    apiCollectionRoot: z.string().min(1).default(defaultApiCollectionRoot),
    allowedPlaywrightProjects: z.string().default('smoke-pass,smoke-failure').transform(csv),
    /**
     * Where the k6 load scripts live. A load job names a script *relative to this directory*
     * and the adapter refuses anything that resolves outside it (links included), so the
     * scripts that run are the operator's, never the caller's. See `k6-execution.ts`.
     */
    k6ScriptRoot: z.string().min(1).default(defaultK6ScriptRoot),
    allowedTargetUrls: z.string().default('http://127.0.0.1:3000').transform(origins),
    artifactMaxBytes: z.coerce.number().int().min(1).max(500_000_000).default(50_000_000),
    logMaxBytes: z.coerce.number().int().min(1_024).max(50_000_000).default(5_000_000),
    spoolRoot: z.string().min(1).default(defaultSpoolRoot),
    spoolKey: z.string().min(16).optional(),
    spoolMaxEntries: z.coerce.number().int().min(1).max(1_000_000).default(10_000),
    spoolMaxBytes: z.coerce.number().int().min(1_024).max(2_000_000_000).default(64_000_000),
    spoolCompactThresholdBytes: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(2_000_000_000)
      .default(8_000_000),
    spoolRetryMaxAttempts: z.coerce.number().int().min(1).max(100).default(8),
    spoolRetryBaseDelayMs: z.coerce.number().int().min(1).max(60_000).default(250),
    spoolRetryMaxDelayMs: z.coerce.number().int().min(1).max(600_000).default(30_000),
    redactions: z.string().default('').transform(csv),
    allowInsecureApi: z
      .enum(['1', 'true', 'yes', '0', 'false', 'no'])
      .optional()
      .transform((value) => value === '1' || value === 'true' || value === 'yes'),
  })
  .superRefine((value, context) => {
    if (!value.allowInsecureApi && !isSafeApiUrl(value.apiUrl)) {
      context.addIssue({
        code: 'custom',
        message:
          `AUTOMATE_API_URL=${value.apiUrl} is plain HTTP to another machine, so the registration ` +
          'secret and every job token would cross the network in the clear. Use the https:// ' +
          'address LAN mode serves, or set RUNNER_ALLOW_INSECURE_API=1 on a network you trust.',
      });
    }
    if (!value.registrationSecret && !value.credential) {
      context.addIssue({
        code: 'custom',
        message: 'RUNNER_REGISTRATION_SECRET or RUNNER_CREDENTIAL is required',
      });
    }
    if (value.allowedPlaywrightProjects.length === 0 || value.allowedTargetUrls.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Runner project and URL allowlists cannot be empty',
      });
    }
  })
  // The default name carries the instance id. `runners` is unique on (workspace_id, name), so
  // one name shared by every runner made the second runner on an installation fail to register
  // with an opaque 23505 DUPLICATE, whatever its instance id.
  .transform((value) => ({
    ...value,
    name: value.name ?? `automate-playwright-runner-${value.instanceId}`,
  }));

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export function parseRunnerConfig(input: Record<string, string | undefined>): RunnerConfig {
  return RunnerConfigSchema.parse({
    apiUrl: input['AUTOMATE_API_URL'],
    instanceId: input['RUNNER_INSTANCE_ID'],
    name: input['RUNNER_NAME'],
    version: input['RUNNER_VERSION'],
    registrationSecret: input['RUNNER_REGISTRATION_SECRET'],
    credential: input['RUNNER_CREDENTIAL'],
    capabilities: input['RUNNER_CAPABILITIES'] ?? 'playwright,chromium,api',
    labels: input['RUNNER_LABELS'],
    slots: input['RUNNER_SLOTS'],
    maxConcurrentJobs: input['RUNNER_MAX_CONCURRENCY'],
    pollIntervalMs: input['RUNNER_POLL_INTERVAL_MS'],
    heartbeatIntervalMs: input['RUNNER_HEARTBEAT_INTERVAL_MS'],
    requestTimeoutMs: input['RUNNER_REQUEST_TIMEOUT_MS'],
    shutdownTimeoutMs: input['RUNNER_SHUTDOWN_TIMEOUT_MS'],
    healthHost: input['RUNNER_HEALTH_HOST'],
    healthPort: input['RUNNER_HEALTH_PORT'],
    workspaceRoot: input['RUNNER_WORKSPACE_ROOT'],
    repoRoot: input['RUNNER_REPO_ROOT'],
    playwrightProjectRoot: input['RUNNER_PLAYWRIGHT_PROJECT_ROOT'],
    apiCollectionRoot: input['RUNNER_API_COLLECTION_ROOT'],
    allowedPlaywrightProjects: input['RUNNER_PLAYWRIGHT_PROJECTS'],
    k6ScriptRoot: input['RUNNER_K6_SCRIPT_ROOT'],
    allowedTargetUrls: input['RUNNER_ALLOWED_TARGET_URLS'],
    artifactMaxBytes: input['RUNNER_ARTIFACT_MAX_BYTES'],
    logMaxBytes: input['RUNNER_LOG_MAX_BYTES'],
    spoolRoot: input['RUNNER_SPOOL_ROOT'],
    spoolKey: input['RUNNER_SPOOL_KEY'],
    spoolMaxEntries: input['RUNNER_SPOOL_MAX_ENTRIES'],
    spoolMaxBytes: input['RUNNER_SPOOL_MAX_BYTES'],
    spoolCompactThresholdBytes: input['RUNNER_SPOOL_COMPACT_THRESHOLD_BYTES'],
    spoolRetryMaxAttempts: input['RUNNER_SPOOL_RETRY_MAX_ATTEMPTS'],
    spoolRetryBaseDelayMs: input['RUNNER_SPOOL_RETRY_BASE_DELAY_MS'],
    spoolRetryMaxDelayMs: input['RUNNER_SPOOL_RETRY_MAX_DELAY_MS'],
    redactions: input['RUNNER_REDACT_VALUES'],
    allowInsecureApi: input['RUNNER_ALLOW_INSECURE_API'] || undefined,
  });
}
