import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Reporter } from '@playwright/test/reporter';
import { describe, expect, it } from 'vitest';
import AutomateReporter, { type ReporterOptions } from './index.js';
import type { PwFullConfig, PwSuite, PwTestCase, PwTestResult } from './playwright-types.js';

/**
 * The reporter against fakes of the Playwright objects it reads, and a recorded `fetch`.
 *
 * The fakes are the shapes Playwright hands a reporter — a root suite, one suite per
 * project, one per file, nested `describe` suites — because identity is read off that tree,
 * and a fake flatter than the real one would pass a reporter that reads the wrong level.
 * `the real Reporter interface accepts it` holds the structural types to Playwright's own.
 */

// Compile-time: the reporter is a Playwright `Reporter`. A method whose signature drifted
// from Playwright's is a type error here rather than a reporter Playwright never calls.
const _compatible: Reporter = new AutomateReporter({ env: {} });

const ROOT = path.resolve('/repo/tests');
const SHA = 'a'.repeat(40);

interface Call {
  url: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

function recorder(
  answer: (call: Call, index: number) => Response | Promise<Response> = () => ok(),
) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      authorization: headers.get('authorization'),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    calls.push(call);
    return answer(call, calls.length - 1);
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

function ok(status = 202): Response {
  return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
}

function suite(type: PwSuite['type'], title: string, parent?: PwSuite, project?: string): PwSuite {
  const value: PwSuite = {
    type,
    title,
    ...(parent === undefined ? {} : { parent }),
    project: () => (project === undefined ? parent?.project() : { name: project }),
    allTests: () => [],
  };
  return value;
}

function testCase(
  title: string,
  options: { describe?: string[]; project?: string; retries?: number; file?: string } = {},
): PwTestCase & { outcomeIs: (value: ReturnType<PwTestCase['outcome']>) => void } {
  const root = suite('root', '');
  const project = suite('project', options.project ?? '', root, options.project ?? '');
  const file = options.file ?? 'checkout/pay.spec.ts';
  let parent = suite('file', file, project);
  for (const name of options.describe ?? []) parent = suite('describe', name, parent);
  let outcome: ReturnType<PwTestCase['outcome']> = 'expected';
  return {
    id: `${file}-${title}-${options.project ?? ''}`,
    title,
    retries: options.retries ?? 0,
    location: { file: path.join(ROOT, file), line: 3, column: 1 },
    parent,
    outcome: () => outcome,
    outcomeIs: (value) => {
      outcome = value;
    },
  };
}

function result(overrides: Partial<PwTestResult> = {}): PwTestResult {
  return { retry: 0, status: 'passed', duration: 120, errors: [], attachments: [], ...overrides };
}

const CONFIG: PwFullConfig = { rootDir: ROOT };

function rootSuite(count: number): PwSuite {
  return { ...suite('root', ''), allTests: () => new Array<PwTestCase>(count) };
}

function reporter(
  fetch: typeof globalThis.fetch,
  env: Record<string, string | undefined> = {},
  extra: Partial<ReporterOptions> = {},
): { reporter: AutomateReporter; log: string[] } {
  const log: string[] = [];
  return {
    log,
    reporter: new AutomateReporter({
      env: {
        AUTOMATE_URL: 'https://automate.example.com',
        AUTOMATE_REPORTER_SECRET: 'reporter-secret-value',
        GITHUB_SHA: SHA,
        GITHUB_REF_NAME: 'main',
        ...env,
      },
      fetch,
      log: (line) => log.push(line),
      retryDelayMs: 0,
      ...extra,
    }),
  };
}

const events = (calls: Call[]) =>
  calls.filter((call) => call.url.endsWith('/api/v1/reporter/events'));
const artifacts = (calls: Call[]) => calls.filter((call) => call.url.endsWith('/artifacts'));

describe('streaming a run', () => {
  it('sends run:start, each test, then run:end, in order, with the identity fields', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch);
    const test = testCase('pays by card', { describe: ['checkout', 'card'], project: 'webkit' });

    r.onBegin(CONFIG, rootSuite(1));
    r.onTestBegin(test, result());
    r.onTestEnd(test, result({ status: 'passed', duration: 321 }));
    await r.onEnd({ status: 'passed', duration: 900 });

    const sent = events(calls);
    expect(sent.map((call) => call.body['type'])).toEqual([
      'run:start',
      'test:begin',
      'test:end',
      'run:end',
    ]);
    const runId = String(sent[0]?.body['runId']);
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(sent.every((call) => call.body['runId'] === runId)).toBe(true);
    // The legacy wire shape: no version and no timestamp, which is how the route tells it.
    expect(Object.keys(sent[0]?.body ?? {}).sort()).toEqual(['payload', 'runId', 'type']);
    expect(sent[0]?.body['payload']).toEqual({
      total: 1,
      branch: 'main',
      commitSha: SHA,
      triggeredBy: 'playwright-reporter',
    });
    expect(sent[1]?.body['payload']).toEqual({
      testId: test.id,
      title: 'pays by card',
      // Relative to the config's rootDir with forward slashes — what Playwright's JSON
      // reporter writes — so a test's history does not split between the two doors.
      file: 'checkout/pay.spec.ts',
      describePath: ['checkout', 'card'],
      project: 'webkit',
    });
    expect(sent[2]?.body['payload']).toEqual({
      testId: test.id,
      status: 'passed',
      durationMs: 321,
    });
    expect(sent[3]?.body['payload']).toEqual({ status: 'passed', durationMs: 900 });
    expect(sent.every((call) => call.authorization === 'Bearer reporter-secret-value')).toBe(true);
  });

  it('omits the project and describe path when there are none', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch, { GITHUB_SHA: undefined, GITHUB_REF_NAME: undefined });
    const test = testCase('loads');
    r.onBegin(CONFIG, rootSuite(1));
    r.onTestBegin(test, result());
    r.onTestEnd(test, result());
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(events(calls)[0]?.body['payload']).toEqual({
      total: 1,
      triggeredBy: 'playwright-reporter',
    });
    expect(events(calls)[1]?.body['payload']).toEqual({
      testId: test.id,
      title: 'loads',
      file: 'checkout/pay.spec.ts',
    });
  });

  it('prefers AUTOMATE_BRANCH and AUTOMATE_COMMIT, and drops a commit that is not a sha', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch, {
      AUTOMATE_BRANCH: 'feature/x',
      AUTOMATE_COMMIT: 'not a sha',
      GITHUB_HEAD_REF: 'pr-branch',
    });
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(events(calls)[0]?.body['payload']).toEqual({
      total: 0,
      branch: 'feature/x',
      triggeredBy: 'playwright-reporter',
    });
  });

  it('maps an interrupted or timed-out run to the statuses the route accepts', async () => {
    for (const [status, expected] of [
      ['interrupted', 'interrupted'],
      ['timedout', 'failed'],
      ['failed', 'failed'],
    ] as const) {
      const { calls, fetch } = recorder();
      const { reporter: r } = reporter(fetch);
      r.onBegin(CONFIG, rootSuite(0));
      await r.onEnd({ status, duration: 5.4 });
      expect(events(calls).at(-1)?.body['payload']).toEqual({ status: expected, durationMs: 5 });
    }
  });
});

describe('retries and outcomes', () => {
  it('reports a test that passed on retry once, as flaky, with the failed attempt\u2019s trace', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'automate-reporter-'));
    const tracePath = path.join(dir, 'trace.zip');
    writeFileSync(tracePath, 'PK trace bytes');
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch);
    const test = testCase('settles', { retries: 2 });

    r.onBegin(CONFIG, rootSuite(1));
    test.outcomeIs('unexpected');
    r.onTestBegin(test, result({ retry: 0 }));
    r.onTestEnd(
      test,
      result({
        retry: 0,
        status: 'failed',
        errors: [{ message: '\u001b[31mexpected\u001b[39m 1 to be 2' }],
        attachments: [{ name: 'trace', contentType: 'application/zip', path: tracePath }],
      }),
    );
    test.outcomeIs('flaky');
    r.onTestBegin(test, result({ retry: 1 }));
    r.onTestEnd(test, result({ retry: 1, status: 'passed', duration: 50 }));
    await r.onEnd({ status: 'passed', duration: 10 });

    const sent = events(calls);
    // One begin and one end: the route upserts on begin and counts on end, so a begin per
    // attempt would reset the row and an end per attempt would count the test twice.
    expect(sent.map((call) => call.body['type'])).toEqual([
      'run:start',
      'test:begin',
      'test:end',
      'run:end',
    ]);
    expect(sent[2]?.body['payload']).toEqual({ testId: test.id, status: 'flaky', durationMs: 50 });

    const uploaded = artifacts(calls);
    expect(uploaded).toHaveLength(1);
    const runId = String(sent[0]?.body['runId']);
    expect(uploaded[0]?.url).toBe(
      `https://automate.example.com/api/v1/reporter/runs/${runId}/artifacts`,
    );
    expect(uploaded[0]?.body).toEqual({
      testId: test.id,
      name: 'trace.zip',
      kind: 'trace',
      contentType: 'application/zip',
      bytesBase64: Buffer.from('PK trace bytes').toString('base64'),
      metadata: { attempt: 0 },
    });
    // The artifact goes after run:start and before run:end, so the run exists for it.
    const order = calls.map((call) => String(call.body['type'] ?? 'artifact'));
    expect(order.indexOf('artifact')).toBeGreaterThan(order.indexOf('run:start'));
    expect(order.indexOf('artifact')).toBeLessThan(order.indexOf('run:end'));
  });

  it('reports a final failure with its message, colour codes removed, and every attachment', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch);
    const test = testCase('declines', { retries: 1 });
    r.onBegin(CONFIG, rootSuite(1));
    test.outcomeIs('unexpected');
    r.onTestBegin(test, result());
    r.onTestEnd(test, result({ retry: 0, status: 'failed' }));
    r.onTestEnd(
      test,
      result({
        retry: 1,
        status: 'failed',
        duration: 70,
        errors: [
          { message: '\u001b[2mexpect(\u001b[22mreceived\u001b[2m)\u001b[22m.toBe(expected)' },
        ],
        attachments: [
          { name: 'screenshot', contentType: 'image/png', body: Buffer.from([1, 2, 3]) },
          { name: 'video', contentType: 'video/webm', body: Buffer.from([4]) },
          { name: 'notes', contentType: 'text/plain', body: Buffer.from('hi') },
          // An attachment with neither bytes nor a path has nothing to send.
          { name: 'empty', contentType: 'text/plain' },
        ],
      }),
    );
    await r.onEnd({ status: 'failed', duration: 10 });

    const end = events(calls).find((call) => call.body['type'] === 'test:end');
    expect(end?.body['payload']).toEqual({
      testId: test.id,
      status: 'failed',
      durationMs: 70,
      error: { message: 'expect(received).toBe(expected)' },
    });
    expect(artifacts(calls).map((call) => [call.body['name'], call.body['kind']])).toEqual([
      ['screenshot.png', 'screenshot'],
      ['video.webm', 'video'],
      ['notes.txt', 'attachment'],
    ]);
  });

  it('maps outcomes, not raw statuses', async () => {
    const cases: Array<[ReturnType<PwTestCase['outcome']>, PwTestResult['status'], string]> = [
      // `test.fail()` that failed is the expected outcome: a pass.
      ['expected', 'failed', 'passed'],
      // `test.fail()` that passed is unexpected: a failure.
      ['unexpected', 'passed', 'failed'],
      ['unexpected', 'timedOut', 'timedOut'],
      ['skipped', 'skipped', 'skipped'],
      // An interrupted test produced no result of its own.
      ['unexpected', 'interrupted', 'skipped'],
    ];
    for (const [outcome, status, expected] of cases) {
      const { calls, fetch } = recorder();
      const { reporter: r } = reporter(fetch, {}, { uploadArtifacts: false });
      const test = testCase('t');
      test.outcomeIs(outcome);
      r.onBegin(CONFIG, rootSuite(1));
      r.onTestBegin(test, result());
      r.onTestEnd(test, result({ status }));
      await r.onEnd({ status: 'passed', duration: 1 });
      const end = events(calls).find((call) => call.body['type'] === 'test:end');
      expect([
        outcome,
        status,
        (end?.body['payload'] as Record<string, unknown>)['status'],
      ]).toEqual([outcome, status, expected]);
    }
  });

  it('uploads nothing for a passing test, and nothing at all when artifacts are off', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch, {}, { uploadArtifacts: false });
    const test = testCase('fails');
    test.outcomeIs('unexpected');
    r.onBegin(CONFIG, rootSuite(1));
    r.onTestBegin(test, result());
    r.onTestEnd(
      test,
      result({
        status: 'failed',
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from([1]) }],
      }),
    );
    await r.onEnd({ status: 'failed', duration: 1 });
    expect(artifacts(calls)).toEqual([]);
  });

  it('does not read a trace larger than the server would accept', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'automate-reporter-'));
    const big = path.join(dir, 'trace.zip');
    writeFileSync(big, Buffer.alloc(16));
    const { calls, fetch } = recorder();
    const { reporter: r, log } = reporter(fetch, {}, { maxArtifactBytes: 8 });
    const test = testCase('big');
    test.outcomeIs('unexpected');
    r.onBegin(CONFIG, rootSuite(1));
    r.onTestBegin(test, result());
    r.onTestEnd(
      test,
      result({
        status: 'failed',
        attachments: [{ name: 'trace', contentType: 'application/zip', path: big }],
      }),
    );
    await r.onEnd({ status: 'failed', duration: 1 });
    expect(artifacts(calls)).toEqual([]);
    expect(log.join('\n')).toMatch(/trace\.zip is 16 bytes/u);
  });
});

describe('never breaking the test run', () => {
  it('retries a 5xx and a network failure, then succeeds', async () => {
    let failures = 2;
    const { calls, fetch } = recorder(() => {
      if (failures-- === 2) throw new TypeError('fetch failed');
      if (failures === 0) return ok(503);
      return ok();
    });
    const { reporter: r, log } = reporter(fetch);
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(events(calls).map((call) => call.body['type'])).toEqual([
      'run:start',
      'run:start',
      'run:start',
      'run:end',
    ]);
    expect(log).toEqual([]);
  });

  it('gives up after its attempts, says so once, and onEnd still resolves', async () => {
    const { calls, fetch } = recorder(() => {
      throw new TypeError('fetch failed');
    });
    const { reporter: r, log } = reporter(fetch);
    const test = testCase('x');
    r.onBegin(CONFIG, rootSuite(1));
    r.onTestBegin(test, result());
    r.onTestEnd(test, result());
    await expect(r.onEnd({ status: 'passed', duration: 1 })).resolves.toBeUndefined();
    // run:start failed for good, so nothing after it is sent: every later event would be
    // about a run the server never heard of.
    expect(calls).toHaveLength(3);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(
      /AutoMate reporter: run:start failed after 3 attempts \(fetch failed\)/u,
    );
  });

  it('stops at a refusal, without retrying it, and names the status', async () => {
    const { calls, fetch } = recorder(() => ok(401));
    const { reporter: r, log } = reporter(fetch);
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(calls).toHaveLength(1);
    expect(log[0]).toMatch(/run:start was refused with 401/u);
  });

  it('keeps going after a refused artifact: the events are what the run is', async () => {
    const { calls, fetch } = recorder((call) => (call.url.endsWith('/artifacts') ? ok(413) : ok()));
    const { reporter: r, log } = reporter(fetch);
    const test = testCase('x');
    test.outcomeIs('unexpected');
    r.onBegin(CONFIG, rootSuite(1));
    r.onTestBegin(test, result());
    r.onTestEnd(
      test,
      result({
        status: 'failed',
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from([1]) }],
      }),
    );
    await r.onEnd({ status: 'failed', duration: 1 });
    expect(events(calls).map((call) => call.body['type'])).toEqual([
      'run:start',
      'test:begin',
      'test:end',
      'run:end',
    ]);
    expect(log[0]).toMatch(/screenshot\.png was refused with 413/u);
  });

  it('never prints the secret', async () => {
    const { fetch } = recorder(() => {
      throw new Error('connect to reporter-secret-value failed');
    });
    const { reporter: r, log } = reporter(fetch);
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(log.join('\n')).not.toContain('reporter-secret-value');
    expect(log.join('\n')).toContain('[redacted]');
  });

  it('prints nothing to stdout of its own', () => {
    expect(new AutomateReporter({ env: {} }).printsToStdio()).toBe(false);
  });
});

describe('where it sends, and with what', () => {
  it('is off, with one line saying so, when AUTOMATE_URL is not set', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r, log } = reporter(fetch, { AUTOMATE_URL: undefined });
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(calls).toEqual([]);
    expect(log).toEqual(['AutoMate reporter: AUTOMATE_URL is not set; nothing is sent.']);
  });

  it.each([
    ['http://automate.example.com', false],
    ['http://127.evil.example', false],
    ['ftp://localhost', false],
    ['http://user:pass@localhost:3000', false],
    ['not a url', false],
    ['http://localhost:3000', true],
    ['http://127.0.0.1:3000', true],
    ['http://[::1]:3000', true],
    ['https://automate.example.com/', true],
  ])('%s is allowed: %s', async (url, allowed) => {
    const { calls, fetch } = recorder();
    const { reporter: r, log } = reporter(fetch, { AUTOMATE_URL: url });
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(calls.length > 0).toBe(allowed);
    expect(log.length === 0).toBe(allowed);
  });

  it('takes the url from its options over the environment', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch, {}, { url: 'http://localhost:3000' });
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(calls[0]?.url).toBe('http://localhost:3000/api/v1/reporter/events');
  });

  it('sends no authorization header when no secret is set', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch, { AUTOMATE_REPORTER_SECRET: undefined });
    r.onBegin(CONFIG, rootSuite(0));
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(calls[0]?.authorization).toBeNull();
  });

  it('runs without a call to onBegin, as a reporter that Playwright never started', async () => {
    const { calls, fetch } = recorder();
    const { reporter: r } = reporter(fetch);
    const test = testCase('x');
    r.onTestBegin(test, result());
    r.onTestEnd(test, result());
    await r.onEnd({ status: 'passed', duration: 1 });
    expect(calls).toEqual([]);
  });
});
