import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema.js';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';

const state = vi.hoisted(() => ({
  db: undefined as TestApp['db'] | undefined,
  poolConnection: undefined as TestApp['poolConnection'] | undefined,
}));

vi.mock('../../db/client.js', () => ({
  get db() { return state.db; },
  get poolConnection() { return state.poolConnection; },
}));

describe('stakeholder reports (service)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    state.db = testApp.db;
    state.poolConnection = testApp.poolConnection;
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  beforeEach(() => {
    testApp.poolConnection.exec(
      'DELETE FROM results; DELETE FROM tests; DELETE FROM runs; DELETE FROM trends; DELETE FROM quarantine; DELETE FROM defect_categories; DELETE FROM fingerprint_categories;',
    );
  });

  function insertBasicRun(id: string, overrides = {}) {
    testApp.db.insert(schema.runs).values(
      fixtures.run({
        id,
        status: 'failed',
        total: 50,
        passed: 45,
        failed: 5,
        flaky: 2,
        skipped: 0,
        durationMs: 30000,
        branch: 'main',
        commitSha: 'abc1234defghij',
        gateStatus: 'failed',
        startedAt: '2026-04-01T10:00:00Z',
        finishedAt: '2026-04-01T10:00:30Z',
        ...overrides,
      }),
    ).run();
  }

  // ── generateReleaseReport ──────────────────────────────────────────────

  it('generateReleaseReport returns a valid PDF buffer', async () => {
    insertBasicRun('run-release-1');
    const { generateReleaseReport } = await import('../stakeholder-reports.js');
    const pdf = await generateReleaseReport('run-release-1');
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('generateReleaseReport throws when run not found', async () => {
    const { generateReleaseReport } = await import('../stakeholder-reports.js');
    await expect(generateReleaseReport('nonexistent')).rejects.toThrow('Run nonexistent not found');
  });

  it('generateReleaseReport includes failure section when tests exist', async () => {
    insertBasicRun('run-release-2');
    testApp.db.insert(schema.tests).values(
      fixtures.test('run-release-2', { id: 't1', title: 'Login test fails', file: 'tests/auth.spec.ts', status: 'failed' }),
    ).run();
    const { generateReleaseReport } = await import('../stakeholder-reports.js');
    const pdf = await generateReleaseReport('run-release-2');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateReleaseReport shows quarantined count', async () => {
    insertBasicRun('run-release-3');
    testApp.poolConnection.exec(`
      INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status)
      VALUES ('q1', 'flaky test', 'tests/flaky.spec.ts', '2026-01-01T00:00:00Z', 'approved'),
             ('q2', 'another flaky', 'tests/other.spec.ts', '2026-01-01T00:00:00Z', 'approved')
    `);
    const { generateReleaseReport } = await import('../stakeholder-reports.js');
    const pdf = await generateReleaseReport('run-release-3');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateReleaseReport handles total=0 run (passRate=0 branch)', async () => {
    insertBasicRun('run-release-zero', { total: 0, passed: 0, failed: 0, flaky: 0, gateStatus: null });
    const { generateReleaseReport } = await import('../stakeholder-reports.js');
    const pdf = await generateReleaseReport('run-release-zero');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  // ── generateQualityReport ──────────────────────────────────────────────

  it('generateQualityReport returns a valid PDF buffer', async () => {
    insertBasicRun('run-quality-1');
    const { generateQualityReport } = await import('../stakeholder-reports.js');
    const pdf = await generateQualityReport('run-quality-1');
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateQualityReport throws when run not found', async () => {
    const { generateQualityReport } = await import('../stakeholder-reports.js');
    await expect(generateQualityReport('nonexistent')).rejects.toThrow('Run nonexistent not found');
  });

  it('generateQualityReport includes flaky tests and slow tests when present', async () => {
    insertBasicRun('run-quality-2');
    testApp.db.insert(schema.tests).values([
      fixtures.test('run-quality-2', { id: 'tq1', title: 'Flaky login', file: 'tests/auth.spec.ts', status: 'flaky', retryCount: 2, durationMs: 8000 }),
      fixtures.test('run-quality-2', { id: 'tq2', title: 'Slow payment', file: 'tests/payment.spec.ts', status: 'passed', retryCount: 0, durationMs: 30000 }),
    ]).run();
    const { generateQualityReport } = await import('../stakeholder-reports.js');
    const pdf = await generateQualityReport('run-quality-2');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateQualityReport handles no tests gracefully', async () => {
    insertBasicRun('run-quality-empty');
    const { generateQualityReport } = await import('../stakeholder-reports.js');
    const pdf = await generateQualityReport('run-quality-empty');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateQualityReport includes trend and failure-category sections when data present', async () => {
    insertBasicRun('run-quality-full');
    testApp.poolConnection.exec(`
      INSERT INTO trends (date, project, branch, total, passed, failed, flaky)
      VALUES ('2026-04-01', 'default', 'main', 100, 90, 10, 3),
             ('2026-04-02', 'default', 'main', 105, 100, 5, 1)
    `);
    testApp.poolConnection.exec(`
      INSERT INTO defect_categories (id, name, color, created_at)
      VALUES ('cat1', 'Network Errors', '#ff0000', '2026-01-01T00:00:00Z')
    `);
    const { generateQualityReport } = await import('../stakeholder-reports.js');
    const pdf = await generateQualityReport('run-quality-full');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  // ── generateExecutiveReport ────────────────────────────────────────────

  it('generateExecutiveReport returns a valid PDF buffer', async () => {
    insertBasicRun('run-exec-1');
    const { generateExecutiveReport } = await import('../stakeholder-reports.js');
    const pdf = await generateExecutiveReport('run-exec-1');
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateExecutiveReport throws when run not found', async () => {
    const { generateExecutiveReport } = await import('../stakeholder-reports.js');
    await expect(generateExecutiveReport('nonexistent')).rejects.toThrow('Run nonexistent not found');
  });

  it('generateExecutiveReport with trend data includes trend table', async () => {
    insertBasicRun('run-exec-2');
    testApp.poolConnection.exec(`
      INSERT INTO trends (date, project, branch, total, passed, failed, flaky)
      VALUES ('2026-04-01', 'default', 'main', 100, 95, 5, 2),
             ('2026-04-02', 'default', 'main', 110, 108, 2, 0)
    `);
    const { generateExecutiveReport } = await import('../stakeholder-reports.js');
    const pdf = await generateExecutiveReport('run-exec-2');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  // ── generateStakeholderReport dispatch ────────────────────────────────

  it('generateStakeholderReport dispatches to release template', async () => {
    insertBasicRun('run-dispatch-1');
    const { generateStakeholderReport } = await import('../stakeholder-reports.js');
    const pdf = await generateStakeholderReport('run-dispatch-1', 'release');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateStakeholderReport dispatches to quality template', async () => {
    insertBasicRun('run-dispatch-2');
    const { generateStakeholderReport } = await import('../stakeholder-reports.js');
    const pdf = await generateStakeholderReport('run-dispatch-2', 'quality');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('generateStakeholderReport dispatches to executive template', async () => {
    insertBasicRun('run-dispatch-3');
    const { generateStakeholderReport } = await import('../stakeholder-reports.js');
    const pdf = await generateStakeholderReport('run-dispatch-3', 'executive');
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
