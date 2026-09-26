import { describe, expect, it } from 'vitest';
import {
  legacyReporterAdapter,
  LegacyReporterAdapterContextSchema,
  type LegacyReporterAdapterContext,
  type LegacyReporterEventInput,
} from './legacy-reporter-adapter.js';
import { RunEventEnvelopeSchema } from './execution.js';

const timestamp = '2026-09-25T00:00:00.000Z';
const context = { runId: 'canonical-run-1', sequence: 1, occurredAt: timestamp } as const;

function adapt(
  event: LegacyReporterEventInput,
  overrides: Partial<LegacyReporterAdapterContext> = {},
): ReturnType<typeof legacyReporterAdapter> {
  return legacyReporterAdapter(event, { ...context, ...overrides });
}

describe('legacyReporterAdapter', () => {
  it('maps unversioned run:start and creates stable IDs', () => {
    const event = {
      type: 'run:start',
      runId: 'external-run-1',
      timestamp,
      total: 2,
      branch: 'main',
      commitSha: 'abc123',
    } as const;
    const first = adapt(event);
    const replay = adapt(event, { sequence: 2 });
    expect(first.type).toBe('run.started');
    expect(first.eventId).toBe(replay.eventId);
    expect(first.sequence).toBe(1);
    expect(replay.sequence).toBe(2);
    expect(first.payload).toMatchObject({
      externalId: 'external-run-1',
      phase: 'running',
      outcome: null,
      branch: 'main',
      commit: 'abc123',
      total: 2,
    });
    expect(RunEventEnvelopeSchema.safeParse(first).success).toBe(true);
  });

  it('accepts version 1 and explicit event identity overrides', () => {
    const result = adapt(
      {
        type: 'run:start',
        runId: 'external-run-2',
        version: '1',
        contractVersion: '1',
        occurredAt: timestamp,
        eventId: 'legacy-event-2',
        payload: { ref: 'release/1', commit: 'def456', testsTotal: 3 },
      },
      { eventId: 'context-event-2' },
    );
    expect(result.eventId).toBe('context-event-2');
    expect(result.payload).toMatchObject({ branch: 'release/1', commit: 'def456', total: 3 });
  });

  it('maps test:begin payload variants and retry numbering', () => {
    const fromRetry = adapt({
      type: 'test:begin',
      runId: 'external-run-3',
      payload: {
        id: 'test-1',
        name: 'adds an item',
        fileName: 'tests/cart.spec.ts',
        suite: 'cart',
        retry: 2,
        timestamp,
      },
    });
    expect(fromRetry).toMatchObject({
      type: 'test.started',
      sequence: 1,
      payload: {
        testId: 'test-1',
        attempt: 3,
        status: 'running',
        title: 'adds an item',
        file: 'tests/cart.spec.ts',
        suite: 'cart',
      },
    });
    const explicitAttempt = legacyReporterAdapter(
      {
        type: 'test:begin',
        runId: 'external-run-3',
        eventId: 'legacy-begin-1',
        payload: { test_id: 'test-2', attempt: 0 },
      },
      { runId: 'canonical-run-1', sequence: 2 },
    );
    expect(explicitAttempt.eventId).toBe('legacy-begin-1');
    expect(explicitAttempt.payload).toMatchObject({
      testId: 'test-2',
      attempt: 1,
      title: 'test-2',
    });
  });

  it('maps test:end statuses, errors, durations, and artifacts', () => {
    const result = adapt({
      type: 'test:end',
      runId: 'external-run-4',
      payload: {
        testId: 'test-3',
        status: 'timedOut',
        duration: 125,
        error: { code: 'test_timeout', message: 'Exceeded 100ms' },
        artifactIds: ['trace-1', 42, 'video-1'],
        title: '',
        suite: 'checkout',
        specPath: 'tests/checkout.spec.ts',
      },
    });
    expect(result).toMatchObject({
      type: 'test.completed',
      payload: {
        testId: 'test-3',
        attempt: 1,
        status: 'timed_out',
        durationMs: 125,
        error: { code: 'test_timeout', message: 'Exceeded 100ms' },
        artifactIds: ['trace-1', 'video-1'],
        suite: 'checkout',
        file: 'tests/checkout.spec.ts',
      },
    });
    for (const status of [
      'passed',
      'success',
      'ok',
      'failed',
      'failure',
      'error',
      'unknown',
      'future',
    ]) {
      expect(
        adapt({ type: 'test:end', runId: 'external-run-4', payload: { testId: 'test-3', status } })
          .payload,
      ).toMatchObject({
        status: ['passed', 'success', 'ok'].includes(status)
          ? 'passed'
          : ['failed', 'failure', 'error'].includes(status)
            ? 'failed'
            : 'unknown',
      });
    }
    expect(
      adapt({ type: 'test:end', runId: 'external-run-4', payload: { testId: 'test-4', status: 7 } })
        .payload,
    ).toMatchObject({ status: 'unknown' });
  });

  it('maps every supported run:end outcome and nested summary variants', () => {
    const outcomes = [
      ['passed', 'complete', 'passed'],
      ['failed', 'complete', 'failed'],
      ['interrupted', 'cancelled', 'cancelled'],
      ['timedOut', 'timed_out', 'timed_out'],
      ['runner_lost', 'runner_lost', 'runner_lost'],
      ['infra_failed', 'infra_failed', 'infra_failed'],
      ['config_failed', 'config_failed', 'config_failed'],
      ['blocked', 'blocked', 'blocked'],
      ['partial', 'partial', 'partial'],
      ['future', 'complete', 'unknown'],
    ] as const;
    for (const [status, phase, outcome] of outcomes) {
      const result = adapt({
        type: 'run:end',
        runId: 'external-run-5',
        payload: { status },
      });
      expect(result.payload).toMatchObject({ phase, outcome });
    }
    const detailed = adapt({
      type: 'run:end',
      runId: 'external-run-5',
      payload: {
        result: { status: 'failed' },
        summary: { total: 3, passed: 1, failed: 1, flaky: 1, durationMs: 400 },
        errorMessage: 'One product test failed',
        artifactIds: ['report-1'],
      },
    });
    expect(detailed.payload).toMatchObject({
      outcome: 'failed',
      error: { code: 'legacy_error', message: 'One product test failed' },
      summary: { total: 3, passed: 1, failed: 1, flaky: 1, skipped: 0, unknown: 0 },
      artifactIds: ['report-1'],
    });
    const flatCounts = adapt({
      type: 'run:end',
      runId: 'external-run-5',
      payload: { total: 3, passed: 1, failed: 1, flaky: 1, duration: 50 },
    });
    expect(flatCounts.payload).toMatchObject({
      summary: { total: 3, passed: 1, failed: 1, flaky: 1, durationMs: 50 },
    });
    const defaultedCounts = adapt({
      type: 'run:end',
      runId: 'external-run-5',
      payload: { summary: { total: 1 } },
    });
    expect(defaultedCounts.payload).toMatchObject({
      summary: { total: 1, passed: 0, failed: 0, flaky: 0, durationMs: null },
    });
  });

  it('keeps unknown evidence unknown and supplies a timestamp when none exists', () => {
    const before = Date.now();
    const result = legacyReporterAdapter(
      { type: 'run:end', runId: 'external-run-6', error: null },
      { runId: 'canonical-run-6', sequence: 9 },
    );
    expect(result.payload).toMatchObject({ phase: 'complete', outcome: 'unknown' });
    expect(Date.parse(result.occurredAt)).toBeGreaterThanOrEqual(before);
    expect(result.type).toBe('run.completed');
    if (result.type === 'run.completed') {
      expect(result.payload.summary).toBeUndefined();
    }
  });

  it('rejects missing test IDs, unsupported versions, and invalid context', () => {
    expect(() => adapt({ type: 'test:begin', runId: 'external-run-7' })).toThrow(
      'Legacy test event requires testId',
    );
    expect(() => adapt({ type: 'test:end', runId: 'external-run-7', payload: {} })).toThrow(
      'Legacy test event requires testId',
    );
    expect(() =>
      adapt({
        type: 'run:start',
        runId: 'external-run-7',
        version: '2',
      } as unknown as LegacyReporterEventInput),
    ).toThrow();
    expect(() =>
      adapt({
        type: 'run:start',
        runId: 'external-run-7',
        contractVersion: '2',
      } as unknown as LegacyReporterEventInput),
    ).toThrow();
    expect(() => adapt({ type: 'unknown', runId: 'external-run-7' } as never)).toThrow();
    expect(() =>
      legacyReporterAdapter(
        { type: 'run:start', runId: 'external-run-7', timestamp: 'invalid' },
        context,
      ),
    ).toThrow();
    expect(LegacyReporterAdapterContextSchema.safeParse({ ...context, sequence: 0 }).success).toBe(
      false,
    );
    expect(
      LegacyReporterAdapterContextSchema.safeParse({ ...context, occurredAt: 'invalid' }).success,
    ).toBe(false);
  });
});
