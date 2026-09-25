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

describe('generateRunPdf', () => {
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
    const { generateRunPdf } = await import('../pdf-report.js');

    await expect(generateRunPdf('missing-run')).rejects.toThrow('Run missing-run not found');
  });

  it('returns a PDF buffer with valid PDF magic bytes', async () => {
    testApp.db
      .insert(schema.runs)
      .values(
        fixtures.run({
          id: 'run-pdf-1',
          status: 'failed',
          total: 3,
          passed: 2,
          failed: 1,
          flaky: 0,
          skipped: 0,
          durationMs: 12345,
          branch: 'main',
          commitSha: 'abcdef1234567',
          gateStatus: 'failed',
          startedAt: '2026-03-01T13:00:00.000Z',
          finishedAt: '2026-03-01T13:00:12.000Z',
        }),
      )
      .run();

    const testRow = fixtures.test('run-pdf-1', {
      id: 'pdf-test-1',
      title: 'should render report content',
      file: 'tests/report.spec.ts',
      status: 'failed',
      durationMs: 5000,
      retryCount: 1,
    });
    testApp.db.insert(schema.tests).values(testRow).run();
    testApp.db
      .insert(schema.results)
      .values(
        fixtures.result('pdf-test-1', 'run-pdf-1', {
          id: 'pdf-result-1',
          status: 'failed',
          errorMessage: 'Expected screenshot to match baseline',
        }),
      )
      .run();

    const { generateRunPdf } = await import('../pdf-report.js');
    const pdf = await generateRunPdf('run-pdf-1');

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const content = pdf.toString('latin1');
    expect(content).toContain('/Type /Page');
    expect(content).toContain('/BaseFont /Helvetica-Bold');
  });

  it('generates PDF for run with no tests', async () => {
    testApp.db
      .insert(schema.runs)
      .values(
        fixtures.run({
          id: 'run-pdf-empty',
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
          startedAt: '2026-03-01T14:00:00.000Z',
          finishedAt: '2026-03-01T14:00:00.000Z',
        }),
      )
      .run();

    const { generateRunPdf } = await import('../pdf-report.js');
    const pdf = await generateRunPdf('run-pdf-empty');

    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(900);
    expect(pdf.toString('latin1')).toContain('/Type /Page');
  });

  it('handles many tests and paginates without throwing', async () => {
    testApp.db
      .insert(schema.runs)
      .values(
        fixtures.run({
          id: 'run-pdf-many',
          status: 'failed',
          total: 120,
          passed: 100,
          failed: 20,
          flaky: 0,
          skipped: 0,
          durationMs: 185000,
          branch: 'feature/pagination',
          commitSha: '1234567890abcdef',
          gateStatus: 'failed',
          startedAt: '2026-03-01T15:00:00.000Z',
          finishedAt: '2026-03-01T15:03:05.000Z',
        }),
      )
      .run();

    const tests: Array<ReturnType<typeof fixtures.test>> = [];
    const results: Array<ReturnType<typeof fixtures.result>> = [];
    for (let i = 0; i < 120; i += 1) {
      const testId = `pdf-many-${i}`;
      tests.push(
        fixtures.test('run-pdf-many', {
          id: testId,
          title: `test title ${i} with a long suffix to trigger truncation behavior in generated pdf rows`,
          file: `tests/suite-${Math.floor(i / 10)}/spec-${i}.very.long.filename.spec.ts`,
          status: i % 6 === 0 ? 'failed' : 'passed',
          durationMs: i % 3 === 0 ? 70000 : 700 + i,
          retryCount: i % 2,
        }),
      );
      results.push(
        fixtures.result(testId, 'run-pdf-many', {
          id: `pdf-many-result-${i}`,
          status: i % 6 === 0 ? 'failed' : 'passed',
          errorMessage: i % 6 === 0 ? `error message ${i}` : null,
        }),
      );
    }

    testApp.db.insert(schema.tests).values(tests).run();
    testApp.db.insert(schema.results).values(results).run();

    const { generateRunPdf } = await import('../pdf-report.js');
    const pdf = await generateRunPdf('run-pdf-many');

    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(7000);
    expect(pdf.toString('utf8')).toContain('/Type /Page');
  });
});
