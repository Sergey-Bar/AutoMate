import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunnerConfigurationError, RunnerInfrastructureError } from './execution.js';
import {
  CHECKOUT_DIRECTORY,
  GitCheckout,
  cloneArguments,
  gitEnvironment,
  type GitResult,
} from './git-checkout.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'checkout-'));
  roots.push(path);
  return path;
}

interface Call {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}

function fakeGit(result: GitResult, calls: Call[], createDestination = true) {
  return async (args: readonly string[], env: NodeJS.ProcessEnv): Promise<GitResult> => {
    calls.push({ args, env });
    const destination = args.at(-1) as string;
    if (createDestination) {
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, 'README.md'), 'cloned');
    }
    return result;
  };
}

const request = (url: string, token: string | null = null) => ({
  url,
  token,
  jobId: 'job-1',
  deadlineMs: 60_000,
  signal: new AbortController().signal,
});

describe('cloneArguments', () => {
  it('disables hooks, dangerous transports, submodules, symlinks and tags, and ends options before the URL', () => {
    const args = cloneArguments('https://github.com/a/b.git', '/dest', '/empty-hooks', 'main');
    expect(args).toEqual(
      expect.arrayContaining([
        'core.hooksPath=/empty-hooks',
        'protocol.file.allow=never',
        'protocol.ext.allow=never',
        'submodule.recurse=false',
        'core.symlinks=false',
        '--no-recurse-submodules',
        '--depth',
        '--no-tags',
      ]),
    );
    expect(args.slice(-3)).toEqual(['--', 'https://github.com/a/b.git', '/dest']);
    expect(args).toContain('main');
  });
});

describe('gitEnvironment', () => {
  it('reads no host config, never prompts, skips LFS, and passes the token only as a header', () => {
    const env = gitEnvironment('/scratch', 'tok-123', 'https://github.com/a/b.git', {
      PATH: '/bin',
      GH_TOKEN: 'leak',
      HOME: '/home/op',
    });
    expect(env).toMatchObject({
      PATH: '/bin',
      HOME: '/scratch',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_LFS_SKIP_SMUDGE: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
    });
    expect(env['GH_TOKEN']).toBeUndefined();
    expect(env['GIT_CONFIG_VALUE_0']).toBe(
      `Authorization: Basic ${Buffer.from('x-access-token:tok-123').toString('base64')}`,
    );
    expect(gitEnvironment('/s', null, 'https://x/y', {})['GIT_CONFIG_COUNT']).toBeUndefined();
    // An ssh URL gets no HTTP header; ssh credentials are the host's deploy key.
    expect(gitEnvironment('/s', 'tok', 'ssh://git@host/x', {})['GIT_CONFIG_COUNT']).toBeUndefined();
  });
});

describe('GitCheckout', () => {
  it('clones under the checkout directory, keeps the token out of argv, and removes its scratch home', async () => {
    const repoRoot = await root();
    const calls: Call[] = [];
    const checkout = new GitCheckout({
      repoRoot,
      runGit: fakeGit({ exitCode: 0, stderr: '' }, calls),
      environment: { PATH: '/bin' },
    });
    const path = await checkout.clone(request('https://github.com/a/b.git', 'tok-123'));
    expect(path).toBe(join(repoRoot, CHECKOUT_DIRECTORY, 'job-1'));
    expect(existsSync(join(path, 'README.md'))).toBe(true);
    expect(calls[0]?.args.join(' ')).not.toContain('tok-123');
    expect(existsSync(calls[0]?.env['HOME'] as string)).toBe(false);
    await checkout.remove(path);
    expect(existsSync(path)).toBe(false);
  });

  it.each([
    'file:///etc',
    '/srv/repos/other',
    'ext::sh -c touch% /tmp/pwned',
    '--upload-pack=touch /tmp/pwned',
    'https://user:pass@github.com/a/b.git',
    'https://token@github.com/a/b.git',
    'http://github.com/a/b.git',
    'https://github.com/a/b.git\nfoo',
  ])('refuses %s before git runs', async (url) => {
    const calls: Call[] = [];
    const checkout = new GitCheckout({
      repoRoot: await root(),
      runGit: fakeGit({ exitCode: 0, stderr: '' }, calls),
    });
    await expect(checkout.clone(request(url))).rejects.toBeInstanceOf(RunnerConfigurationError);
    expect(calls).toEqual([]);
  });

  it('accepts ssh and scp-style URLs', async () => {
    const calls: Call[] = [];
    const checkout = new GitCheckout({
      repoRoot: await root(),
      runGit: fakeGit({ exitCode: 0, stderr: '' }, calls),
    });
    await checkout.clone(request('git@github.com:a/b.git'));
    await checkout.clone({ ...request('ssh://git@github.com/a/b.git'), jobId: 'job-2' });
    expect(calls).toHaveLength(2);
  });

  it('refuses a branch that is an option or not a plain ref', async () => {
    const checkout = new GitCheckout({
      repoRoot: await root(),
      runGit: fakeGit({ exitCode: 0, stderr: '' }, []),
    });
    await expect(
      checkout.clone({ ...request('https://github.com/a/b.git'), branch: '--upload-pack=x' }),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    await expect(
      checkout.clone({ ...request('https://github.com/a/b.git'), branch: 'a b' }),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
  });

  it('reports a failed clone without the token, and leaves nothing behind', async () => {
    const repoRoot = await root();
    const checkout = new GitCheckout({
      repoRoot,
      runGit: fakeGit({ exitCode: 128, stderr: 'fatal: Authentication failed for tok-123' }, []),
    });
    const failure = checkout.clone(request('https://github.com/a/b.git', 'tok-123'));
    await expect(failure).rejects.toBeInstanceOf(RunnerInfrastructureError);
    await expect(failure).rejects.toThrow(/\[REDACTED\]/u);
    await expect(failure).rejects.not.toThrow(/tok-123/u);
    expect(existsSync(join(repoRoot, CHECKOUT_DIRECTORY, 'job-1'))).toBe(false);
  });

  it('removes only directories it created', async () => {
    const repoRoot = await root();
    const outside = join(repoRoot, 'keep');
    await mkdir(outside);
    await new GitCheckout({ repoRoot }).remove(outside);
    expect(existsSync(outside)).toBe(true);
  });
});
