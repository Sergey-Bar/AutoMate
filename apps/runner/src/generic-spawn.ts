import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  RunnerConfigurationError,
  RunnerInfrastructureError,
  type ExecutionArtifact,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
  type ExecutionStatus,
  type ProcessSpawner,
} from './execution.js';
import { artifactKind } from './artifact-kind.js';

/**
 * The one recorded spawn. Exported so a test can assert the *shape* of the spawn
 * — `shell: false`, `cwd`, `env` — which is the only place the three
 * security-relevant properties of this adapter are observable.
 */
export interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
}

/** A command to run, in a repository, with the artifacts it is declared to produce. */
export interface GenericCommand {
  /**
   * **argv, already split. There is deliberately no string form.**
   *
   * A terminal in a multi-repo install is an RCE surface for whoever holds it, and
   * a `command: string` field would hand that surface back the moment somebody
   * concatenated anything into it. An argv array cannot be handed to a shell, so
   * the dangerous operation is unavailable rather than discouraged (D7). It also
   * means nothing in this repository has to implement shell quoting, which would
   * be a second parser that drifts from the first.
   */
  argv: readonly string[];
  /** Repo-relative. Resolved against `repoRoot`; `..` is refused. */
  workingDirectory: string;
  /**
   * Repo-relative globs whose matches are evidence.
   *
   * Declared by the caller, never inferred from what the command happened to
   * write — an adapter that discovered artifacts by looking at the workspace
   * would ingest anything the dependency tree dropped there.
   */
  artifactGlobs: readonly string[];
  /**
   * Environment to pass through, **by name**.
   *
   * The runner's default allowlist is `PATH`, `HOME` and `CI`; anything a
   * customer's tests need beyond that is named here. The values live in the
   * install and never in the repository.
   */
  env?: Readonly<Record<string, string>>;
}

export interface GenericSpawnOptions {
  repoRoot: string;
  workspaceRoot: string;
  artifactMaxBytes: number;
  logMaxBytes: number;
  redactions?: readonly string[];
  /** The runner's own environment, which is the *candidate* set, not the child's. */
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: ProcessSpawner;
  terminateProcess?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
}

/**
 * The default pass-through allowlist.
 *
 * An **allowlist, not a denylist.** `apps/runner/src/execution.ts` already has a
 * denylist — anything matching `/token|secret|password|credential|api[_-]?key/`
 * is dropped — and it is the weaker shape: it cannot know the name of the secret
 * the customer keeps in `DATABASE_DSN`, `GH_PAT` or `NPM_CONFIG_USERCONFIG`. The
 * two coexist here on purpose, because the allowlist is the one that holds and
 * the denylist is the one that catches a deliberately-named one.
 */
export const DEFAULT_ENV_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'CI'] as const;

/**
 * Runs a declared argv in a registered repository and collects what it declared.
 *
 * ## Stdout is evidence, not results (D9)
 *
 * The status comes from the **exit code and the presence of a declared
 * artifact** — never from a scan of stdout. A command that prints "12 passed"
 * and writes nothing has asserted nothing, so a clean exit with no artifact is
 * `infra_failed`, not `passed`. The alternative is a second parser: one in each
 * test runner's output format, one per language, all drifting, and none of them
 * the thing the score actually reads.
 */
export class GenericSpawnAdapter implements ExecutionProvider {
  private readonly repoRoot: string;
  private readonly workspaceRoot: string;
  private readonly spawnProcess: ProcessSpawner;
  private readonly terminateProcess: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly redactions: readonly string[];

  constructor(private readonly options: GenericSpawnOptions) {
    this.repoRoot = resolve(options.repoRoot);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.terminateProcess = options.terminateProcess ?? defaultTerminate;
    this.environment = options.environment ?? process.env;
    this.redactions = [...new Set(options.redactions ?? [])];
  }

  async execute(
    context: ExecutionContext & { command?: GenericCommand },
  ): Promise<ExecutionResult> {
    const spec = context.command;
    if (spec === undefined) {
      throw new RunnerConfigurationError('No command was declared for this run');
    }
    if (spec.argv.length === 0 || spec.argv.some((part) => part.length === 0)) {
      throw new RunnerConfigurationError('Command argv must be a non-empty array of strings');
    }
    if (!Number.isInteger(context.deadlineMs) || context.deadlineMs < 1) {
      throw new RunnerConfigurationError('Execution timeout must be a positive integer');
    }
    const cwd = this.resolveInside(this.repoRoot, spec.workingDirectory);

    const workspacePath = await this.prepareWorkspace(context.jobId);
    const redactions = [...new Set([...this.redactions, ...(context.redactions ?? [])])];

    const child = this.spawnProcess(spec.argv[0] as string, spec.argv.slice(1), {
      cwd,
      env: this.childEnvironment(spec, redactions),
      // `shell: false` is repeated rather than inherited so that this file, read
      // alone, states the property. `defaultSpawn` sets it too; the Playwright
      // adapter sets it too; three settings of one flag is the redundancy that
      // makes a later edit to one of them harmless.
      shell: false,
      stdio: 'pipe',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const logs = collectLogs(child, this.options.logMaxBytes);
    const timedOut = await this.awaitChild(child, context);
    const stdout = this.redact(logs.stdout(), redactions);
    const stderr = this.redact(logs.stderr(), redactions);
    await writeFile(join(workspacePath, 'stdout.log'), stdout);
    await writeFile(join(workspacePath, 'stderr.log'), stderr);

    const { declared, logs: logArtifacts } = await this.collectArtifacts(
      cwd,
      spec.artifactGlobs,
      workspacePath,
    );
    const artifacts = [...declared, ...logArtifacts];
    const status = statusFor(timedOut, context.signal.aborted, child.exitCode, declared.length);
    return {
      status,
      resultPath: declared[0]?.path ?? '',
      workspacePath,
      artifacts,
      stdout,
      stderr,
      error:
        status === 'infra_failed'
          ? {
              code: 'RUNNER_INFRA_FAILED',
              message: this.infraMessage(child, declared.length),
            }
          : undefined,
    };
  }

  async cleanup(workspacePath: string): Promise<void> {
    await rmDir(workspacePath);
  }

  /**
   * The child's environment: the allowlist, plus whatever the command declared.
   *
   * ## A declared name beats the denylist, and that is a decision rather than an omission
   *
   * The denylist guards the *implicit* pass-through. It does not guard an
   * explicitly named variable, because a heuristic the operator cannot override is
   * worse than useless here: `automate.config.json`'s `env` list exists for exactly
   * the credentials a suite needs, and most of them are named `*_TOKEN`. Refusing
   * them would leave the field able to carry nothing security-shaped, and the
   * workaround people reach for is putting the value in a committed file.
   *
   * The boundary that actually matters is **who wrote the config** — the
   * repository owner, in a file under the version control they control — and
   * **who chose the command**, which that same file declares. A named variable
   * hands the install's credential to a program the operator already selected and
   * who could already read the runner's working directory.
   *
   * What survives that argument is the redaction check: a value containing a
   * secret the install registered as redactable is refused outright.
   */
  private childEnvironment(spec: GenericCommand, redactions: readonly string[]): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of DEFAULT_ENV_ALLOWLIST) {
      const value = this.environment[key];
      if (value !== undefined) env[key] = value;
    }
    for (const [key, value] of Object.entries(spec.env ?? {})) {
      // An empty value is dropped rather than forwarded. A child that receives
      // `TOKEN=` behaves identically to one that receives no `TOKEN` at all in
      // every shell expansion this repository is likely to meet, so forwarding it
      // turns "unset" into "set to empty" — a failure the child cannot report and
      // the operator cannot see.
      if (value.length === 0) continue;
      if (redactions.some((secret) => secret && value.includes(secret))) continue;
      env[key] = value;
    }
    return env;
  }

  private async prepareWorkspace(jobId: string): Promise<string> {
    await mkdir(this.workspaceRoot, { recursive: true });
    return mkdtemp(
      join(this.workspaceRoot, `${jobId.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80) || 'job'}-`),
    );
  }

  /** Waits for the child, returning whether the *deadline* stopped it. */
  private async awaitChild(
    child: ChildProcessWithoutNullStreams,
    context: ExecutionContext,
  ): Promise<boolean> {
    let timedOut = false;
    let spawnError: Error | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.terminateProcess(child);
    }, context.deadlineMs);
    const abort = (): void => void this.terminateProcess(child);
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) abort();
    try {
      await new Promise<void>((settle) => {
        child.once('error', (error: Error) => {
          spawnError = error;
          settle();
        });
        child.once('close', () => settle());
      });
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', abort);
    }
    if (spawnError !== undefined) {
      throw new RunnerInfrastructureError(`Command could not be started: ${spawnError.message}`);
    }
    return timedOut;
  }

  /**
   * Collects exactly the files the command declared, plus the run's logs.
   *
   * The two are returned **separately**, and the declared count is what decides
   * the status. Returning one list made every run look like it had produced
   * evidence, because the two log files are always there — which is exactly the
   * "clean exit code, nothing written" case D9 exists to catch.
   *
   * The logs are still artifacts: a run that produced no evidence has to leave a
   * record that it produced none, and a human reading the failure needs the text.
   */
  private async collectArtifacts(
    cwd: string,
    globs: readonly string[],
    workspacePath: string,
  ): Promise<{ declared: ExecutionArtifact[]; logs: ExecutionArtifact[] }> {
    const matchers = globs.map((glob) => globToRegExp(glob));
    const declared: ExecutionArtifact[] = [];
    for (const file of await collectFiles(this.repoRoot)) {
      const inside = relative(cwd, file);
      if (inside.startsWith('..') || isAbsolute(inside)) continue;
      const name = inside.split(sep).join('/');
      if (!matchers.some((matcher) => matcher.test(name))) continue;
      declared.push(await this.artifactFor(file, name));
    }
    const logs: ExecutionArtifact[] = [];
    for (const [kind, source] of [
      ['stdout', join(workspacePath, 'stdout.log')],
      ['stderr', join(workspacePath, 'stderr.log')],
    ] as const) {
      const bytes = await readFile(source);
      logs.push({
        path: source,
        digest: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
        kind,
        name: `${kind}.log`,
        contentType: 'text/plain',
      });
    }
    return { declared, logs };
  }

  private async artifactFor(path: string, name: string): Promise<ExecutionArtifact> {
    const bytes = await readFile(path);
    if (bytes.byteLength > this.options.artifactMaxBytes) {
      throw new RunnerInfrastructureError(`Artifact exceeds configured limit: ${name}`);
    }
    return {
      path,
      digest: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      kind: artifactKind(name),
      name,
      contentType: contentType(name),
    };
  }

  private infraMessage(child: ChildProcessWithoutNullStreams, declaredArtifacts: number): string {
    if (declaredArtifacts === 0) {
      return (
        `Command exited with ${String(child.exitCode)} and produced none of its declared artifacts. ` +
        `The run asserted nothing: the score has no row to read. Check that the command writes what ` +
        `the project declares in ` +
        '`automate.config.json`' +
        `, and that the glob matches its path.`
      );
    }
    return `Command exited with ${String(child.exitCode)}`;
  }

  private resolveInside(root: string, candidate: string): string {
    const resolved = resolve(root, candidate);
    const inside = relative(resolve(root), resolved);
    if (inside.startsWith('..') || isAbsolute(inside)) {
      throw new RunnerConfigurationError(
        'Command working directory is outside the registered repository',
      );
    }
    return resolved;
  }

  private redact(value: string, additional: readonly string[]): string {
    let result = value;
    for (const secret of new Set([...this.redactions, ...additional])) {
      if (secret) result = result.replaceAll(secret, '[REDACTED]');
    }
    return result;
  }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], { ...options, shell: false, stdio: 'pipe' });
}

async function defaultTerminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  child.kill('SIGTERM');
}

async function rmDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * Translates one repo-relative glob into a regular expression.
 *
 * Handles `**` (any depth), `*` (one segment) and `?` (one character). The
 * subject is always a repo-relative POSIX path, never an absolute one, so the
 * expression is anchored at both ends and cannot match a prefix of a longer name.
 *
 * Deliberately not `micromatch` or `glob`: three ecosystems already depend on a
 * glob engine, and adding a fourth would be a dependency for a dozen lines whose
 * entire behaviour is "does this name match this shape".
 */
export function globToRegExp(glob: string): RegExp {
  const normalised = glob.replaceAll('\\', '/');
  let pattern = '';
  for (let index = 0; index < normalised.length; index += 1) {
    const character = normalised[index];
    if (character === '*' && normalised[index + 1] === '*') {
      index += 1;
      if (normalised[index + 1] === '/') {
        index += 1;
        pattern += '(?:.*/)?';
      } else {
        pattern += '.*';
      }
      continue;
    }
    if (character === '*') {
      pattern += '[^/]*';
      continue;
    }
    if (character === '?') {
      pattern += '[^/]';
      continue;
    }
    pattern += character?.replace(/[.+^${}()|[\]\\]/gu, '\\$&') ?? '';
  }
  return new RegExp(`^${pattern}$`, 'u');
}

/**
 * Every file under `root`, sorted, skipping dependency and build directories.
 *
 * A sorted list rather than a stream because the artifact set must be
 * **deterministic**: two runs over the same repository produce the same upload
 * order, so a diff between two runs' evidence is a diff between the runs.
 */
async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await visit(path);
        continue;
      }
      if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

/** Directories whose contents are never a declared artifact. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'vendor',
  'coverage',
]);

function statusFor(
  timedOut: boolean,
  aborted: boolean,
  exitCode: number | null | undefined,
  declaredArtifactCount: number,
): ExecutionStatus {
  if (timedOut) return 'timed_out';
  if (aborted) return 'cancelled';
  if (declaredArtifactCount === 0) return 'infra_failed';
  if (exitCode === 0) return 'passed';
  if (exitCode === 1) return 'failed';
  // 126, 127, 137 and friends mean the command did not run or was killed. None of
  // them is a test result, and charging a team's failure rate for a broken
  // environment is the specific lie the plan's §2.2 rule forbids.
  return 'infra_failed';
}

function contentType(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.xml')) return 'application/xml';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.info')) return 'text/plain';
  if (path.endsWith('.out')) return 'text/plain';
  return 'application/octet-stream';
}

/** Bounded stdout/stderr capture. */
function collectLogs(child: ChildProcessWithoutNullStreams, maxBytes: number) {
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    if (stdoutBytes >= maxBytes) return;
    const accepted = text.slice(0, maxBytes - stdoutBytes);
    stdout += accepted;
    stdoutBytes += Buffer.byteLength(accepted);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    if (stderrBytes >= maxBytes) return;
    const accepted = text.slice(0, maxBytes - stderrBytes);
    stderr += accepted;
    stderrBytes += Buffer.byteLength(accepted);
  });
  return { stdout: () => stdout, stderr: () => stderr };
}
