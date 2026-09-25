import type {
  ExecutionStore,
  JobClaim,
  JobHandler,
  JobResultStatus,
  LeaseRecovery,
  ScheduledEnqueueResult,
} from './types.js';
import { pollSchedules } from './scheduler.js';

export interface ExecutionWorkerOptions {
  store: ExecutionStore;
  runnerId: string;
  capabilities: readonly string[];
  labels: readonly string[];
  slots: number;
  pollIntervalMs: number;
  leaseDurationMs: number;
  leaseRenewIntervalMs: number;
  scheduleBatchSize?: number;
  handler?: JobHandler;
  onError?: (error: unknown) => void;
}

export interface WorkerRunResult {
  recovered: LeaseRecovery[];
  scheduled: ScheduledEnqueueResult[];
  claimed: JobClaim[];
}

interface ActiveWorkerJob {
  controller: AbortController;
  promise: Promise<void>;
}

export class ExecutionWorker {
  private readonly lifecycle = new AbortController();
  private readonly active = new Map<string, ActiveWorkerJob>();
  private running = false;
  private ready = false;

  constructor(private readonly options: ExecutionWorkerOptions) {}

  isReady(): boolean {
    return this.running && this.ready;
  }

  activeJobIds(): string[] {
    return [...this.active.keys()];
  }

  async runOnce(now = new Date()): Promise<WorkerRunResult> {
    const recovered = await this.options.store.reapExpiredLeases(now);
    const scheduled = await pollSchedules(
      this.options.store,
      now,
      this.options.scheduleBatchSize ?? 100,
    );
    const claimed: JobClaim[] = [];
    if (this.options.handler) {
      while (!this.lifecycle.signal.aborted && this.active.size < this.options.slots) {
        const claim = await this.options.store.claimJob(
          this.options.runnerId,
          this.options.capabilities,
          this.options.labels,
          now,
        );
        if (!claim) break;
        claimed.push(claim);
        this.start(claim);
      }
    }
    return { recovered, scheduled, claimed };
  }

  async run(externalSignal?: AbortSignal): Promise<void> {
    const forwardAbort = (): void => this.lifecycle.abort();
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    if (externalSignal?.aborted) this.lifecycle.abort();
    this.running = true;
    try {
      while (!this.lifecycle.signal.aborted) {
        try {
          if (!(await this.options.store.ping())) throw new Error('Execution store is unavailable');
          await this.runOnce();
          this.ready = true;
        } catch (error) {
          this.ready = false;
          this.report(error);
        }
        await this.wait(this.options.pollIntervalMs);
      }
    } finally {
      this.ready = false;
      for (const job of this.active.values()) job.controller.abort();
      await Promise.allSettled([...this.active.values()].map((job) => job.promise));
      this.running = false;
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  stop(): void {
    this.ready = false;
    this.lifecycle.abort();
  }

  private start(claim: JobClaim): void {
    const controller = new AbortController();
    const active: ActiveWorkerJob = { controller, promise: Promise.resolve() };
    this.active.set(claim.jobId, active);
    active.promise = this.execute(claim, active).catch(this.report);
    active.promise.finally(() => this.active.delete(claim.jobId));
  }

  private async execute(claim: JobClaim, active: ActiveWorkerJob): Promise<void> {
    let timedOut = false;
    let leaseLost = false;
    let renewing = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      active.controller.abort();
    }, claim.timeoutMs);
    const renewal = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.options.store
        .renewLease(
          claim.jobId,
          claim.leaseId,
          claim.fencingToken,
          new Date(Date.now() + this.options.leaseDurationMs),
        )
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            active.controller.abort();
          }
        })
        .catch(this.report)
        .finally(() => {
          renewing = false;
        });
    }, this.options.leaseRenewIntervalMs);
    let status: JobResultStatus = 'infra_failed';
    let error: { code: string; message: string } | undefined;
    try {
      const handled = await this.options.handler!.execute(claim, active.controller.signal);
      status = leaseLost
        ? 'runner_lost'
        : timedOut
          ? 'timed_out'
          : active.controller.signal.aborted
            ? 'cancelled'
            : handled;
      if (status !== 'completed' && status !== 'requeue') {
        error = { code: status.toUpperCase(), message: `Job ended as ${status}` };
      }
    } catch {
      status = leaseLost ? 'runner_lost' : timedOut ? 'timed_out' : 'infra_failed';
      error = { code: 'WORKER_INFRA_FAILED', message: 'Job handler failed' };
    } finally {
      clearTimeout(timeout);
      clearInterval(renewal);
    }
    if (status === 'requeue') {
      await this.options.store.releaseJob(claim.jobId, claim.leaseId, claim.fencingToken);
    } else {
      await this.options.store.completeJob(claim.jobId, {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status,
        error,
      });
    }
  }

  private report = (error: unknown): void => {
    if (this.options.onError) this.options.onError(error);
    else
      console.error(`worker job failed (${error instanceof Error ? error.name : 'WORKER_ERROR'})`);
  };

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolveWait) => {
      if (this.lifecycle.signal.aborted) {
        resolveWait();
        return;
      }
      const signal = this.lifecycle.signal;
      function done(): void {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolveWait();
      }
      const timer = setTimeout(done, milliseconds);
      this.lifecycle.signal.addEventListener('abort', done, { once: true });
    });
  }
}
