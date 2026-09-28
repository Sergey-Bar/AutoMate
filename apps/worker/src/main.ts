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
    // No `handler`, on purpose, and the absence is load-bearing.
    //
    // The worker is the scheduler and the lease-recovery loop: it reaps expired
    // leases and polls schedules. **Execution belongs to the runner.** `apps/runner`
    // claims jobs over `POST /api/v1/runners/:runnerId/jobs/claim`
    // (`apps/api/src/routes/execution/runners.routes.ts:127`) and runs them in the
    // execution boundary.
    //
    // `ExecutionWorker` has a second, in-process claim path that queries the same
    // `runners` and `jobs` tables as the API. Wiring a handler here would put the
    // worker in competition with the runners for the same jobs, in a process that has
    // no execution capability — so every job it won would end as `infra_failed` or
    // bounce through requeue. That is why this composition passes no handler, and it
    // has been read as an oversight before: the planning audit recorded "the worker
    // production composition passes no JobHandler" as the largest single gap in the
    // repository, on the reading that the product could not execute jobs at all. It
    // can, and does, through the runner.
    //
    // Two further reasons the path is inert, so the failure is doubly safe rather
    // than merely intended: no handler means `runOnce` skips claiming entirely, and
    // `PostgresExecutionStore.claimJob` requires a healthy, unrevoked `runners` row
    // for `runnerId`, which this process never registers. The invariant is pinned by
    // two cases in `worker.test.ts` — `claims nothing without a handler, even when a
    // job is claimable` and `still does its scheduler work without a handler` — so it
    // cannot be "fixed" into a regression by a later reader.
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
