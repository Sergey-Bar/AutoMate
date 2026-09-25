import { RunnerClient } from '@automate/runner-sdk';
import { parseRunnerConfig } from './config.js';

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = parseRunnerConfig(env);
  const client = new RunnerClient({
    baseUrl: config.apiUrl,
    credential: env['RUNNER_CREDENTIAL'] ?? '',
  });
  if (!env['RUNNER_CREDENTIAL']) throw new Error('RUNNER_CREDENTIAL is required');
  await client.sync({ runnerId: config.instanceId, capabilities: [], activeJobIds: [] });
}
