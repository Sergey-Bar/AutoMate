import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GitRepositoryUrlSchema } from '@automate/shared-contracts';
import { RunnerConfigurationError, RunnerInfrastructureError } from './execution.js';

/**
 * Clones an untrusted repository for a scan, and nothing more.
 *
 * ## What a clone of an untrusted repository must not do
 *
 * - **Run a hook.** `core.hooksPath` points at an empty directory this module created, so a
 *   `post-checkout` in the repository (or in a template) has nothing to run.
 * - **Follow a submodule.** `--no-recurse-submodules` and `submodule.recurse=false`: a
 *   submodule URL is a second, unvalidated URL.
 * - **Use a dangerous transport.** The URL is validated by the same schema the API used at
 *   registration, and `protocol.file.allow` / `protocol.ext.allow` are `never` so a redirect
 *   cannot reach one either.
 * - **Fetch LFS content or read the operator's git config.** `GIT_LFS_SKIP_SMUDGE`, and
 *   `GIT_CONFIG_NOSYSTEM` with `HOME` and `GIT_CONFIG_GLOBAL` pointing at the scratch
 *   directory, so a credential helper or `url.insteadOf` on the host is not consulted.
 * - **Ask for a password.** `GIT_TERMINAL_PROMPT=0`.
 *
 * ## The token never reaches argv or disk
 *
 * An HTTPS token goes to git as an `http.extraHeader` through `GIT_CONFIG_COUNT` environment
 * variables: an argv is visible to every process on the host in `ps`, and a credential file
 * would outlive the clone. It is also added to the runner's redactions for the job.
 */
export interface CheckoutRequest {
  url: string;
  token: string | null;
  jobId: string;
  branch?: string | undefined;
  deadlineMs: number;
  signal: AbortSignal;
}

export interface CheckoutOptions {
  /** Clones land under `<repoRoot>/.automate-checkouts`, inside the generic adapter's boundary. */
  repoRoot: string;
  /** Injected for tests; the real one spawns `git` with `shell: false`. */
  runGit?: (
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    deadlineMs: number,
    signal: AbortSignal,
  ) => Promise<GitResult>;
  environment?: NodeJS.ProcessEnv;
}

export interface GitResult {
  exitCode: number | null;
  stderr: string;
}

export const CHECKOUT_DIRECTORY = '.automate-checkouts';

const SAFE_REF = /^[A-Za-z0-9._/-]{1,255}$/u;

/** The argv for one clone, exported so a test can read the safety flags off it. */
export function cloneArguments(
  url: string,
  destination: string,
  hooks: string,
  branch?: string,
): string[] {
  return [
    '-c',
    `core.hooksPath=${hooks}`,
    '-c',
    'protocol.file.allow=never',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'submodule.recurse=false',
    '-c',
    'core.symlinks=false',
    '-c',
    'core.fsmonitor=false',
    'clone',
    '--depth',
    '1',
    '--single-branch',
    '--no-recurse-submodules',
    '--no-tags',
    ...(branch === undefined ? [] : ['--branch', branch]),
    '--',
    url,
    destination,
  ];
}

/** The child's environment: no host config, no prompt, no LFS, the token as a header. */
export function gitEnvironment(
  scratch: string,
  token: string | null,
  url: string,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: base['PATH'],
    ...(base['SystemRoot'] === undefined ? {} : { SystemRoot: base['SystemRoot'] }),
    HOME: scratch,
    USERPROFILE: scratch,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
  if (token !== null && url.startsWith('https://')) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    env['GIT_CONFIG_COUNT'] = '1';
    env['GIT_CONFIG_KEY_0'] = 'http.extraHeader';
    env['GIT_CONFIG_VALUE_0'] = `Authorization: Basic ${basic}`;
  }
  return env;
}

function defaultRunGit(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
  signal: AbortSignal,
): Promise<GitResult> {
  return new Promise((settle, fail) => {
    const child = spawn('git', [...args], {
      env,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString('utf8');
    });
    const kill = () => child.kill('SIGKILL');
    const timer = setTimeout(kill, deadlineMs);
    signal.addEventListener('abort', kill, { once: true });
    child.once('error', (error) => {
      clearTimeout(timer);
      fail(new RunnerInfrastructureError(`git could not be started: ${error.message}`));
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', kill);
      settle({ exitCode, stderr });
    });
  });
}

/** git's own error text, with the token cut out wherever it was echoed. */
function redacted(text: string, secret: string | null): string {
  return secret === null ? text : text.split(secret).join('[REDACTED]');
}

export class GitCheckout {
  private readonly root: string;

  constructor(private readonly options: CheckoutOptions) {
    this.root = resolve(options.repoRoot, CHECKOUT_DIRECTORY);
  }

  /** Clones the repository and returns the absolute path of the checkout. */
  async clone(request: CheckoutRequest): Promise<string> {
    const url = GitRepositoryUrlSchema.safeParse(request.url);
    if (!url.success)
      throw new RunnerConfigurationError(
        'Refusing to clone a repository URL that is not https, ssh or git@host',
      );
    if (
      request.branch !== undefined &&
      (!SAFE_REF.test(request.branch) || request.branch.startsWith('-'))
    ) {
      throw new RunnerConfigurationError('Refusing to clone a branch name that is not a plain ref');
    }
    await mkdir(this.root, { recursive: true });
    const scratch = await mkdtemp(join(this.root, '.git-home-'));
    const hooks = join(scratch, 'hooks');
    await mkdir(hooks);
    const destination = join(
      this.root,
      request.jobId.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80) || 'job',
    );
    await rm(destination, { recursive: true, force: true });
    try {
      const runGit = this.options.runGit ?? defaultRunGit;
      const result = await runGit(
        cloneArguments(url.data, destination, hooks, request.branch),
        gitEnvironment(scratch, request.token, url.data, this.options.environment ?? process.env),
        request.deadlineMs,
        request.signal,
      );
      if (result.exitCode !== 0) {
        await rm(destination, { recursive: true, force: true });
        const said = redacted(result.stderr, request.token);
        throw new RunnerInfrastructureError(
          `git clone failed (${String(result.exitCode)}): ${said.trim().slice(0, 500)}`,
        );
      }
      return destination;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  async remove(path: string): Promise<void> {
    const target = resolve(path);
    // Only ever a directory this class created.
    if (!target.startsWith(`${this.root}`) || target === this.root) return;
    await rm(target, { recursive: true, force: true });
  }
}
