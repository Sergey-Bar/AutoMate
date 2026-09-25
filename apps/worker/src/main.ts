import { pathToFileURL } from 'node:url';
import { parseWorkerConfig } from './config.js';
import { WorkerHealthServer } from './health-server.js';
import { PostgresExecutionStore } from './postgres-store.js';
import { ExecutionWorker } from './worker.js';

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = parseWorkerConfig(env);
  const store = new PostgresExecutionStore(config.databaseUrl, {
    leaseDurationMs: config.leaseDurationMs,
    retryBackoffMs: config.retryBackoffMs,
    starvationAfterMs: config.starvationAfterMs,
    maxAttempts: config.maxAttempts,
    workspaceQuota: config.workspaceQuota,
    projectQuota: config.projectQuota,
  });
  const worker = new ExecutionWorker({
    store,
    runnerId: config.instanceId,
    capabilities: config.capabilities,
    labels: config.labels,
    slots: config.slots,
    pollIntervalMs: config.pollIntervalMs,
    leaseDurationMs: config.leaseDurationMs,
    leaseRenewIntervalMs: config.leaseRenewIntervalMs,
    scheduleBatchSize: config.scheduleBatchSize,
    onError: (error) => {
      const code = error instanceof Error ? error.name : 'WORKER_POLL_FAILED';
      console.error(`automate-worker poll failed (${code})`);
    },
  });
  const health = new WorkerHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    version: '1.0.0',
    isReady: () => worker.isReady(),
  });
  const port = await health.listen();
  console.info(`automate-worker listening on http://${config.healthHost}:${port}`);

  const lifecycle = new AbortController();
  const shutdown = (): void => {
    lifecycle.abort();
    worker.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await worker.run(lifecycle.signal);
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await health.close();
    await store.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error ? error.name : 'WORKER_START_FAILED';
    console.error(`automate-worker failed (${code})`);
    process.exitCode = 1;
  });
}
