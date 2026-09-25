import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema.js';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';

const state = vi.hoisted(() => ({
  db: undefined as TestApp['db'] | undefined,
  poolConnection: undefined as TestApp['poolConnection'] | undefined,
}));

vi.mock('../../db/client.js', () => ({
  get db() {
    return state.db;
  },
  get poolConnection() {
    return state.poolConnection;
  },
}));

describe('generateHtmlReport', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    state.db = testApp.db;
    state.poolConnection = testApp.poolConnection;
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM runs;');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('throws when run does not exist', async () => {
    const { generateHtmlReport } = await import('../html-report.js');

    await expect(generateHtmlReport('missing-run')).rejects.toThrow('Run missing-run not found');
  });

  it('returns full HTML report with summary KPIs and test rows', async () => {
    const run = fixtures.run({
      id: 'run-html-1',
      status: 'failed',
      total: 5,
      passed: 4,
      failed: 1,
      flaky: 0,
      skipped: 0,
      durationMs: 65000,
      branch: 'main',
      commitSha: 'abcdef1234567890',
      gateStatus: 'failed',
      startedAt: '2026-03-01T10:00:00.000Z',
      finishedAt: '2026-03-01T10:01:05.000Z',
    });
    testApp.db.insert(schema.runs).values(run).run();

    const t1 = fixtures.test('run-html-1', {
      id: 'test-1',
      title: 'login should pass',
      file: 'tests/auth.spec.ts',
      status: 'passed',
      durationMs: 1500,
      retryCount: 0,
    });
    const t2 = fixtures.test('run-html-1', {
      id: 'test-2',
      title: 'checkout fails for missing element',
      file: 'tests/checkout.spec.ts',
      status: 'failed',
      durationMs: 62000,
      retryCount: 2,
    });
    testApp.db.insert(schema.tests).values([t1, t2]).run();

    testApp.db
      .insert(schema.results)
      .values(
        fixtures.result('test-2', 'run-html-1', {
          id: 'result-2',
          retry: 0,
          status: 'failed',
          errorMessage: 'Expected "Submit" button to be visible',
        }),
      )
      .run();

    const { generateHtmlReport } = await import('../html-report.js');
    const html = await generateHtmlReport('run-html-1');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<h1>Test Run Report</h1>');
    expect(html).toContain('Pass Rate</div><div class="kpi-value">80.0%');
    expect(html).toContain('Duration</div><div class="kpi-value">1m 5s');
    expect(html).toContain('gate gate-failed">failed</span>');
    expect(html).toContain('checkout fails for missing element');
    expect(html).toContain('tests/checkout.spec.ts');
    expect(html).toContain('Expected &quot;Submit&quot; button to be visible');
    expect(html).toContain('<td class="mono">1.5s</td>');
    expect(html).toContain('<td class="mono">1m 2s</td>');
  });

  it('escapes special HTML characters in branch, title, file, status and error', async () => {
    const run = fixtures.run({
      id: 'run-html-escape',
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
      flaky: 0,
      skipped: 0,
      durationMs: 900,
      branch: 'feat/<x>&"quotes"',
      commitSha: '1234567abcdef',
      gateStatus: 'passed',
      startedAt: '2026-03-01T11:00:00.000Z',
      finishedAt: '2026-03-01T11:00:01.000Z',
    });
    testApp.db.insert(schema.runs).values(run).run();

    const testRow = fixtures.test('run-html-escape', {
      id: 'escape-1',
      title: 'renders <dangerous> & "quoted" text',
      file: 'tests/<script>.spec.ts',
      status: 'passed',
      durationMs: 900,
    });
    testApp.db.insert(schema.tests).values(testRow).run();

    testApp.db
      .insert(schema.results)
      .values(
        fixtures.result('escape-1', 'run-html-escape', {
          id: 'escape-result',
          status: 'passed',
          errorMessage: '<error> & "bad"',
        }),
      )
      .run();

    const { generateHtmlReport } = await import('../html-report.js');
    const html = await generateHtmlReport('run-html-escape');

    expect(html).toContain('feat/&lt;x&gt;&amp;&quot;quotes&quot;');
    expect(html).toContain('renders &lt;dangerous&gt; &amp; &quot;quoted&quot; text');
    expect(html).toContain('tests/&lt;script&gt;.spec.ts');
    expect(html).toContain('&lt;error&gt; &amp; &quot;bad&quot;');
    expect(html).toContain('900ms');
  });

  it('handles run with no tests and renders empty tbody', async () => {
    const run = fixtures.run({
      id: 'run-html-empty',
      status: 'passed',
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      durationMs: null,
      branch: null,
      commitSha: null,
      gateStatus: null,
      startedAt: '2026-03-01T12:00:00.000Z',
      finishedAt: '2026-03-01T12:00:00.000Z',
    });
    testApp.db.insert(schema.runs).values(run).run();

    const { generateHtmlReport } = await import('../html-report.js');
    const html = await generateHtmlReport('run-html-empty');

    expect(html).toContain('Pass Rate</div><div class="kpi-value">0.0%');
    expect(html).toContain('Duration</div><div class="kpi-value">N/A');
    expect(html).toContain('<tbody>');
    expect(html).toContain('</tbody>');
    expect(html).not.toContain('<span class="badge"');
  });

  it('renders correct badge colors for flaky and skipped tests (lines 64-66)', async () => {
    const run = fixtures.run({
      id: 'run-html-colors',
      status: 'passed',
      total: 3,
      passed: 1,
      failed: 0,
      flaky: 1,
      skipped: 1,
      durationMs: 2000,
      branch: null,
      commitSha: null,
      gateStatus: null,
      startedAt: '2026-03-01T13:00:00.000Z',
      finishedAt: '2026-03-01T13:00:02.000Z',
    });
    testApp.db.insert(schema.runs).values(run).run();

    const tFlaky = fixtures.test('run-html-colors', {
      id: 'test-flaky',
      title: 'flaky test',
      file: 'tests/flaky.spec.ts',
      status: 'flaky',
      durationMs: 800,
      retryCount: 1,
    });
    const tSkipped = fixtures.test('run-html-colors', {
      id: 'test-skipped',
      title: 'skipped test',
      file: 'tests/skipped.spec.ts',
      status: 'skipped',
      durationMs: null,
      retryCount: 0,
    });
    const tTimedOut = fixtures.test('run-html-colors', {
      id: 'test-timed-out',
      title: 'timed out test',
      file: 'tests/timeout.spec.ts',
      status: 'timedOut',
      durationMs: 30000,
      retryCount: 0,
    });
    testApp.db.insert(schema.tests).values([tFlaky, tSkipped, tTimedOut]).run();

    const { generateHtmlReport } = await import('../html-report.js');
    const html = await generateHtmlReport('run-html-colors');

    // flaky: #fbbf24
    expect(html).toContain('background:#fbbf24');
    // skipped: #94a3b8
    expect(html).toContain('background:#94a3b8');
    // timedOut: same as failed #f87171
    expect(html).toContain('background:#f87171');
    // duration: 30s for timedOut test
    expect(html).toContain('<td class="mono">30.0s</td>');
    // all three test names appear in the report
    expect(html).toContain('flaky test');
    expect(html).toContain('skipped test');
    expect(html).toContain('timed out test');
  });

  it('renders default color for unknown status (line 66 default branch)', async () => {
    const run = fixtures.run({
      id: 'run-html-unknown',
      status: 'passed',
      total: 1,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      durationMs: 500,
      branch: null,
      commitSha: null,
      gateStatus: null,
      startedAt: '2026-03-01T14:00:00.000Z',
      finishedAt: '2026-03-01T14:00:01.000Z',
    });
    testApp.db.insert(schema.runs).values(run).run();

    const tUnknown = fixtures.test('run-html-unknown', {
      id: 'test-unknown-status',
      title: 'unknown status test',
      file: 'tests/unknown.spec.ts',
      status: 'interrupted',
      durationMs: 500,
      retryCount: 0,
    });
    testApp.db.insert(schema.tests).values(tUnknown).run();

    const { generateHtmlReport } = await import('../html-report.js');
    const html = await generateHtmlReport('run-html-unknown');

    // default: #6b7280
    expect(html).toContain('background:#6b7280');
    expect(html).toContain('500ms');
  });
});
