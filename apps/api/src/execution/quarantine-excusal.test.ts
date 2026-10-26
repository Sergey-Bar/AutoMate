import { describe, expect, it } from 'vitest';
import { defaultPolicy, evaluateQualityGate } from './quality-gate.js';
import { excuseQuarantined, type QuarantineMatch } from './quarantine-excusal.js';
import type { ExecutionTestResult } from './types.js';

/**
 * Quarantine excuses a failure at the gate and never rewrites it.
 *
 * Before this, an approved quarantine entry changed nothing anywhere: `evaluateQualityGate`
 * never read it, so "approved" was a word on a dashboard. The rule now is that an approved
 * entry for a test lets the gate pass a run whose **only** failures are quarantined tests —
 * as a warning, never a clean pass — and the run and its tests keep the statuses the
 * producer reported.
 */

const policy = defaultPolicy('workspace-1');

function result(
  stableId: string,
  status: ExecutionTestResult['status'],
  title = 'pays',
  file = 'a.spec.ts',
): ExecutionTestResult {
  return { id: stableId, stableId, title, file, status, durationMs: 10, attempt: 1, error: null };
}

function runOf(tests: ExecutionTestResult[], extra: Record<string, unknown> = {}) {
  const count = (status: string) => tests.filter((test) => test.status === status).length;
  const failed = count('failed') + count('timed_out');
  return {
    outcome: failed > 0 ? ('failed' as const) : ('passed' as const),
    tests,
    artifacts: [],
    rawEvidenceRefs: ['report:junit'],
    error: null,
    summary: {
      total: tests.length,
      passed: count('passed'),
      failed,
      flaky: count('flaky'),
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: 10,
    },
    ...extra,
  };
}

const approved = (
  stableId: string | null,
  extra: Partial<QuarantineMatch> = {},
): QuarantineMatch => ({
  stableId,
  testTitle: 'pays',
  testFile: 'a.spec.ts',
  status: 'approved',
  ...extra,
});

const WEBKIT = 'a.spec.ts › pays [webkit]';
const CHROMIUM = 'a.spec.ts › pays [chromium]';

describe('quarantine at the gate', () => {
  it('passes a run whose only failure is an approved quarantined test, as a warning', () => {
    const run = runOf([result(CHROMIUM, 'passed'), result(WEBKIT, 'failed')]);
    const gate = evaluateQualityGate({
      run,
      policy,
      domainStatuses: { browser: 'failed' },
      quarantined: [approved(WEBKIT)],
    });
    expect(gate.decision).toBe('ready_with_warnings');
    expect(gate.reasons).toContain('quarantine:EXCUSED; excused=1');
    expect(gate.reasons.some((reason) => reason.startsWith('product_failure:'))).toBe(false);
    // The evidence is untouched.
    expect(run.outcome).toBe('failed');
    expect(run.tests[1]?.status).toBe('failed');
    expect(run.summary.failed).toBe(1);
  });

  it('changes nothing for a pending or rejected entry', () => {
    const run = runOf([result(WEBKIT, 'failed')]);
    for (const status of ['pending', 'rejected'] as const) {
      const gate = evaluateQualityGate({
        run,
        policy,
        domainStatuses: { browser: 'failed' },
        quarantined: [approved(WEBKIT, { status })],
      });
      expect(gate.decision).toBe('blocked');
    }
  });

  it('blocks a run with one quarantined failure and one that is not', () => {
    const run = runOf([result(WEBKIT, 'failed'), result(CHROMIUM, 'failed')]);
    const gate = evaluateQualityGate({
      run,
      policy,
      domainStatuses: { browser: 'failed' },
      quarantined: [approved(WEBKIT)],
    });
    expect(gate.decision).toBe('blocked');
    expect(gate.reasons).toContain('product_failure:FAILED_TEST_COUNT');
  });

  it('keeps one project of a test out of another project’s quarantine', () => {
    const gate = evaluateQualityGate({
      run: runOf([result(WEBKIT, 'failed')]),
      policy,
      domainStatuses: { browser: 'failed' },
      quarantined: [approved(CHROMIUM)],
    });
    expect(gate.decision).toBe('blocked');
  });

  it('matches an entry recorded before identities by title and file, in every project', () => {
    const excusal = excuseQuarantined(runOf([result(WEBKIT, 'failed')]), [approved(null)]);
    expect(excusal.complete).toBe(true);
    const other = excuseQuarantined(runOf([result(WEBKIT, 'failed', 'pays', 'b.spec.ts')]), [
      approved(null),
    ]);
    expect(other.complete).toBe(false);
  });

  it('never excuses a run that failed outside its tests', () => {
    const run = runOf([result(WEBKIT, 'failed')], {
      error: { code: 'GLOBAL_SETUP', message: 'global setup threw' },
    });
    const gate = evaluateQualityGate({
      run,
      policy,
      domainStatuses: { browser: 'failed' },
      quarantined: [approved(WEBKIT)],
    });
    expect(gate.decision).toBe('blocked');
  });

  it('never excuses a run whose summary counts failures its tests do not show', () => {
    const run = runOf([result(WEBKIT, 'failed')]);
    run.summary.failed = 3;
    run.summary.total = 3;
    expect(excuseQuarantined(run, [approved(WEBKIT)]).complete).toBe(false);
  });

  it('never excuses a run that recorded no failure: there is nothing to excuse', () => {
    const excusal = excuseQuarantined(runOf([result(WEBKIT, 'passed')]), [approved(WEBKIT)]);
    expect(excusal).toMatchObject({ complete: false, excused: 0 });
    const gate = evaluateQualityGate({
      run: runOf([result(WEBKIT, 'passed')]),
      policy,
      quarantined: [approved(WEBKIT)],
    });
    expect(gate.decision).toBe('ready');
  });

  it('excuses a quarantined flaky pass from the flaky-rate threshold', () => {
    const run = runOf([result(CHROMIUM, 'passed'), result(WEBKIT, 'flaky')]);
    expect(evaluateQualityGate({ run, policy }).decision).toBe('blocked');
    const gate = evaluateQualityGate({ run, policy, quarantined: [approved(WEBKIT)] });
    expect(gate.decision).toBe('ready_with_warnings');
    expect(gate.reasons).toContain('quarantine:EXCUSED; excused=1');
  });

  it('does not pass a run whose every test is quarantined: nothing is left to pass on', () => {
    const gate = evaluateQualityGate({
      run: runOf([result(WEBKIT, 'failed')]),
      policy,
      domainStatuses: { browser: 'failed' },
      quarantined: [approved(WEBKIT)],
    });
    expect(gate.decision).toBe('blocked');
  });
});

describe('which entries excuse which runs', () => {
  const PROJECT_A = '11111111-1111-4111-8111-111111111111';
  const PROJECT_B = '22222222-2222-4222-8222-222222222222';

  it("keeps one project's entry out of another project's run", () => {
    const entry = approved(WEBKIT, { projectId: PROJECT_A });
    const run = (projectId: string | null) => ({
      ...runOf([result(CHROMIUM, 'passed'), result(WEBKIT, 'failed')]),
      projectId,
    });
    expect(excuseQuarantined(run(PROJECT_A), [entry]).complete).toBe(true);
    expect(excuseQuarantined(run(PROJECT_B), [entry]).complete).toBe(false);
    // A run that names no project is read the way it was before projects existed.
    expect(excuseQuarantined(run(null), [entry]).complete).toBe(true);
    // An entry that names no project matches in any project.
    expect(excuseQuarantined(run(PROJECT_B), [approved(WEBKIT)]).complete).toBe(true);
  });

  it('excuses nothing with a released entry', () => {
    const run = runOf([result(CHROMIUM, 'passed'), result(WEBKIT, 'failed')]);
    expect(excuseQuarantined(run, [approved(WEBKIT, { status: 'released' })]).complete).toBe(false);
  });
});
