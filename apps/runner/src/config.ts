import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

const defaultProjectRoot = fileURLToPath(new URL('../fixtures/playwright-smoke/', import.meta.url));
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

const RunnerConfigSchema = z
  .object({
    apiUrl: z
      .string()
      .url()
      .transform((value) => value.replace(/\/$/u, '')),
    instanceId: z.string().min(1),
    name: z.string().min(1).default('automate-playwright-runner'),
    version: z.string().min(1).default('1.0.0'),
    registrationSecret: z.string().min(1).optional(),
    credential: z.string().min(1).optional(),
    capabilities: z.string().default('playwright,chromium').transform(csv),
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
    playwrightProjectRoot: z.string().min(1).default(defaultProjectRoot),
    allowedPlaywrightProjects: z.string().default('smoke-pass,smoke-failure').transform(csv),
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
  })
  .superRefine((value, context) => {
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
  });

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export function parseRunnerConfig(input: Record<string, string | undefined>): RunnerConfig {
  return RunnerConfigSchema.parse({
    apiUrl: input['AUTOMATE_API_URL'],
    instanceId: input['RUNNER_INSTANCE_ID'],
    name: input['RUNNER_NAME'],
    version: input['RUNNER_VERSION'],
    registrationSecret: input['RUNNER_REGISTRATION_SECRET'],
    credential: input['RUNNER_CREDENTIAL'],
    capabilities: input['RUNNER_CAPABILITIES'] ?? 'playwright,chromium',
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
    playwrightProjectRoot: input['RUNNER_PLAYWRIGHT_PROJECT_ROOT'],
    allowedPlaywrightProjects: input['RUNNER_PLAYWRIGHT_PROJECTS'],
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
  });
}
