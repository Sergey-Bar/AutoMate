import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOAD_MAX_DURATION_SECONDS, LOAD_MAX_VUS } from '@automate/shared-contracts';
import {
  RunnerConfigurationError,
  RunnerInfrastructureError,
  type ExecutionContext,
} from './execution.js';
import {
  K6ExecutionAdapter,
  K6_THRESHOLDS_CROSSED_EXIT,
  k6Arguments,
  loadStatus,
  type K6ExecutionOptions,
} from './k6-execution.js';

/**
 * The k6 adapter, tested at three levels:
 *
 *  - the **shape of the spawn** and every refusal that must happen before one, against a fake
 *    process (cross-platform, no k6 needed);
 *  - the **verdict**: k6's exit code and `--summary-export` document, in the shapes a real
 *    k6 v2.2.0 wrote, become the run status and the `test.*` events;
 *  - **real k6**, where a k6 binary exists on the host, against a mock server: one passing
 *    script, one that breaches its threshold, and a deadline that has to kill it.
 */

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid: number | undefined = 4242;
}

interface Call {
  command: string;
  args: string[];
  options: SpawnOptions;
}

/** What a fake k6 does once spawned: write a summary, print, and exit with a code. */
interface Behaviour {
  summary?: unknown;
  rawSummary?: string;
  stdout?: string;
  code?: number | null;
  /** Never exit on its own; wait to be terminated. */
  hang?: boolean;
  /** Emit a spawn error instead of running. */
  spawnError?: Error;
}

/** Every threshold uncrossed: what k6 exports for a clean run. */
const CLEAN_SUMMARY = {
  metrics: {
    http_req_duration: { avg: 3, 'p(95)': 4, 'p(99)': 5, thresholds: { 'p(95)<2000': false } },
    http_req_failed: { passes: 0, fails: 20, value: 0, thresholds: { 'rate<0.01': false } },
    checks: { passes: 20, fails: 0, value: 1, thresholds: { 'rate>0.99': false } },
  },
};

const BREACHED_SUMMARY = {
  metrics: {
    http_req_duration: { avg: 43, 'p(95)': 45, 'p(99)': 46, thresholds: { 'p(95)<5': true } },
    http_req_failed: { passes: 0, fails: 20, value: 0, thresholds: { 'rate<0.01': false } },
  },
};

interface Harness {
  adapter: K6ExecutionAdapter;
  calls: Call[];
  terminated: ChildProcessWithoutNullStreams[];
  scriptRoot: string;
  workspaceRoot: string;
}

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'automate-k6-'));
  await mkdir(join(sandbox, 'scripts', 'nested'), { recursive: true });
  await mkdir(join(sandbox, 'workspaces'), { recursive: true });
  await writeFile(join(sandbox, 'scripts', 'smoke.js'), '// fake script\n');
  await writeFile(join(sandbox, 'scripts', 'nested', 'deep.js'), '// fake script\n');
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function harness(
  behaviour: Behaviour = { summary: CLEAN_SUMMARY, code: 0 },
  overrides: Partial<K6ExecutionOptions> = {},
): Harness {
  const calls: Call[] = [];
  const terminated: ChildProcessWithoutNullStreams[] = [];
  const scriptRoot = join(sandbox, 'scripts');
  const workspaceRoot = join(sandbox, 'workspaces');
  const adapter = new K6ExecutionAdapter({
    scriptRoot,
    workspaceRoot,
    allowedTargetUrls: ['http://target.test:8080'],
    artifactMaxBytes: 1024 * 1024,
    logMaxBytes: 64 * 1024,
    environment: {
      PATH: '/usr/bin',
      HOME: '/home/runner',
      CI: '1',
      GITHUB_TOKEN: 'ghp_should_never_reach_k6',
      DATABASE_URL: 'postgres://nope',
      RUNNER_REGISTRATION_SECRET: 'nope',
    },
    spawnProcess: (command, args, options) => {
      calls.push({ command, args: [...args], options });
      const child = new FakeChild();
      setImmediate(() => void runFake(child, [...args], behaviour));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
    terminateProcess: (child) => {
      terminated.push(child);
      setImmediate(() => (child as unknown as FakeChild).emit('close', null, 'SIGKILL'));
      return Promise.resolve();
    },
    ...overrides,
  });
  return { adapter, calls, terminated, scriptRoot, workspaceRoot };
}

async function runFake(child: FakeChild, args: string[], behaviour: Behaviour): Promise<void> {
  if (behaviour.spawnError !== undefined) {
    child.pid = undefined;
    child.emit('error', behaviour.spawnError);
    return;
  }
  const exportPath = args[args.indexOf('--summary-export') + 1];
  if (exportPath !== undefined) {
    if (behaviour.rawSummary !== undefined) await writeFile(exportPath, behaviour.rawSummary);
    else if (behaviour.summary !== undefined) {
      await writeFile(exportPath, JSON.stringify(behaviour.summary));
    }
  }
  if (behaviour.stdout !== undefined) child.stdout.write(behaviour.stdout);
  if (behaviour.hang === true) return;
  child.exitCode = behaviour.code ?? 0;
  child.emit('close', child.exitCode, null);
}

const JOB = { script: 'smoke.js', vus: 3, durationSeconds: 10 };

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    jobId: 'job-1',
    k6: JOB,
    targetUrl: 'http://target.test:8080/',
    deadlineMs: 30_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function workspaces(h: Harness): Promise<string[]> {
  return readdir(h.workspaceRoot);
}

describe('the spawn', () => {
  it('builds the argv itself from the bounded job, and nothing a caller sends becomes a flag', async () => {
    const h = harness();
    await h.adapter.execute(context());

    const call = h.calls[0];
    expect(call?.command).toBe('k6');
    const summaryPath = call?.args[call.args.indexOf('--summary-export') + 1] ?? '';
    expect(call?.args).toEqual(k6Arguments(JOB, join(h.scriptRoot, 'smoke.js'), summaryPath));
    expect(call?.args).toEqual([
      'run',
      '--quiet',
      '--no-color',
      '--no-usage-report',
      '--vus',
      '3',
      '--duration',
      '10s',
      '--summary-trend-stats',
      'avg,min,med,max,p(90),p(95),p(99)',
      '--summary-export',
      summaryPath,
      expect.stringMatching(/smoke\.js$/u),
    ]);
  });

  it('spawns without a shell, as a process-group leader off Windows, in the script directory', async () => {
    const h = harness();
    await h.adapter.execute(context({ k6: { ...JOB, script: 'nested/deep.js' } }));
    const options = h.calls[0]?.options;
    expect(options?.shell).toBe(false);
    expect(options?.detached).toBe(process.platform !== 'win32');
    expect(options?.cwd).toBe(join(h.scriptRoot, 'nested'));
    expect(options?.windowsHide).toBe(true);
  });

  it('gives k6 the target and an allowlisted environment, never the runner’s secrets', async () => {
    const h = harness();
    await h.adapter.execute(context());
    const env = h.calls[0]?.options.env ?? {};
    // No trailing slash: scripts build URLs as `${TARGET_URL}/path`, and a normalised
    // `http://host/` made that `http://host//path` - a different resource on a real server.
    expect(env['TARGET_URL']).toBe('http://target.test:8080');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['K6_NO_USAGE_REPORT']).toBe('true');
    expect(Object.keys(env).join(',')).not.toMatch(/TOKEN|DATABASE|SECRET/u);
    expect(JSON.stringify(env)).not.toContain('ghp_should_never_reach_k6');
  });

  it('keeps a base path in the target and drops only the trailing slash', async () => {
    const h = harness(undefined, { allowedTargetUrls: ['http://target.test:8080'] });
    await h.adapter.execute(context({ targetUrl: 'http://target.test:8080/app/v1/' }));
    expect(h.calls[0]?.options.env?.['TARGET_URL']).toBe('http://target.test:8080/app/v1');
  });

  it('uses the configured k6 binary', async () => {
    const h = harness(undefined, { k6Binary: '/opt/k6/bin/k6' });
    await h.adapter.execute(context());
    expect(h.calls[0]?.command).toBe('/opt/k6/bin/k6');
  });
});

describe('refusals happen before anything is spawned or created', () => {
  const huge = 'x'.repeat(10);
  it.each([
    ['no k6 block', { k6: undefined }, /k6 job configuration is invalid/u],
    ['VUs over the ceiling', { k6: { ...JOB, vus: LOAD_MAX_VUS + 1 } }, /vus/u],
    [
      'a duration over the ceiling',
      { k6: { ...JOB, durationSeconds: LOAD_MAX_DURATION_SECONDS + 1 } },
      /durationSeconds/u,
    ],
    ['zero VUs', { k6: { ...JOB, vus: 0 } }, /vus/u],
    ['a parent-directory script', { k6: { ...JOB, script: '../smoke.js' } }, /script/u],
    ['an absolute script', { k6: { ...JOB, script: '/etc/x.js' } }, /script/u],
    ['an extra field', { k6: { ...JOB, args: ['--out', 'cloud'] } }, /k6 job configuration/u],
    ['a script that does not exist', { k6: { ...JOB, script: 'nope.js' } }, /not found/u],
    [
      'a target outside the allowlist',
      { targetUrl: 'http://evil.test:8080/' },
      /not allowlisted: http:\/\/evil\.test:8080/u,
    ],
    [
      'the right host on the wrong port',
      { targetUrl: 'http://target.test:9/' },
      /not allowlisted/u,
    ],
    ['no target at all', { targetUrl: undefined }, /invalid/u],
    ['a target with credentials', { targetUrl: 'http://u:p@target.test:8080/' }, /not allowed/u],
    ['a file: target', { targetUrl: 'file:///etc/passwd' }, /not allowed/u],
    ['a zero deadline', { deadlineMs: 0 }, /positive integer/u],
  ] satisfies Array<[string, Partial<ExecutionContext>, RegExp]>)(
    'refuses %s as a configuration failure',
    async (_name, overrides, message) => {
      const h = harness();
      await expect(h.adapter.execute(context(overrides))).rejects.toThrow(RunnerConfigurationError);
      await expect(h.adapter.execute(context(overrides))).rejects.toThrow(message);
      expect(h.calls).toHaveLength(0);
      expect(await workspaces(h)).toEqual([]);
      expect(huge).toHaveLength(10);
    },
  );

  it('refuses a script that reaches outside the root through a link inside it', async () => {
    const outside = join(sandbox, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'evil.js'), '// not the operator’s\n');
    // A junction on Windows (no privilege needed), a symlink elsewhere.
    await symlink(outside, join(sandbox, 'scripts', 'linked'), 'junction');

    const h = harness();
    await expect(
      h.adapter.execute(context({ k6: { ...JOB, script: 'linked/evil.js' } })),
    ).rejects.toThrow(/outside the configured script root/u);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses a directory named like a script', async () => {
    await mkdir(join(sandbox, 'scripts', 'dir.js'));
    const h = harness();
    await expect(h.adapter.execute(context({ k6: { ...JOB, script: 'dir.js' } }))).rejects.toThrow(
      /not found/u,
    );
  });
});

describe('the verdict', () => {
  it('a clean exit with every threshold uncrossed is passed, with tests for each', async () => {
    const h = harness({ summary: CLEAN_SUMMARY, code: 0 });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const result = await h.adapter.execute(
      context({
        onEvent: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      }),
    );

    expect(result.status).toBe('passed');
    expect(result.error).toBeUndefined();
    const completed = events.filter((event) => event.type === 'test.completed');
    expect(completed.map((event) => event.payload['testId'])).toEqual(
      expect.arrayContaining([
        'threshold:http_req_duration[p(95)<2000]',
        'threshold:http_req_failed[rate<0.01]',
        'threshold:checks[rate>0.99]',
      ]),
    );
    expect(completed.every((event) => event.payload['status'] === 'passed')).toBe(true);
    // Each test is announced before it completes, with the suite and script on it.
    expect(events.filter((event) => event.type === 'test.started')).toHaveLength(completed.length);
    expect(completed[0]?.payload).toMatchObject({ suite: 'k6', file: 'smoke.js', attempt: 1 });
  });

  it('exit 99 with a crossed latency threshold is failed, and names the bound', async () => {
    const h = harness({ summary: BREACHED_SUMMARY, code: K6_THRESHOLDS_CROSSED_EXIT });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const result = await h.adapter.execute(
      context({
        onEvent: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      }),
    );

    expect(result.status).toBe('failed');
    const failure = events.find(
      (event) => event.type === 'test.completed' && event.payload['status'] === 'failed',
    );
    expect(failure?.payload).toMatchObject({
      testId: 'threshold:http_req_duration[p(95)<5]',
      errorCode: 'K6_THRESHOLD_CROSSED',
    });
    expect(JSON.stringify(failure?.payload['errors'])).toContain('p(95)<5');
    // The other bound was met, and is reported as met.
    expect(
      events.find(
        (event) =>
          event.type === 'test.completed' &&
          event.payload['testId'] === 'threshold:http_req_failed[rate<0.01]',
      )?.payload['status'],
    ).toBe('passed');
  });

  it('a failed check with no threshold on it fails the run even on a clean exit', async () => {
    const h = harness({
      summary: { metrics: { checks: { passes: 5, fails: 15, value: 0.25 } } },
      code: 0,
    });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const result = await h.adapter.execute(
      context({
        onEvent: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      }),
    );
    expect(result.status).toBe('failed');
    expect(events.find((event) => event.payload['status'] === 'failed')?.payload['errorCode']).toBe(
      'K6_CHECK_FAILED',
    );
  });

  it('exit 99 is a failure even when the summary reads clean: k6 judged the thresholds', async () => {
    const h = harness({ summary: CLEAN_SUMMARY, code: K6_THRESHOLDS_CROSSED_EXIT });
    expect((await h.adapter.execute(context())).status).toBe('failed');
  });

  it.each([
    ['exit 99 and no summary', { code: 99 }, /wrote no summary/u],
    ['a clean exit and no summary', { code: 0 }, /wrote no summary/u],
    ['a script error (exit 107)', { summary: CLEAN_SUMMARY, code: 107 }, /exited with 107/u],
    ['a summary that is not JSON', { rawSummary: '{nope', code: 0 }, /could not be read/u],
    [
      'a summary that is not a k6 summary',
      { summary: { hello: 1 }, code: 0 },
      /could not be read/u,
    ],
    ['a summary that measured nothing', { summary: { metrics: {} }, code: 0 }, /asserted nothing/u],
  ] satisfies Array<[string, Behaviour, RegExp]>)(
    '%s is an infrastructure failure, never a pass',
    async (_name, behaviour, message) => {
      const h = harness(behaviour);
      const result = await h.adapter.execute(context());
      expect(result.status).toBe('infra_failed');
      expect(result.error).toMatchObject({ code: 'RUNNER_INFRA_FAILED' });
      expect(result.error?.message).toMatch(message);
    },
  );

  it('uploads the summary under the kind the reporter and the score recognise, with the logs', async () => {
    const h = harness({ summary: CLEAN_SUMMARY, stdout: 'running 3 VUs\n', code: 0 });
    const result = await h.adapter.execute(context());
    expect(result.artifacts.map((artifact) => [artifact.name, artifact.kind])).toEqual([
      ['k6-summary.json', 'k6-json'],
      ['stderr.log', 'stderr'],
      ['stdout.log', 'stdout'],
    ]);
    expect(result.resultPath).toMatch(/k6-summary\.json$/u);
    expect(result.stdout).toBe('running 3 VUs\n');
    expect(JSON.parse(await readFile(result.resultPath, 'utf8'))).toEqual(CLEAN_SUMMARY);
  });

  it('redacts registered secrets from the logs and the result', async () => {
    const h = harness({ summary: CLEAN_SUMMARY, stdout: 'token=s3cr3t-value\n', code: 0 });
    const result = await h.adapter.execute(context({ redactions: ['s3cr3t-value'] }));
    expect(result.stdout).toBe('token=[REDACTED]\n');
    expect(await readFile(join(result.workspacePath, 'stdout.log'), 'utf8')).not.toContain(
      's3cr3t-value',
    );
  });

  it('reports an event the API could not take as infrastructure, not as a result', async () => {
    const h = harness({ summary: CLEAN_SUMMARY, code: 0 });
    const result = await h.adapter.execute(
      context({ onEvent: () => Promise.reject(new Error('event ingest refused')) }),
    );
    expect(result.status).toBe('infra_failed');
    expect(result.error?.message).toContain('event ingest refused');
  });

  it('an artifact over the limit fails the run and leaves no workspace behind', async () => {
    const h = harness({ summary: CLEAN_SUMMARY, stdout: 'x', code: 0 }, { artifactMaxBytes: 20 });
    await expect(h.adapter.execute(context())).rejects.toBeInstanceOf(RunnerInfrastructureError);
    expect(await workspaces(h)).toEqual([]);
  });
});

describe('time, cancellation and a process that will not start', () => {
  it('stops the process at the deadline and reports timed_out', async () => {
    const h = harness({ hang: true });
    const result = await h.adapter.execute(context({ deadlineMs: 30 }));
    expect(result.status).toBe('timed_out');
    expect(h.terminated).toHaveLength(1);
  });

  it('stops the process when the job is cancelled', async () => {
    const h = harness({ hang: true });
    const controller = new AbortController();
    const pending = h.adapter.execute(context({ signal: controller.signal }));
    await new Promise((settle) => setTimeout(settle, 20));
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    expect(h.terminated).toHaveLength(1);
  });

  it('stops a process of a job that was already cancelled before it started', async () => {
    const h = harness({ hang: true });
    const controller = new AbortController();
    controller.abort();
    expect((await h.adapter.execute(context({ signal: controller.signal }))).status).toBe(
      'cancelled',
    );
  });

  it('reports a k6 that cannot be started as infrastructure, with the reason', async () => {
    const h = harness({ spawnError: new Error('spawn k6 ENOENT') });
    const result = await h.adapter.execute(context());
    expect(result.status).toBe('infra_failed');
    expect(result.error?.message).toContain('ENOENT');
  });
});

describe('cleanup', () => {
  it('removes a workspace it created, and refuses a path outside the workspace root', async () => {
    const h = harness();
    const result = await h.adapter.execute(context());
    expect(existsSync(result.workspacePath)).toBe(true);
    await h.adapter.cleanup(result.workspacePath);
    expect(existsSync(result.workspacePath)).toBe(false);
    await expect(h.adapter.cleanup(sandbox)).rejects.toBeInstanceOf(RunnerConfigurationError);
    await expect(h.adapter.cleanup(h.workspaceRoot)).rejects.toBeInstanceOf(
      RunnerConfigurationError,
    );
  });
});

describe('loadStatus', () => {
  const exit = (code: number | null, extra: { timedOut?: boolean; spawnError?: Error } = {}) => ({
    code,
    timedOut: extra.timedOut ?? false,
    spawnError: extra.spawnError,
  });
  const base = { aborted: false, deliveryError: undefined };

  it.each([
    [exit(0), 'passed', 'passed'],
    [exit(0), 'failed', 'failed'],
    [exit(99), 'passed', 'failed'],
    [exit(99), 'failed', 'failed'],
    [exit(0), 'unknown', 'infra_failed'],
    [exit(0), 'skipped', 'infra_failed'],
    [exit(0), undefined, 'infra_failed'],
    [exit(1), 'passed', 'infra_failed'],
    [exit(null), 'passed', 'infra_failed'],
    [exit(0, { timedOut: true }), 'passed', 'timed_out'],
    [exit(0, { spawnError: new Error('x') }), 'passed', 'infra_failed'],
  ] as const)('%j with a %s reading is %s', (processExit, verdict, expected) => {
    expect(loadStatus({ ...base, exit: processExit, verdict })).toBe(expected);
  });

  it('ranks a delivery error over a timeout, and a timeout over an abort', () => {
    expect(
      loadStatus({ ...base, deliveryError: new Error('x'), exit: exit(0), verdict: 'passed' }),
    ).toBe('infra_failed');
    expect(
      loadStatus({ ...base, aborted: true, exit: exit(0, { timedOut: true }), verdict: 'passed' }),
    ).toBe('timed_out');
    expect(loadStatus({ ...base, aborted: true, exit: exit(0), verdict: 'passed' })).toBe(
      'cancelled',
    );
  });
});

/**
 * Real k6, against a mock server this test starts. Defined only where a k6 binary exists
 * (`k6 version` answers): the fake-process tests above cover every branch of the adapter
 * everywhere, and these prove the argv and the summary shape are what k6 itself accepts and
 * writes. The production runner image carries k6 (see `infra/docker/runner.Dockerfile`).
 */
const k6Version = spawnSync('k6', ['version'], { encoding: 'utf8', windowsHide: true });
const k6Available = k6Version.status === 0 && !k6Version.error;
const FIXTURES = fileURLToPath(new URL('../fixtures/k6/', import.meta.url));

if (k6Available) {
  describe(`real k6 (${k6Version.stdout.trim().split('\n')[0] ?? 'k6'})`, () => {
    let server: Server;
    let origin: string;
    let requests = 0;
    let paths: string[] = [];

    beforeEach(async () => {
      requests = 0;
      paths = [];
      server = createServer((request, response) => {
        requests += 1;
        paths.push(request.url ?? '');
        // `/slow` is what the breaching fixture asks for: well over its 5 ms bound.
        setTimeout(() => response.end('ok'), request.url === '/slow' ? 40 : 0);
      });
      await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      await new Promise<void>((settle) => server.close(() => settle()));
    });

    function real(): K6ExecutionAdapter {
      return new K6ExecutionAdapter({
        scriptRoot: FIXTURES,
        workspaceRoot: join(sandbox, 'workspaces'),
        allowedTargetUrls: [origin],
        artifactMaxBytes: 5_000_000,
        logMaxBytes: 1_000_000,
      });
    }

    async function run(script: string, overrides: Partial<ExecutionContext> = {}) {
      const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const result = await real().execute({
        jobId: 'real-1',
        k6: { script, vus: 2, durationSeconds: 2 },
        targetUrl: origin,
        deadlineMs: 60_000,
        signal: new AbortController().signal,
        onEvent: (event) => {
          events.push(event);
          return Promise.resolve();
        },
        ...overrides,
      });
      return { result, events };
    }

    it('a script that meets its thresholds is passed, and the mock server saw the load', async () => {
      const { result, events } = await run('pass.js');
      expect(result.error).toBeUndefined();
      expect(result.status).toBe('passed');
      expect(requests).toBeGreaterThan(1);
      // The script builds ${TARGET_URL}/health: one slash, never //health.
      expect(new Set(paths)).toEqual(new Set(['/health']));
      expect(
        events
          .filter((e) => e.type === 'test.completed')
          .every((e) => e.payload['status'] === 'passed'),
      ).toBe(true);
      expect(result.artifacts.some((artifact) => artifact.kind === 'k6-json')).toBe(true);
    }, 60_000);

    it('a script that breaches its latency threshold is failed, naming the threshold', async () => {
      const { result, events } = await run('breach.js');
      expect(result.status).toBe('failed');
      const failure = events.find(
        (e) => e.type === 'test.completed' && e.payload['status'] === 'failed',
      );
      expect(failure?.payload['testId']).toBe('threshold:http_req_duration[p(95)<5]');
      expect(failure?.payload['errorCode']).toBe('K6_THRESHOLD_CROSSED');
    }, 60_000);

    it('stops k6 at the job deadline rather than letting it run its duration', async () => {
      const started = Date.now();
      const { result } = await run('pass.js', {
        k6: { script: 'pass.js', vus: 1, durationSeconds: LOAD_MAX_DURATION_SECONDS },
        deadlineMs: 1_000,
      });
      expect(result.status).toBe('timed_out');
      expect(Date.now() - started).toBeLessThan(30_000);
    }, 60_000);

    it('refuses a target that is not the allowlisted origin, before k6 starts', async () => {
      requests = 0;
      await expect(run('pass.js', { targetUrl: 'http://127.0.0.1:9/' })).rejects.toThrow(
        /not allowlisted/u,
      );
      expect(requests).toBe(0);
    });
  });
}
