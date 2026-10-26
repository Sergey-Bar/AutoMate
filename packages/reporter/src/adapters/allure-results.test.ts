import { describe, expect, it } from 'vitest';
import { testIdentity } from '@automate/shared-contracts';
import { allureResultsAdapter } from './allure-results.js';
import type { ProducerContext } from '../adapter.js';

/**
 * Allure results, as Allure 2 writes them: one `*-result.json` per result, concatenated by
 * the caller. The fixtures are the shape of real results — `uuid`, `historyId`, `fullName`,
 * ms-epoch `start`/`stop`, `labels`, `parameters`, `statusDetails`, `steps`, `attachments`
 * — including the fields this adapter ignores, because a fixture holding only what the
 * adapter reads would pass a parser that depended on nothing.
 */
const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'upload://allure',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-01T00:00:00.000Z',
  finishedAt: '2026-10-01T00:05:00.000Z',
};

const START = Date.parse('2026-10-01T00:00:10.000Z');

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: 'a1',
    historyId: 'h1',
    testCaseId: 't1',
    fullName: 'com.acme.checkout.PayTest.pays',
    name: 'pays',
    status: 'passed',
    stage: 'finished',
    start: START,
    stop: START + 1_500,
    labels: [
      { name: 'package', value: 'com.acme.checkout' },
      { name: 'testClass', value: 'com.acme.checkout.PayTest' },
      { name: 'parentSuite', value: 'Checkout' },
      { name: 'suite', value: 'Card' },
      { name: 'host', value: 'ci-7' },
      { name: 'severity', value: 'critical' },
    ],
    parameters: [],
    steps: [{ name: 'open cart', status: 'passed', start: START, stop: START + 10 }],
    attachments: [{ name: 'log', source: 'abc-attachment.txt', type: 'text/plain' }],
    links: [],
    ...overrides,
  };
}

const parse = (value: unknown) =>
  allureResultsAdapter.parse(new TextEncoder().encode(JSON.stringify(value)), context);

describe('allure-results', () => {
  it('reads a result into the shared identity, with timing and message', () => {
    const run = parse([
      result({
        status: 'failed',
        statusDetails: { message: 'expected 200 but was 500', trace: 'at …', flaky: false },
      }),
    ]);
    expect(run.status).toBe('failed');
    expect(run.attempts).toHaveLength(1);
    const [attempt] = run.attempts ?? [];
    expect(attempt).toMatchObject({
      index: 1,
      testId: testIdentity({
        file: 'com.acme.checkout.PayTest',
        describePath: ['Checkout', 'Card'],
        title: 'pays',
      }),
      specPath: 'com.acme.checkout.PayTest',
      title: 'pays',
      describePath: ['Checkout', 'Card'],
      status: 'failed',
      rawStatus: 'failed',
      startedAt: '2026-10-01T00:00:10.000Z',
      durationMs: 1_500,
      error: { message: 'expected 200 but was 500' },
      flakiness: 'unknown',
    });
    expect(attempt?.project).toBeUndefined();
    expect(run.provenance.producer).toBe('allure');
  });

  it('treats broken as a failure, and unknown statuses as unobserved', () => {
    const run = parse([
      result({ name: 'a', status: 'broken' }),
      result({ name: 'b', status: 'skipped' }),
      result({ name: 'c', status: 'mystery' }),
    ]);
    expect(run.attempts?.map((attempt) => attempt.status)).toEqual([
      'failed',
      'skipped',
      'unknown',
    ]);
    expect(run.attempts?.[2]?.rawStatus).toBe('mystery');
    expect(run.status).toBe('failed');
  });

  it('keeps parametrised variants apart, ignoring excluded parameters', () => {
    const run = parse([
      result({ parameters: [{ name: 'browser', value: 'chromium' }] }),
      result({ parameters: [{ name: 'browser', value: 'webkit' }], status: 'failed' }),
      result({
        parameters: [
          { name: 'browser', value: 'chromium' },
          { name: 'nonce', value: '9f3', excluded: true },
        ],
      }),
    ]);
    const projects = run.attempts?.map((attempt) => attempt.project);
    // Two chromium results are one test's attempts; webkit is another test.
    expect(new Set(run.attempts?.map((attempt) => attempt.testId)).size).toBe(2);
    expect(projects).toEqual(['browser=chromium', 'browser=chromium', 'browser=webkit']);
  });

  it('folds retries into one test, by start, and calls disagreement flaky', () => {
    const run = parse([
      result({ uuid: 'second', status: 'passed', start: START + 5_000, stop: START + 6_000 }),
      result({ uuid: 'first', status: 'failed', start: START, stop: START + 1_000 }),
    ]);
    expect(run.attempts?.map((attempt) => [attempt.index, attempt.status])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(run.attempts?.every((attempt) => attempt.flakiness === 'observed')).toBe(true);
    expect(run.status).toBe('flaky');
  });

  it('calls repeated identical outcomes a broken test, not a flaky one', () => {
    const run = parse([
      result({ status: 'failed' }),
      result({ status: 'failed', start: START + 9 }),
    ]);
    expect(run.status).toBe('failed');
    expect(run.attempts?.every((attempt) => attempt.flakiness === 'unknown')).toBe(true);
  });

  it('accepts a wrapper object and a single result', () => {
    expect(parse({ results: [result()] }).attempts).toHaveLength(1);
    expect(parse(result()).attempts).toHaveLength(1);
  });

  it('never lets a label walk out of the repository', () => {
    const run = parse([
      result({
        labels: [{ name: 'testClass', value: '../../etc/passwd' }],
      }),
      result({ name: 'abs', labels: [{ name: 'testClass', value: 'C:\\Users\\x\\a.spec.ts' }] }),
      result({ name: 'bare', labels: [] }),
    ]);
    expect(run.attempts?.map((attempt) => attempt.specPath)).toEqual([
      'etc/passwd',
      'Users/x/a.spec.ts',
      'unknown.spec.ts',
    ]);
  });

  it('falls back to the context time when a result has none', () => {
    const [attempt] = parse([result({ start: undefined, stop: undefined })]).attempts ?? [];
    expect(attempt?.startedAt).toBe(context.startedAt);
    expect(attempt?.durationMs).toBeUndefined();
  });

  it('skips entries that are not results, and refuses a document with none', () => {
    expect(parse([null, 7, { status: 'passed' }, result()]).attempts).toHaveLength(1);
    expect(() => parse([])).toThrow(/no test results/u);
    expect(() => parse('text')).toThrow(/not a JSON object or array/u);
    expect(() => allureResultsAdapter.parse(new TextEncoder().encode('{'), context)).toThrow(
      /not valid JSON/u,
    );
  });
});
