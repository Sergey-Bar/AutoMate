import { z } from 'zod/v4';

const RunnerConfigSchema = z.object({
  apiUrl: z.string().url(),
  instanceId: z.string().min(1),
  podmanBinary: z.string().min(1).default('podman'),
  maxConcurrentJobs: z.coerce.number().int().min(1).max(32).default(1),
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export function parseRunnerConfig(input: Record<string, string | undefined>): RunnerConfig {
  return RunnerConfigSchema.parse({
    apiUrl: input['AUTOMATE_API_URL'],
    instanceId: input['RUNNER_INSTANCE_ID'],
    podmanBinary: input['PODMAN_BINARY'] ?? 'podman',
    maxConcurrentJobs: input['RUNNER_MAX_CONCURRENCY'] ?? '1',
  });
}
