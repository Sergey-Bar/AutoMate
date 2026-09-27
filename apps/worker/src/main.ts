import { pathToFileURL } from 'node:url';
import { parseWorkerConfig } from './config.js';
import { WorkerHealthServer } from './health-server.js';
import { PostgresExecutionStore } from './postgres-store.js';
import { ExecutionWorker } from './worker.js';

export interface ProcessFailure {
  service: string;
  kind: 'unhandledRejection' | 'uncaughtException';
  code: string;
  message: string;
  stack: string | null;
}

export type ProcessFailureReporter = (failure: ProcessFailure) => void;

function describeProcessFailure(
  service: string,
  kind: ProcessFailure['kind'],
  reason: unknown,
): ProcessFailure {
  const error = reason instanceof Error ? reason : undefined;
  return {
    service,
    kind,
    code: error?.name ?? 'PROCESS_FAILURE',
    message: error?.message ?? String(reason),
    stack: error?.stack ?? null,
  };
}

/**
 * Makes a rejected promise or an escaped throw loud instead of silent, and
 * never becomes the reason the process dies: a reporter that throws is demoted
 * to a bare `console.error`, and even that is guarded.
 *
 * Returns a disposer so the handlers do not outlive `main`.
 */
export function installProcessFailureHandlers(
  service: string,
  report?: ProcessFailureReporter,
): () => void {
  const onFailure =
    (kind: ProcessFailure['kind']) =>
    (reason: unknown): void => {
      const failure = describeProcessFailure(service, kind, reason);
      const loud = (detail: string): void => {
        try {
          console.error(`${failure.service} ${failure.kind} (${failure.code})${detail}`);
        } catch {
          // Nothing left to report with. Dying here would hide the original.
        }
      };
      try {
        if (report) report(failure);
        else loud(`: ${failure.message}`);
      } catch {
        loud('');
      }
    };
  const onRejection = onFailure('unhandledRejection');
  const onException = onFailure('uncaughtException');
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  return () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  };
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const removeProcessFailureHandlers = installProcessFailureHandlers('automate-worker');
  try {
    await runWorker(env);
  } finally {
    removeProcessFailureHandlers();
  }
}

async function runWorker(env: Record<string, string | undefined>): Promise<void> {
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
