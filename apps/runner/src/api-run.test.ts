import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiExecutionAdapter } from './api-run.js';
import {
  RunnerConfigurationError,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from './execution.js';
import { GenericSpawnAdapter, type GenericCommand } from './generic-spawn.js';

/**
 * The api domain on the runner: `bru run` against a local mock, for real.
 *
 * The first two groups run the shipped `@usebruno/cli` against the fixture collections in
 * `fixtures/api-smoke` and a mock server this file starts, so a pass and a failure are
 * observed end to end rather than asserted about a fake. The rest use a recording delegate
 * where the point is what the adapter *asks* for, or a hand-written report where the point
 * is how JUnit is mapped.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/api-smoke/', import.meta.url));

let server: Server;
let origin: string;
const scratch: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ service: 'automate-api', status: 'ok' }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratchDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'automate-api-run-'));
  scratch.push(path);
  return path;
}

type Event = {
  type: string;
  payload: Record<string, unknown>;
  eventId: string;
  sequence: number;
};

function contextFor(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext & { events: Event[] } {
  const events: Event[] = [];
  return {
    jobId: 'job-1',
    targetUrl: origin,
    apiCollection: 'pass',
    apiEnvironment: 'local',
    deadlineMs: 60_000,
    signal: new AbortController().signal,
    onEvent: (event) => {
      events.push({
        type: event.type,
        payload: event.payload,
        eventId: event.eventId,
        sequence: event.sequence,
      });
      return Promise.resolve();
    },
    events,
    ...overrides,
  };
}

async function realAdapter(): Promise<{ adapter: ApiExecutionAdapter; workspaceRoot: string }> {
  const workspaceRoot = await scratchDirectory();
  const delegate = new GenericSpawnAdapter({
    repoRoot: FIXTURES,
    workspaceRoot,
    artifactMaxBytes: 1_000_000,
    logMaxBytes: 1_000_000,
  });
  return {
    adapter: new ApiExecutionAdapter({
      delegate,
      collectionRoot: FIXTURES,
      allowedTargetUrls: [origin],
    }),
    workspaceRoot,
  };
}

const completed = (events: Event[]) => events.filter((event) => event.type === 'test.completed');

// The real CLI loads a large dependency tree on first use; on a loaded machine (the whole
// workspace's tests run at once) that start alone has taken tens of seconds.
describe(
  'bru run against the fixture collections (real Bruno CLI, local mock)',
  { timeout: 120_000 },
  () => {
    it('reports a passing collection as passed, with every test completed as passed', async () => {
      const { adapter } = await realAdapter();
      const context = contextFor();
      const result = await adapter.execute(context);

      expect(result.status).toBe('passed');
      expect(result.error).toBeUndefined();
      expect(completed(context.events).map((event) => event.payload['status'])).toEqual([
        'passed',
        'passed',
      ]);
      expect(completed(context.events).map((event) => event.payload['title'])).toEqual([
        'res.status eq 200',
        'the service identifies itself',
      ]);
      // Every completion is announced by a start for the same test.
      expect(context.events.filter((event) => event.type === 'test.started')).toHaveLength(2);
      // The JUnit report is an uploaded artifact, kind junit.
      expect(
        result.artifacts.map((artifact) => [artifact.kind, artifact.contentType]),
      ).toContainEqual(['junit-xml', 'application/xml']);
      await adapter.cleanup(result.workspacePath);
    });

    it('reports a failing collection as failed, naming the failed test and its message', async () => {
      const { adapter } = await realAdapter();
      const context = contextFor({ apiCollection: 'fail' });
      const result = await adapter.execute(context);

      expect(result.status).toBe('failed');
      const statuses = completed(context.events).map((event) => event.payload['status']);
      expect(statuses).toEqual(['passed', 'failed']);
      const failed = completed(context.events)[1];
      expect(failed?.payload['title']).toBe('the service reports selected-failure');
      expect(JSON.stringify(failed?.payload['errors'])).toContain("expected 'ok'");
      await adapter.cleanup(result.workspacePath);
    });

    it('leaves no report behind in the collection, and moves it into the run workspace', async () => {
      const { adapter } = await realAdapter();
      const result = await adapter.execute(contextFor());

      expect(await readdir(join(FIXTURES, 'pass'))).not.toContainEqual(
        expect.stringMatching(/xml$/u),
      );
      const report = result.artifacts.find((artifact) => artifact.kind === 'junit-xml');
      expect(report?.path.startsWith(result.workspacePath)).toBe(true);
      expect(await readFile(report?.path ?? '', 'utf8')).toContain('<testsuite');
      await adapter.cleanup(result.workspacePath);
      await expect(access(result.workspacePath)).rejects.toThrow();
    });

    it('is an infrastructure failure, not a test failure, when the environment does not exist', async () => {
      const { adapter } = await realAdapter();
      const result = await adapter.execute(contextFor({ apiEnvironment: 'nowhere' }));
      expect(result.status).toBe('infra_failed');
      await adapter.cleanup(result.workspacePath);
    });

    it('times a collection out and kills it, as the generic adapter does', async () => {
      const workspaceRoot = await scratchDirectory();
      const fake = join(await scratchDirectory(), 'hang.mjs');
      await writeFile(fake, 'setTimeout(() => {}, 60_000);\n');
      const adapter = new ApiExecutionAdapter({
        delegate: new GenericSpawnAdapter({
          repoRoot: FIXTURES,
          workspaceRoot,
          artifactMaxBytes: 1_000_000,
          logMaxBytes: 1_000_000,
        }),
        collectionRoot: FIXTURES,
        allowedTargetUrls: [origin],
        bruCliPath: fake,
      });
      const started = Date.now();
      const result = await adapter.execute(contextFor({ deadlineMs: 500 }));
      expect(result.status).toBe('timed_out');
      expect(Date.now() - started).toBeLessThan(10_000);
      await adapter.cleanup(result.workspacePath);
    });
  },
);

describe('what the adapter asks the delegate to run', () => {
  function recording(): ExecutionProvider & { commands: GenericCommand[] } {
    const commands: GenericCommand[] = [];
    return {
      commands,
      execute: vi.fn((context: ExecutionContext) => {
        commands.push(context.command as GenericCommand);
        return Promise.reject(new Error('stop here'));
      }),
    };
  }

  function adapterWith(delegate: ExecutionProvider, allowed: readonly string[] = [origin]) {
    return new ApiExecutionAdapter({
      delegate,
      collectionRoot: FIXTURES,
      allowedTargetUrls: allowed,
      bruCliPath: '/opt/bru.js',
    });
  }

  it('is one fixed bru invocation: sandboxed, recursive, the target as baseUrl, a JUnit file', async () => {
    const delegate = recording();
    await adapterWith(delegate)
      .execute(contextFor({ jobId: 'job/../1' }))
      .catch(() => undefined);

    const [command] = delegate.commands;
    expect(command?.argv).toEqual([
      process.execPath,
      '/opt/bru.js',
      'run',
      '-r',
      '--sandbox',
      'safe',
      '--env-var',
      `baseUrl=${origin}`,
      '--env',
      'local',
      '--reporter-junit',
      'bruno-junit-job_.._1.xml',
    ]);
    expect(command?.workingDirectory).toBe('pass');
    expect(command?.artifactGlobs).toEqual(['bruno-junit-job_.._1.xml']);
    // A suite is held to the artifact rule: a clean exit with no report asserted nothing.
    expect(command?.evidence).toBe('artifact');
    expect(command?.env ?? {}).toEqual({});
  });

  it('omits --env when no environment was asked for', async () => {
    const delegate = recording();
    await adapterWith(delegate)
      .execute(contextFor({ apiEnvironment: undefined }))
      .catch(() => undefined);
    expect(delegate.commands[0]?.argv).not.toContain('--env');
  });

  it.each([
    ['no target', { targetUrl: undefined }],
    ['a target outside the allowlist', { targetUrl: 'http://169.254.169.254' }],
    ['a target with credentials', { targetUrl: 'http://u:p@127.0.0.1:1' }],
    ['a non-http target', { targetUrl: 'file:///etc/passwd' }],
    ['a collection that climbs out', { apiCollection: '../x' }],
    ['an absolute collection', { apiCollection: '/etc' }],
    ['a collection that is a flag', { apiCollection: '--insecure' }],
    ['an environment that is a path', { apiEnvironment: '../prod' }],
    ['an environment that is a flag', { apiEnvironment: '--insecure' }],
    ['a directory that is not a collection', { apiCollection: 'environments-missing' }],
  ])('refuses %s as a configuration failure and spawns nothing', async (_name, overrides) => {
    const delegate = recording();
    await expect(
      adapterWith(delegate).execute(contextFor(overrides as Partial<ExecutionContext>)),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    expect(delegate.execute).not.toHaveBeenCalled();
  });

  it('accepts a target on an allowed origin whatever its path', async () => {
    const delegate = recording();
    await adapterWith(delegate)
      .execute(contextFor({ targetUrl: `${origin}/v1` }))
      .catch(() => undefined);
    expect(delegate.commands[0]?.argv).toContain(`baseUrl=${origin}/v1`);
  });
});

describe('mapping the JUnit report onto test events', () => {
  async function withReport(
    xml: string | null,
    status: ExecutionResult['status'] = 'failed',
    overrides: Partial<ExecutionContext> = {},
  ) {
    const workspacePath = await scratchDirectory();
    const source = join(await scratchDirectory(), 'bruno-junit-job-1.xml');
    const artifacts: ExecutionResult['artifacts'] = [];
    if (xml !== null) {
      await writeFile(source, xml);
      artifacts.push({
        path: source,
        digest: 'a'.repeat(64),
        bytes: xml.length,
        kind: 'junit-xml',
        name: 'bruno-junit-job-1.xml',
        contentType: 'application/xml',
      });
    }
    const delegate: ExecutionProvider = {
      execute: () =>
        Promise.resolve({
          status,
          resultPath: source,
          workspacePath,
          artifacts,
          stdout: '',
          stderr: '',
        }),
    };
    const adapter = new ApiExecutionAdapter({
      delegate,
      collectionRoot: FIXTURES,
      allowedTargetUrls: [origin],
    });
    const context = contextFor(overrides);
    return { result: await adapter.execute(context), context };
  }

  const REPORT = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="orders" file="orders.bru" tests="4" failures="1" errors="1" skipped="1">
    <testcase name="created" classname="orders" status="pass" time="0.5"/>
    <testcase name="listed" classname="orders" status="fail" time="0.25">
      <failure type="failure" message="expected 2 to equal 3"/>
    </testcase>
    <testcase name="deleted" classname="orders" status="error" time="0.1">
      <error type="error" message="socket hang up"/>
    </testcase>
    <testcase name="archived" classname="orders" status="skipped" time="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

  it('maps pass, fail, error and skipped to the canonical test statuses', async () => {
    const { context } = await withReport(REPORT);
    expect(
      completed(context.events).map((event) => [event.payload['title'], event.payload['status']]),
    ).toEqual([
      ['created', 'passed'],
      ['listed', 'failed'],
      ['deleted', 'failed'],
      ['archived', 'skipped'],
    ]);
  });

  it('carries suite, duration and the failure message', async () => {
    const { context } = await withReport(REPORT);
    const listed = completed(context.events)[1]?.payload;
    expect(listed).toMatchObject({ suite: 'orders', durationMs: 250 });
    expect(JSON.stringify(listed?.['errors'])).toContain('expected 2 to equal 3');
  });

  it('gives every event a unique id and an increasing sequence', async () => {
    const { context } = await withReport(REPORT);
    expect(context.events).toHaveLength(8);
    expect(new Set(context.events.map((event) => event.eventId)).size).toBe(8);
    expect(context.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('redacts a registered secret out of a failure message', async () => {
    const xml = REPORT.replace('expected 2 to equal 3', 'token s3cr3t-value rejected');
    const workspacePath = await scratchDirectory();
    const source = join(await scratchDirectory(), 'bruno-junit-job-1.xml');
    await writeFile(source, xml);
    const adapter = new ApiExecutionAdapter({
      delegate: {
        execute: () =>
          Promise.resolve({
            status: 'failed',
            resultPath: source,
            workspacePath,
            artifacts: [
              {
                path: source,
                digest: 'b'.repeat(64),
                bytes: xml.length,
                kind: 'junit-xml',
                name: 'bruno-junit-job-1.xml',
                contentType: 'application/xml',
              },
            ],
            stdout: '',
            stderr: '',
          }),
      },
      collectionRoot: FIXTURES,
      allowedTargetUrls: [origin],
    });
    const context = contextFor({ redactions: ['s3cr3t-value'] });
    await adapter.execute(context);
    expect(JSON.stringify(context.events)).not.toContain('s3cr3t-value');
    expect(JSON.stringify(context.events)).toContain('[REDACTED]');
  });

  it('is an infrastructure failure when the report cannot be read as results', async () => {
    const { result, context } = await withReport('<testsuites></testsuites>');
    expect(result.status).toBe('infra_failed');
    expect(result.error?.message).toMatch(/Bruno report/u);
    expect(context.events).toEqual([]);
  });

  it('passes a delegate result with no report straight through', async () => {
    const { result, context } = await withReport(null, 'infra_failed');
    expect(result.status).toBe('infra_failed');
    expect(context.events).toEqual([]);
  });

  it('works without an event sink', async () => {
    const { result } = await withReport(REPORT, 'failed', { onEvent: undefined });
    expect(result.status).toBe('failed');
  });
});
