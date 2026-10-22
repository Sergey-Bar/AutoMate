import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { ExecutionEventLineSchema } from '@automate/shared-contracts';
import { artifactKind } from './artifact-kind.js';

const require = createRequire(import.meta.url);
/**
 * The line a runner writes and the API reads.
 *
 * This was a third declaration of `ReporterEventSchema` — and was neither the
 * contract's reporter event nor the realtime package's broadcast event. It was,
 * field for field, the execution event: `{eventId, sequence, type, occurredAt,
 * payload}`. The schema now lives in `@automate/shared-contracts` as
 * `ExecutionEventLineSchema`, which both sides already depend on, so the name
 * says what the thing is and there is one validator rather than three. There is
 * deliberately no local alias: an alias named `ReporterEventSchema` would read as
 * a fourth declaration to the next person grepping for one.
 */
const eventLineSchema = ExecutionEventLineSchema;

export type ExecutionStatus =
  'succeeded' | 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'config_failed' | 'infra_failed';

export interface ExecutionContext {
  jobId: string;
  imageDigest?: string;
  inputDirectory?: string;
  outputDirectory?: string;
  targetUrl?: string;
  project?: string;
  /**
   * The declared argv, when the job is a generic run.
   *
   * Declared on the shared context rather than on `GenericSpawnAdapter` alone so
   * `RoutingExecutionAdapter` can read one shape and dispatch on it. Playwright
   * ignores it; `GenericSpawnAdapter` requires it. Its type is deliberately
   * `unknown` here — `execution.ts` is the module `generic-spawn.ts` imports, and
   * naming `GenericCommand` would make that import a cycle.
   */
  command?: unknown;
  /** The Playwright project, when the job is a browser run. */
  playwrightProject?: string;
  deadlineMs: number;
  signal: AbortSignal;
  onEvent?: (event: z.infer<typeof eventLineSchema>) => Promise<void>;
  redactions?: string[];
}

export interface ExecutionArtifact {
  path: string;
  digest: string;
  bytes: number;
  kind: string;
  name: string;
  contentType: string;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  resultPath: string;
  workspacePath: string;
  artifacts: ExecutionArtifact[];
  stdout: string;
  stderr: string;
  error?: { code: string; message: string };
}

export interface ExecutionProvider {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
  cleanup?(workspacePath: string): Promise<void>;
}

export class RunnerConfigurationError extends Error {
  readonly code = 'CONFIG_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'RunnerConfigurationError';
  }
}

export class RunnerInfrastructureError extends Error {
  readonly code = 'INFRA_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'RunnerInfrastructureError';
  }
}

export type ProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface PlaywrightExecutionOptions {
  projectRoot: string;
  allowedProjects: readonly string[];
  allowedTargetUrls: readonly string[];
  workspaceRoot: string;
  artifactMaxBytes: number;
  logMaxBytes: number;
  redactions?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: ProcessSpawner;
  terminateProcess?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  playwrightCliPath?: string;
  reporterPath?: string;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], { ...options, shell: false, stdio: 'pipe' });
}

function contentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.json') return 'application/json';
  if (extension === '.xml') return 'application/xml';
  if (extension === '.html') return 'text/html';
  if (extension === '.ndjson' || extension === '.log') return 'application/x-ndjson';
  if (extension === '.png') return 'image/png';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.zip') return 'application/zip';
  if (extension === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

function sanitizeError(value: unknown, redactions: readonly string[]): string {
  let message = value instanceof Error ? value.message : String(value);
  for (const secret of redactions) {
    if (secret) message = message.replaceAll(secret, '[REDACTED]');
  }
  return message;
}

function sanitizeEnvironment(
  environment: NodeJS.ProcessEnv,
  redactions: readonly string[],
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    if (/token|secret|password|credential|api[_-]?key/iu.test(key)) continue;
    if (value && redactions.some((secret) => secret && value.includes(secret))) continue;
    result[key] = value;
  }
  return result;
}

function assertInside(root: string, candidate: string): void {
  const path = relative(resolve(root), resolve(candidate));
  if (!path || path.startsWith('..') || isAbsolute(path)) {
    throw new RunnerConfigurationError('Path is outside the configured runner workspace');
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  await visit(root);
  return result.sort();
}

/** How long a process group is given to honour SIGTERM before it is killed outright. */
export const TERMINATE_GRACE_MS = 2_000;

/**
 * Stops a spawned command **and everything it started**, and does not take no for an
 * answer.
 *
 * Both adapters spawn the command as a process-group leader (`detached` on POSIX), so a
 * signal to the leader alone leaves its children running — and a child that inherited
 * the stdout pipe keeps `'close'` from ever firing, so the job never returns and its slot
 * is never freed. The group is signalled instead, and after {@link TERMINATE_GRACE_MS}
 * it is sent SIGKILL whether or not the leader has gone, because a grandchild that
 * ignores SIGTERM outlives a leader that does not. On Windows `taskkill /t /f` already
 * ends the whole tree forcibly.
 */
export async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
  graceMs: number = TERMINATE_GRACE_MS,
): Promise<void> {
  if (child.pid === undefined) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolveTermination) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        child.kill();
        resolveTermination();
      });
      killer.once('close', () => resolveTermination());
    });
    return;
  }
  signalGroup(pid, child, 'SIGTERM');
  // `'close'` fires once the leader has exited *and* every holder of its pipes has
  // gone, which is exactly "the group honoured SIGTERM". Without it, the group is
  // killed — and only then, so a group id the kernel may already have reused is not
  // signalled for nothing.
  const closed = await new Promise<boolean>((settle) => {
    const timer = setTimeout(() => settle(false), graceMs);
    timer.unref();
    child.once('close', () => {
      clearTimeout(timer);
      settle(true);
    });
  });
  if (!closed) signalGroup(pid, child, 'SIGKILL');
}

function signalGroup(
  pid: number,
  child: ChildProcessWithoutNullStreams,
  signal: 'SIGTERM' | 'SIGKILL',
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is already gone. Anything else: fall back to the leader.
    if (child.exitCode === null) child.kill(signal);
  }
}

export class PlaywrightExecutionAdapter implements ExecutionProvider {
  private readonly projectRoot: string;
  private readonly workspaceRoot: string;
  private readonly allowedProjects: ReadonlySet<string>;
  private readonly allowedTargets: ReadonlySet<string>;
  private readonly spawnProcess: ProcessSpawner;
  private readonly terminateProcess: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  private readonly playwrightCliPath: string;
  private readonly reporterPath: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly redactions: readonly string[];

  constructor(private readonly options: PlaywrightExecutionOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.allowedProjects = new Set(options.allowedProjects);
    this.allowedTargets = new Set(options.allowedTargetUrls.map((value) => new URL(value).origin));
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.terminateProcess = options.terminateProcess ?? terminateProcessTree;
    this.playwrightCliPath = options.playwrightCliPath ?? require.resolve('@playwright/test/cli');
    const modulePath = fileURLToPath(import.meta.url);
    const compiledReporter = resolve(dirname(modulePath), 'playwright-reporter.js');
    this.reporterPath = resolve(
      options.reporterPath ??
        (existsSync(compiledReporter)
          ? compiledReporter
          : resolve(dirname(modulePath), 'playwright-reporter.ts')),
    );
    this.environment = options.environment ?? process.env;
    this.redactions = [...new Set(options.redactions ?? [])];
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const redactions = [...new Set([...this.redactions, ...(context.redactions ?? [])])];
    let workspacePath: string | undefined;
    try {
      const request = this.validateRequest(context);

      await mkdir(this.workspaceRoot, { recursive: true });
      workspacePath = await mkdtemp(
        join(this.workspaceRoot, `${this.safeSegment(context.jobId)}-`),
      );
      const layout = workspaceLayout(workspacePath);
      await Promise.all([
        mkdir(layout.outputDirectory, { recursive: true }),
        mkdir(layout.reportDirectory, { recursive: true }),
        writeFile(layout.eventPath, ''),
      ]);

      const child = this.spawnProcess(
        process.execPath,
        this.playwrightArguments(request, layout),
        this.spawnOptions(request.target, layout, redactions),
      );
      const pump = createEventPump(layout.eventPath, context.onEvent);
      const stdout = new CappedLog(this.options.logMaxBytes);
      const stderr = new CappedLog(this.options.logMaxBytes);
      child.stdout.on('data', (chunk: Buffer | string) => stdout.append(chunk));
      child.stderr.on('data', (chunk: Buffer | string) => stderr.append(chunk));

      const exit = await this.superviseChild(child, context);
      const deliveryError = await pump.finish();

      const stdoutText = this.redact(stdout.text, redactions);
      const stderrText = this.redact(stderr.text, redactions);
      await Promise.all([
        writeFile(join(workspacePath, 'stdout.log'), stdoutText),
        writeFile(join(workspacePath, 'stderr.log'), stderrText),
      ]);
      const artifacts = await this.collectArtifacts(workspacePath);
      const status = executionStatus({
        deliveryError,
        timedOut: exit.timedOut,
        aborted: context.signal.aborted,
        spawnError: exit.spawnError,
        code: exit.code,
      });
      const errorMessage =
        deliveryError ??
        exit.spawnError ??
        (status === 'infra_failed'
          ? `Playwright exited with ${String(exit.code ?? exit.signal)}`
          : undefined);
      return {
        status,
        resultPath: artifacts.find((artifact) => artifact.kind === 'playwright-json')?.path ?? '',
        workspacePath,
        artifacts,
        stdout: stdoutText,
        stderr: stderrText,
        error: errorMessage
          ? {
              code: status === 'infra_failed' ? 'RUNNER_INFRA_FAILED' : 'EXECUTION_ERROR',
              message: this.redact(sanitizeError(errorMessage, redactions), redactions),
            }
          : undefined,
      };
    } catch (error) {
      if (workspacePath) await this.cleanup(workspacePath);
      if (error instanceof RunnerConfigurationError || error instanceof RunnerInfrastructureError)
        throw error;
      throw new RunnerInfrastructureError(
        this.redact(sanitizeError(error, redactions), redactions),
      );
    }
  }

  /** Everything that must hold before a workspace is created, in the order it is checked. */
  private validateRequest(context: ExecutionContext): {
    project: string;
    target: string;
    configPath: string;
  } {
    const project = context.project ?? 'smoke-pass';
    const target = this.validateTarget(
      context.targetUrl ?? this.options.allowedTargetUrls[0] ?? '',
    );
    if (!this.allowedProjects.has(project)) {
      throw new RunnerConfigurationError(`Playwright project is not allowlisted: ${project}`);
    }
    if (!Number.isInteger(context.deadlineMs) || context.deadlineMs < 1) {
      throw new RunnerConfigurationError('Execution timeout must be a positive integer');
    }
    const configPath = resolve(this.projectRoot, 'playwright.config.ts');
    if (!existsSync(configPath) || !existsSync(this.reporterPath)) {
      throw new RunnerConfigurationError('Playwright project or reporter is not installed');
    }
    if (this.reporterPath.includes(',')) {
      throw new RunnerConfigurationError('Reporter path cannot contain a comma');
    }
    return { project, target, configPath };
  }

  private playwrightArguments(
    request: { project: string; configPath: string },
    layout: WorkspaceLayout,
  ): string[] {
    return [
      this.playwrightCliPath,
      'test',
      '--config',
      request.configPath,
      '--project',
      request.project,
      '--output',
      layout.outputDirectory,
      '--reporter',
      `list,${this.reporterPath},json,junit`,
    ];
  }

  private spawnOptions(
    target: string,
    layout: WorkspaceLayout,
    redactions: readonly string[],
  ): Parameters<ProcessSpawner>[2] {
    return {
      cwd: this.projectRoot,
      env: {
        ...sanitizeEnvironment(this.environment, redactions),
        AUTOMATE_BASE_URL: target,
        AUTOMATE_OUTPUT_DIR: layout.outputDirectory,
        AUTOMATE_RUNNER_EVENTS_PATH: layout.eventPath,
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(layout.reportDirectory, 'playwright-report.json'),
        PLAYWRIGHT_JUNIT_OUTPUT_NAME: join(layout.reportDirectory, 'junit.xml'),
        CI: '1',
        FORCE_COLOR: '0',
      },
      detached: process.platform !== 'win32',
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    };
  }

  /** Wait for the child to close, killing it at the deadline or on abort. */
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

    const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveClose) => {
        child.once('error', (error) => {
          spawnError = error;
        });
        child.once('close', (code, signal) => resolveClose({ code, signal }));
      },
    );
    clearTimeout(timer);
    context.signal.removeEventListener('abort', abort);
    return { ...closed, timedOut, spawnError };
  }

  async cleanup(workspacePath: string): Promise<void> {
    assertInside(this.workspaceRoot, workspacePath);
    await rm(workspacePath, { recursive: true, force: true });
  }

  private validateTarget(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RunnerConfigurationError('Execution target URL is invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new RunnerConfigurationError('Execution target URL is not allowed');
    }
    if (!this.allowedTargets.has(url.origin)) {
      throw new RunnerConfigurationError(
        `Execution target origin is not allowlisted: ${url.origin}`,
      );
    }
    return url.toString();
  }

  private async collectArtifacts(workspacePath: string): Promise<ExecutionArtifact[]> {
    const files = await collectFiles(workspacePath);
    const artifacts: ExecutionArtifact[] = [];
    for (const path of files) {
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

  private safeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80) || 'job';
  }

  private redact(value: string, additional: readonly string[] = []): string {
    let result = value;
    for (const secret of new Set([...this.redactions, ...additional])) {
      if (secret) result = result.replaceAll(secret, '[REDACTED]');
    }
    return result;
  }
}

interface WorkspaceLayout {
  outputDirectory: string;
  reportDirectory: string;
  eventPath: string;
}

function workspaceLayout(workspacePath: string): WorkspaceLayout {
  return {
    outputDirectory: join(workspacePath, 'test-results'),
    reportDirectory: join(workspacePath, 'reports'),
    eventPath: join(workspacePath, 'events.ndjson'),
  };
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnError: Error | undefined;
}

/** A log that keeps the first `maxBytes` bytes of what it is given and drops the rest. */
class CappedLog {
  text = '';
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    if (this.bytes >= this.maxBytes) return;
    const accepted = chunk.toString().slice(0, this.maxBytes - this.bytes);
    this.text += accepted;
    this.bytes += Buffer.byteLength(accepted);
  }
}

/**
 * Delivers the reporter's NDJSON events to `onEvent` in order as the file grows.
 *
 * Deliveries are chained, so a slow `onEvent` never overlaps itself, and the first failure is
 * kept and reported by `finish` rather than thrown into a file-watcher callback.
 */
function createEventPump(
  eventPath: string,
  onEvent: ExecutionContext['onEvent'],
): { finish: () => Promise<unknown> } {
  let offset = 0;
  let eventBuffer = '';
  let deliveryError: unknown;
  let deliveryChain = Promise.resolve();
  const flushEvents = async (): Promise<void> => {
    const data = await readFile(eventPath, 'utf8');
    if (data.length <= offset && !eventBuffer) return;
    const chunk = eventBuffer + data.slice(offset);
    offset = data.length;
    const parts = chunk.split(/\r?\n/u);
    eventBuffer = data.endsWith('\n') ? '' : (parts.pop() ?? '');
    for (const line of parts.filter(Boolean)) {
      const event = eventLineSchema.parse(JSON.parse(line) as unknown);
      if (onEvent) await onEvent(event);
    }
  };
  const queueFlush = (): void => {
    deliveryChain = deliveryChain.then(flushEvents).catch((error: unknown) => {
      deliveryError ??= error;
    });
  };
  const watcher = watch(eventPath, { encoding: 'utf8' }, queueFlush);
  return {
    finish: async () => {
      watcher.close();
      queueFlush();
      await deliveryChain;
      await flushEvents().catch((error: unknown) => {
        deliveryError ??= error;
      });
      return deliveryError;
    },
  };
}

/**
 * How the run ended. A delivery failure outranks everything because results the API never saw
 * cannot be called a pass; then the deadline, then an abort, then a child that never started.
 * Exit code 0 is a pass, 1 is the tests failing, and anything else is the runner's own failure.
 */
function executionStatus(outcome: {
  deliveryError: unknown;
  timedOut: boolean;
  aborted: boolean;
  spawnError: Error | undefined;
  code: number | null;
}): ExecutionStatus {
  if (outcome.deliveryError) return 'infra_failed';
  if (outcome.timedOut) return 'timed_out';
  if (outcome.aborted) return 'cancelled';
  if (outcome.spawnError) return 'infra_failed';
  if (outcome.code === 0) return 'passed';
  return outcome.code === 1 ? 'failed' : 'infra_failed';
}
