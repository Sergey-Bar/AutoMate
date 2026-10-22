import { Effect, Exit, Scope } from 'effect';

/**
 * Process lifecycle for the API: what is opened at boot is closed, in order, when the process is
 * asked to stop.
 *
 * This is the one place `effect` is used in the API (ledger DEP-1), and it is the place the
 * migration policy names: "Use Effect only in `apps/api/src/bootstrap` for validated
 * configuration, service lifecycle, and composition; keep framework-neutral domain packages in
 * plain TypeScript." Service lifecycle is where Effect's `Scope` is a better tool than hand-rolled
 * code: finalizers run in the reverse order they were added, each runs even if an earlier one
 * failed, and the scope can be closed only once. The rest of the API stays plain TypeScript with
 * its one error boundary.
 *
 * Before this the API had no shutdown at all. `serve()`'s server was never closed, the connection
 * pool was never drained and nothing listened for a signal, so a container restart cut off
 * in-flight requests and every open event stream, and left connections for PostgreSQL to time out.
 */
export class Lifecycle {
  private readonly scope = Effect.runSync(Scope.make());
  private closing: Promise<void> | undefined;
  private readonly failed: string[] = [];

  /** @param onFailure called with the resource's name when closing it throws or rejects */
  constructor(
    private readonly onFailure: (name: string, error: unknown) => void = () => undefined,
  ) {}

  /**
   * Register something to close at shutdown. Resources close in the reverse order they are added,
   * so add the thing others depend on first: the pool before the server that queries it.
   */
  add(name: string, close: () => void | Promise<void>): void {
    const finalizer = Effect.tryPromise({
      try: async () => close(),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          this.failed.push(name);
          this.onFailure(name, error);
        }),
      ),
    );
    Effect.runSync(Scope.addFinalizer(this.scope, finalizer));
  }

  /** The names of the resources whose close failed, once shutdown has run. */
  get failures(): readonly string[] {
    return this.failed;
  }

  /** Close everything. Safe to call more than once: the second call waits for the first. */
  shutdown(): Promise<void> {
    this.closing ??= Effect.runPromise(Scope.close(this.scope, Exit.void));
    return this.closing;
  }
}

/**
 * Stop accepting connections and wait for open ones, up to `graceMs`, then cut off what is left.
 *
 * `server.close()` alone is not enough here: it waits for every connection to end, and a
 * server-sent-events stream is a connection that does not. So idle keep-alive connections are
 * dropped at once, requests being answered get the grace period to finish, and whatever is still
 * open after it (the event streams) is closed, which the browser's `EventSource` answers by
 * reconnecting to the next instance.
 */
/**
 * What closeHttpServer needs of a server. serve() is typed as returning HTTP/1, HTTPS or
 * HTTP/2, and only the first two can drop connections, so those two are optional.
 */
export interface ClosableServer {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

export function closeHttpServer(server: ClosableServer, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cutOff = setTimeout(() => server.closeAllConnections?.(), graceMs);
    server.close((error) => {
      clearTimeout(cutOff);
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeIdleConnections?.();
  });
}

export interface ShutdownOptions {
  /** The thing that emits the signals; `process` in production. */
  process: { on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown };
  exit: (code: number) => void;
  log: (message: string) => void;
  /** The whole budget for shutting down. Past it the process exits non-zero rather than hang. */
  graceMs: number;
}

/**
 * Shut down on SIGTERM and SIGINT, once.
 *
 * Exit status is part of the contract with a supervisor: 0 is a clean stop, 1 is that something
 * failed to close or shutdown did not finish inside `graceMs`. A shutdown that hangs is worse than
 * one that fails, because an orchestrator then waits its own (longer) timeout and kills the
 * process anyway, so this one decides for itself.
 */
export function installShutdownHandlers(lifecycle: Lifecycle, options: ShutdownOptions): void {
  let started = false;
  const stop = (signal: string): void => {
    if (started) return;
    started = true;
    options.log(`received ${signal}, shutting down`);
    const timer = setTimeout(() => {
      options.log(`shutdown did not finish in ${String(options.graceMs)} ms, exiting`);
      options.exit(1);
    }, options.graceMs);
    timer.unref();
    void lifecycle.shutdown().then(
      () => {
        clearTimeout(timer);
        options.exit(lifecycle.failures.length > 0 ? 1 : 0);
      },
      () => {
        clearTimeout(timer);
        options.exit(1);
      },
    );
  };
  options.process.on('SIGTERM', () => stop('SIGTERM'));
  options.process.on('SIGINT', () => stop('SIGINT'));
}
