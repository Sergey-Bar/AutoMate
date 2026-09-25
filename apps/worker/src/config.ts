import { z } from 'zod/v4';

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

const WorkerConfigSchema = z.object({
  databaseUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a PostgreSQL URL',
    }),
  instanceId: z.string().min(1).default('worker-coordinator'),
  capabilities: z.string().default('').transform(csv),
  labels: z.string().default('').transform(csv),
  slots: z.coerce.number().int().min(1).max(32).default(1),
  pollIntervalMs: z.coerce.number().int().min(100).max(60_000).default(1_000),
  leaseDurationMs: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  leaseRenewIntervalMs: z.coerce.number().int().min(1_000).max(600_000).default(20_000),
  retryBackoffMs: z.coerce.number().int().min(0).max(3_600_000).default(1_000),
  starvationAfterMs: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
  workspaceQuota: z.coerce.number().int().min(1).max(100_000).default(100),
  projectQuota: z.coerce.number().int().min(1).max(100_000).default(20),
  scheduleBatchSize: z.coerce.number().int().min(1).max(1_000).default(100),
  healthHost: z.string().min(1).default('0.0.0.0'),
  healthPort: z.coerce.number().int().min(0).max(65_535).default(3001),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function parseWorkerConfig(input: Record<string, string | undefined>): WorkerConfig {
  return WorkerConfigSchema.parse({
    databaseUrl: input['DATABASE_URL'],
    instanceId: input['WORKER_INSTANCE_ID'],
    capabilities: input['WORKER_CAPABILITIES'] ?? '',
    labels: input['WORKER_LABELS'] ?? '',
    slots: input['WORKER_SLOTS'],
    pollIntervalMs: input['WORKER_POLL_INTERVAL_MS'],
    leaseDurationMs: input['WORKER_LEASE_DURATION_MS'] ?? input['WORKER_LEASE_MS'],
    leaseRenewIntervalMs: input['WORKER_LEASE_RENEW_INTERVAL_MS'],
    retryBackoffMs: input['WORKER_RETRY_BACKOFF_MS'],
    starvationAfterMs: input['WORKER_STARVATION_AFTER_MS'],
    maxAttempts: input['WORKER_MAX_ATTEMPTS'],
    workspaceQuota: input['WORKER_WORKSPACE_QUOTA'],
    projectQuota: input['WORKER_PROJECT_QUOTA'],
    scheduleBatchSize: input['WORKER_SCHEDULE_BATCH_SIZE'],
    healthHost: input['WORKER_HEALTH_HOST'],
    healthPort: input['WORKER_HEALTH_PORT'],
  });
}
