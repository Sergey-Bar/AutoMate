import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NdjsonReporter from './playwright-reporter.js';

const SECRET_KEY = /token|secret|password|credential|api[_-]?key/iu;

let directory: string;
let eventsPath: string;

beforeEach(async () => {
  // The reporter redacts the value of every secret-looking variable in the
  // environment. Whatever the host happens to export would otherwise leak into
  // these assertions, so the environment is made deterministic first.
  for (const key of Object.keys(process.env)) {
    if (SECRET_KEY.test(key) || key === 'RUNNER_REDACT_VALUES') vi.stubEnv(key, undefined);
  }
  directory = await mkdtemp(join(tmpdir(), 'runner-reporter-'));
  eventsPath = join(directory, 'events.ndjson');
  vi.stubEnv('AUTOMATE_RUNNER_EVENTS_PATH', eventsPath);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

interface WrittenEvent {
  eventId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

async function events(): Promise<WrittenEvent[]> {
  const text = await readFile(eventsPath, 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WrittenEvent);
}

function testCase(title: string): TestCase {
  const value = {
    id: 'test-1',
    title,
    location: { file: '/suite/login.spec.ts', line: 12, column: 3 },
  };
  return value as unknown as TestCase;
}

function testResult(overrides: Partial<TestResult>): TestResult {
  const value = {
    status: 'passed',
    duration: 120,
    retry: 0,
    errors: [],
    attachments: [],
    ...overrides,
  };
  return value as unknown as TestResult;
}

function fullResult(status: FullResult['status']): FullResult {
  const value = { status, duration: 4_000, startTime: new Date() };
  return value as unknown as FullResult;
}

describe('NdjsonReporter', () => {
  it('does not claim stdio, so the list reporter keeps the console', () => {
    expect(new NdjsonReporter().printsToStdio()).toBe(false);
  });

  it('writes one ordered event line per lifecycle hook', async () => {
    const reporter = new NdjsonReporter();
    const test = testCase('logs in');

    reporter.onTestBegin(test, testResult({}));
    reporter.onTestEnd(test, testResult({ status: 'passed', duration: 321, retry: 1 }));
    reporter.onEnd(fullResult('passed'));

    const written = await events();
    expect(written.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'test.started'],
      [2, 'test.completed'],
      [3, 'run.progress'],
    ]);
    expect(new Set(written.map((event) => event.eventId)).size).toBe(3);
    expect(written[0]?.payload).toEqual({
      testId: 'test-1',
      title: 'logs in',
      file: '/suite/login.spec.ts',
      line: 12,
      column: 3,
    });
    expect(written[1]?.payload).toEqual({
      testId: 'test-1',
      title: 'logs in',
      file: '/suite/login.spec.ts',
      status: 'passed',
      durationMs: 321,
      retry: 1,
      errors: [],
      attachments: [],
    });
    expect(written[2]?.payload).toEqual({ status: 'passed', durationMs: 4_000 });
    for (const event of written) expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
  });

  it('maps Playwright end states onto runner statuses', async () => {
    const reporter = new NdjsonReporter();
    reporter.onEnd(fullResult('timedout'));
    reporter.onEnd(fullResult('interrupted'));
    reporter.onEnd(fullResult('failed'));

    expect((await events()).map((event) => event.payload['status'])).toEqual([
      'timed_out',
      'cancelled',
      'failed',
    ]);
  });

  it('redacts configured values and secret-named variables from titles, errors and attachments', async () => {
    vi.stubEnv('RUNNER_REDACT_VALUES', 'hunter2,,customer-acme');
    vi.stubEnv('E2E_API_KEY', 'sk-live-123');
    const reporter = new NdjsonReporter();

    reporter.onTestEnd(
      testCase('customer-acme login with hunter2'),
      testResult({
        status: 'failed',
        errors: [
          {
            message: 'expected sk-live-123 to be rejected',
            location: { file: '/tmp/customer-acme/a.spec.ts', line: 4, column: 9 },
          },
          {},
        ],
        attachments: [
          { name: 'trace-hunter2', path: '/out/trace.zip', contentType: 'application/zip' },
        ],
      }),
    );

    const [event] = await events();
    expect(event?.payload['title']).toBe('[REDACTED] login with [REDACTED]');
    expect(event?.payload['errors']).toEqual([
      {
        message: 'expected [REDACTED] to be rejected',
        location: '/tmp/[REDACTED]/a.spec.ts:4:9',
      },
      { message: 'Playwright test failed' },
    ]);
    expect(event?.payload['attachments']).toEqual([
      { name: 'trace-[REDACTED]', path: '/out/trace.zip', contentType: 'application/zip' },
    ]);
    const raw = await readFile(eventsPath, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('sk-live-123');
  });

  it('writes nothing when the runner did not provide an events path', async () => {
    vi.stubEnv('AUTOMATE_RUNNER_EVENTS_PATH', undefined);
    const reporter = new NdjsonReporter();

    reporter.onTestBegin(testCase('logs in'), testResult({}));
    reporter.onEnd(fullResult('passed'));

    await expect(readFile(eventsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
