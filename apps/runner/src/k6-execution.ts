import { type ChildProcessWithoutNullStreams, spawn, type SpawnOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { K6_JSON_ADAPTER_VERSION, parseK6Summary } from '@automate/reporter';
import {
  LoadJobConfigurationSchema,
  type CanonicalRunResult,
  type ExecutionEventLine,
  type LoadJobConfiguration,
} from '@automate/shared-contracts';
import { artifactKind } from './artifact-kind.js';
import {
  CappedLog,
  RunnerConfigurationError,
  RunnerInfrastructureError,
  collectFiles,
  contentType,
  sanitizeEnvironment,
  sanitizeError,
  terminateProcessTree,
  assertAllowedTarget,
  type ExecutionArtifact,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
  type ExecutionStatus,
  type ProcessSpawner,
} from './execution.js';
import { WINDOWS_ENV_ALLOWLIST } from './windows-command.js';

/**
 * Runs one bounded k6 script and turns its summary into test events (ledger X-3 / BK-1).
 *
 * ## Why this is its own adapter and not the generic command mode
 *
 * `GenericSpawnAdapter` runs an argv that a job's `configuration.command` carries. For k6 that
 * would put the whole command line - flags, output sinks, `--out cloud=...` - in a database
 * row, which is exactly the surface the load input contract (`LoadRunInputSchema`) refuses to
 * have. Here the job carries `{ script, vus, durationSeconds }`, and **this file builds the
 * argv**: nothing a caller sends can become a flag.
 *
 * ## What is bounded, and by whom
 *
 * - **Load**: `vus` and `durationSeconds` are re-parsed against the contract ceilings
 *   (`LOAD_MAX_VUS`, `LOAD_MAX_DURATION_SECONDS`), so a job row written by something other
 *   than the API is held to the same bound. They are passed as `--vus` / `--duration`, which
 *   take precedence over anything the script's `options` declares.
 * - **Script**: a path inside `scriptRoot` (`RUNNER_K6_SCRIPT_ROOT`), checked lexically and
 *   again after resolving symlinks. The scripts there are the operator's.
 * - **Target**: handed to the script as `TARGET_URL`, after the same origin allowlist
 *   (`RUNNER_ALLOWED_TARGET_URLS`) the Playwright adapter applies. **The allowlist governs the
 *   target the caller names; it does not sandbox the script**, which can still request any URL
 *   it contains. That is why scripts come from an operator-controlled directory and not from
 *   the caller.
 * - **Time**: the job's deadline stops the whole process tree (`terminateProcessTree`), as do
 *   cancellation and runner shutdown.
 *
 * ## Where the verdict comes from
 *
 * k6's thresholds are the verdict, and `@automate/reporter`'s `parseK6Summary` is the only
 * thing that reads the summary - this file does not interpret metrics. Its attempts become
 * `test.started` / `test.completed` events (the same stream the Playwright reporter feeds), so
 * the run's tests and score come out of the pipeline every other producer uses. Exit status
 * agrees or the run is not a pass: `0` and `99` (thresholds crossed) are k6's two answers,
 * anything else is k6 failing, and a clean exit with no readable summary asserted nothing.
 */

/** k6's exit code for "a threshold was crossed". Everything else non-zero is k6 itself failing. */
export const K6_THRESHOLDS_CROSSED_EXIT = 99;

const SUMMARY_FILE = 'k6-summary.json';
const TREND_STATS = 'avg,min,med,max,p(90),p(95),p(99)';
const BASE_ENV_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'CI'];

export interface K6ExecutionOptions {
  /** `RUNNER_K6_SCRIPT_ROOT`: scripts are named relative to this directory. */
  scriptRoot: string;
  allowedTargetUrls: readonly string[];
  workspaceRoot: string;
  artifactMaxBytes: number;
  logMaxBytes: number;
  /** The k6 executable. Defaults to `k6` on `PATH`. */
  k6Binary?: string;
  redactions?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: ProcessSpawner;
  terminateProcess?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  now?: () => Date;
}
function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], { ...options, shell: false, stdio: 'pipe' });
}

interface ChildExit {
  code: number | null;
  timedOut: boolean;
  spawnError: Error | undefined;
}

interface Verdict {
  result: CanonicalRunResult | null;
  /** Why there is no result, when there is none. */
  problem: string | undefined;
}

export class K6ExecutionAdapter implements ExecutionProvider {
  private readonly scriptRoot: string;
  private readonly workspaceRoot: string;
  private readonly allowedTargets: ReadonlySet<string>;
  private readonly k6Binary: string;
  private readonly spawnProcess: ProcessSpawner;
  private readonly terminateProcess: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly redactions: readonly string[];
  private readonly now: () => Date;

  constructor(private readonly options: K6ExecutionOptions) {
    this.scriptRoot = resolve(options.scriptRoot);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.allowedTargets = new Set(options.allowedTargetUrls.map((value) => new URL(value).origin));
    this.k6Binary = options.k6Binary ?? 'k6';
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.terminateProcess = options.terminateProcess ?? terminateProcessTree;
    this.environment = options.environment ?? process.env;
    this.redactions = [...new Set(options.redactions ?? [])];
    this.now = options.now ?? (() => new Date());
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const redactions = [...new Set([...this.redactions, ...(context.redactions ?? [])])];
    const job = this.readJob(context);
    const target = assertAllowedTarget(context.targetUrl ?? '', this.allowedTargets);
    const script = await this.resolveScript(job.script);

    await mkdir(this.workspaceRoot, { recursive: true });
    const workspacePath = await mkdtemp(join(this.workspaceRoot, `${safeSegment(context.jobId)}-`));
    try {
      return await this.runInWorkspace({ context, job, target, script, workspacePath, redactions });
    } catch (error) {
      await rm(workspacePath, { recursive: true, force: true });
      if (error instanceof RunnerConfigurationError || error instanceof RunnerInfrastructureError) {
        throw error;
      }
      throw new RunnerInfrastructureError(sanitizeError(error, redactions));
    }
  }

  async cleanup(workspacePath: string): Promise<void> {
    const inside = relative(this.workspaceRoot, resolve(workspacePath));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new RunnerConfigurationError('Path is outside the configured runner workspace');
    }
    await rm(workspacePath, { recursive: true, force: true });
  }

  /** The job's k6 block, held to the contract ceilings, and a deadline that can be enforced. */
  private readJob(context: ExecutionContext): LoadJobConfiguration {
    const parsed = LoadJobConfigurationSchema.safeParse(context.k6);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunnerConfigurationError(
        `k6 job configuration is invalid: ${issue?.path.join('.') || 'k6'} ${issue?.message ?? ''}`.trim(),
      );
    }
    if (!Number.isInteger(context.deadlineMs) || context.deadlineMs < 1) {
      throw new RunnerConfigurationError('Execution timeout must be a positive integer');
    }
    return parsed.data;
  }

  /**
   * The absolute script path, or a refusal. Checked lexically (the contract already forbids
   * `..`), then again after symlinks resolve, because a link inside the root pointing outside
   * it would otherwise run a file nobody put there.
   */
  private async resolveScript(script: string): Promise<string> {
    const candidate = resolve(this.scriptRoot, script);
    this.assertInsideRoot(candidate, this.scriptRoot);
    const real = await realpath(candidate).catch(() => undefined);
    const info = real === undefined ? undefined : await stat(real).catch(() => undefined);
    if (real === undefined || info === undefined || !info.isFile()) {
      throw new RunnerConfigurationError(`k6 script was not found in the script root: ${script}`);
    }
    this.assertInsideRoot(real, await realpath(this.scriptRoot));
    return real;
  }

  private assertInsideRoot(candidate: string, root: string): void {
    const inside = relative(root, candidate);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new RunnerConfigurationError('k6 script is outside the configured script root');
    }
  }

  private async runInWorkspace(run: {
    context: ExecutionContext;
    job: LoadJobConfiguration;
    target: string;
    script: string;
    workspacePath: string;
    redactions: readonly string[];
  }): Promise<ExecutionResult> {
    const { context, job, workspacePath, redactions } = run;
    const startedAt = this.now();
    const summaryPath = join(workspacePath, SUMMARY_FILE);
    const child = this.spawnProcess(this.k6Binary, k6Arguments(job, run.script, summaryPath), {
      cwd: dirname(run.script),
      env: this.childEnvironment(run.target, redactions),
      detached: process.platform !== 'win32',
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    });
    const stdout = new CappedLog(this.options.logMaxBytes);
    const stderr = new CappedLog(this.options.logMaxBytes);
    child.stdout.on('data', (chunk: Buffer | string) => stdout.append(chunk));
    child.stderr.on('data', (chunk: Buffer | string) => stderr.append(chunk));
    const exit = await this.superviseChild(child, context);

    const stdoutText = this.redact(stdout.text, redactions);
    const stderrText = this.redact(stderr.text, redactions);
    await Promise.all([
      writeFile(join(workspacePath, 'stdout.log'), stdoutText),
      writeFile(join(workspacePath, 'stderr.log'), stderrText),
    ]);

    const verdict = await this.readVerdict(summaryPath, context, startedAt);
    const deliveryError = await this.deliver(verdict.result, run.job.script, context);
    const artifacts = await this.collectArtifacts(workspacePath);
    const status = loadStatus({
      exit,
      aborted: context.signal.aborted,
      deliveryError,
      verdict: verdict.result?.status,
    });
    const message = this.failureMessage(status, exit, verdict, deliveryError);
    return {
      status,
      resultPath: artifacts.find((artifact) => artifact.kind === 'k6-json')?.path ?? '',
      workspacePath,
      artifacts,
      stdout: stdoutText,
      stderr: stderrText,
      error:
        message === undefined
          ? undefined
          : {
              code: status === 'infra_failed' ? 'RUNNER_INFRA_FAILED' : 'EXECUTION_ERROR',
              message: this.redact(sanitizeError(message, redactions), redactions),
            },
    };
  }

  /** The allowlist of names, never the runner's whole environment, plus the target. */
  private childEnvironment(target: string, redactions: readonly string[]): NodeJS.ProcessEnv {
    const allowed = new Set([
      ...BASE_ENV_ALLOWLIST,
      ...(process.platform === 'win32' ? WINDOWS_ENV_ALLOWLIST : []),
    ]);
    const base = sanitizeEnvironment(this.environment, redactions);
    const env: NodeJS.ProcessEnv = {};
    for (const key of allowed) {
      const value = base[key];
      if (value !== undefined) env[key] = value;
    }
    return {
      ...env,
      TARGET_URL: withoutTrailingSlash(target),
      K6_NO_USAGE_REPORT: 'true',
      K6_NO_COLOR: 'true',
    };
  }

  /** Wait for the child to close, stopping its whole process tree at the deadline or on abort. */
  private async superviseChild(
    child: ChildProcessWithoutNullStreams,
    context: ExecutionContext,
  ): Promise<ChildExit> {
    let timedOut = false;
    let spawnError: Error | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.terminateProcess(child);
    }, context.deadlineMs);
    const abort = (): void => {
      void this.terminateProcess(child);
    };
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) abort();
    try {
      const code = await new Promise<number | null>((settle) => {
        child.once('error', (error) => {
          spawnError = error;
          // A child that never started emits no 'close'.
          if (child.pid === undefined) settle(null);
        });
        child.once('close', (exitCode: number | null) => settle(exitCode));
      });
      return { code, timedOut, spawnError };
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', abort);
    }
  }

  /** k6's summary, read by the reporter's adapter and nothing else. */
  private async readVerdict(
    summaryPath: string,
    context: ExecutionContext,
    startedAt: Date,
  ): Promise<Verdict> {
    // One handle for the size and the read, so a summary that grows after the check is
    // still bounded (CodeQL js/file-system-race).
    const handle = await open(summaryPath, 'r').catch(() => undefined);
    if (handle === undefined) return { result: null, problem: 'k6 wrote no summary' };
    let bytes: Buffer;
    try {
      const limit = this.options.artifactMaxBytes;
      const size = (await handle.stat()).size;
      if (size > limit) {
        throw new RunnerInfrastructureError(`Artifact exceeds configured limit: ${SUMMARY_FILE}`);
      }
      // One byte past the observed size, so growth after the stat is seen.
      const buffer = Buffer.alloc(size + 1);
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      if (read > size) {
        throw new RunnerInfrastructureError(`Artifact changed while it was read: ${SUMMARY_FILE}`);
      }
      bytes = buffer.subarray(0, read);
    } finally {
      await handle.close();
    }
    try {
      return {
        problem: undefined,
        result: parseK6Summary(bytes, {
          // The identity fields belong to the API's run, which the runner does not know; only
          // the attempts are used, and the API derives the canonical result from the events.
          workspaceId: 'runner',
          runId: context.jobId,
          sourceUri: SUMMARY_FILE,
          sourceDigest: createHash('sha256').update(bytes).digest('hex'),
          producerVersion: 'k6',
          adapterVersion: K6_JSON_ADAPTER_VERSION,
          startedAt: startedAt.toISOString(),
          finishedAt: this.now().toISOString(),
        }),
      };
    } catch (error) {
      return { result: null, problem: `k6 summary could not be read: ${sanitizeError(error, [])}` };
    }
  }

  /** Emit each attempt as `test.started` / `test.completed`. Returns the first failure. */
  private async deliver(
    result: CanonicalRunResult | null,
    script: string,
    context: ExecutionContext,
  ): Promise<unknown> {
    if (result === null || context.onEvent === undefined) return undefined;
    try {
      let sequence = 0;
      for (const attempt of result.attempts) {
        for (const event of attemptEvents(attempt, script, this.now(), () => (sequence += 1))) {
          await context.onEvent(event);
        }
      }
      return undefined;
    } catch (error) {
      return error;
    }
  }

  private failureMessage(
    status: ExecutionStatus,
    exit: ChildExit,
    verdict: Verdict,
    deliveryError: unknown,
  ): string | undefined {
    if (deliveryError !== undefined && deliveryError !== null) {
      return sanitizeError(deliveryError, []);
    }
    if (exit.spawnError !== undefined) return exit.spawnError.message;
    if (status !== 'infra_failed') return undefined;
    if (exit.code !== 0 && exit.code !== K6_THRESHOLDS_CROSSED_EXIT) {
      return `k6 exited with ${String(exit.code)}`;
    }
    return verdict.problem ?? 'k6 summary asserted nothing: it declared no metric or threshold';
  }

  private async collectArtifacts(workspacePath: string): Promise<ExecutionArtifact[]> {
    const artifacts: ExecutionArtifact[] = [];
    for (const path of await collectFiles(workspacePath)) {
      const bytes = await readFile(path);
      if (bytes.byteLength > this.options.artifactMaxBytes) {
        throw new RunnerInfrastructureError(
          `Artifact exceeds configured limit: ${relative(workspacePath, path)}`,
        );
      }
      artifacts.push({
        path,
        digest: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
        kind: artifactKind(path),
        name: relative(workspacePath, path).replaceAll('\\', '/'),
        contentType: contentType(path),
      });
    }
    return artifacts;
  }

  private redact(value: string, additional: readonly string[]): string {
    let result = value;
    for (const secret of new Set([...this.redactions, ...additional])) {
      if (secret) result = result.replaceAll(secret, '[REDACTED]');
    }
    return result;
  }
}

/**
 * The argv, built here and nowhere else. `--vus` and `--duration` override the script's own
 * `options`, which is what makes the contract ceilings binding; `--quiet` and
 * `--no-usage-report` keep the logs to evidence and the run off the network.
 */
export function k6Arguments(
  job: LoadJobConfiguration,
  scriptPath: string,
  summaryPath: string,
): string[] {
  return [
    'run',
    '--quiet',
    '--no-color',
    '--no-usage-report',
    '--vus',
    String(job.vus),
    '--duration',
    `${job.durationSeconds}s`,
    '--summary-trend-stats',
    TREND_STATS,
    '--summary-export',
    summaryPath,
    scriptPath,
  ];
}

/**
 * `TARGET_URL` as scripts consume it: without a trailing slash. `URL#toString` turns
 * `http://host` into `http://host/`, and a script building `${TARGET_URL}/health` then
 * requested `http://host//health` - a different resource on a real server. (Found by running
 * the production image: a path-sensitive endpoint was never reached, so a threshold on it
 * could not be breached.)
 */
function withoutTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
}
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80) || 'job';
}

/**
 * How the run ended, most specific first: an event the API never received outranks everything,
 * then the deadline, then an abort, then a child that never started. After that the exit code
 * and the reporter's reading must agree on a verdict: `0` / `99` are k6's own answers, so any
 * other code is k6 failing, and a missing or empty summary is a run that asserted nothing.
 * A threshold exit (`99`) is a failure even if the summary somehow reads clean, and a failed
 * reading is a failure even on a clean exit (a `check` that failed with no threshold on it).
 */
export function loadStatus(outcome: {
  exit: ChildExit;
  aborted: boolean;
  deliveryError: unknown;
  verdict: CanonicalRunResult['status'] | undefined;
}): ExecutionStatus {
  if (outcome.deliveryError !== undefined && outcome.deliveryError !== null) return 'infra_failed';
  if (outcome.exit.timedOut) return 'timed_out';
  if (outcome.aborted) return 'cancelled';
  if (outcome.exit.spawnError !== undefined) return 'infra_failed';
  const code = outcome.exit.code;
  if (code !== 0 && code !== K6_THRESHOLDS_CROSSED_EXIT) return 'infra_failed';
  if (outcome.verdict === undefined) return 'infra_failed';
  if (code === K6_THRESHOLDS_CROSSED_EXIT || outcome.verdict === 'failed') return 'failed';
  return outcome.verdict === 'passed' ? 'passed' : 'infra_failed';
}

/** One attempt as the two events the runner service turns into `test.*` run events. */
function attemptEvents(
  attempt: CanonicalRunResult['attempts'][number],
  script: string,
  at: Date,
  nextSequence: () => number,
): ExecutionEventLine[] {
  const base = {
    testId: attempt.testId,
    attempt: attempt.index,
    title: attempt.title,
    suite: 'k6',
    file: script,
  };
  const failed = attempt.status === 'failed';
  const message = attempt.error?.message;
  return [
    {
      eventId: randomUUID(),
      sequence: nextSequence(),
      type: 'test.started',
      occurredAt: at.toISOString(),
      payload: base,
    },
    {
      eventId: randomUUID(),
      sequence: nextSequence(),
      type: 'test.completed',
      occurredAt: at.toISOString(),
      payload: {
        ...base,
        status: attempt.status,
        durationMs: 0,
        ...(failed
          ? {
              errorCode: attempt.testId.startsWith('threshold:')
                ? 'K6_THRESHOLD_CROSSED'
                : 'K6_CHECK_FAILED',
              errors: [{ message: message ?? 'k6 reported a failure' }],
            }
          : {}),
      },
    },
  ];
}
