import {
  CanonicalReporterEventSchema,
  type CanonicalReporterEvent,
} from '@automate/shared-contracts';

const legacyTypes = new Set([
  'run:start',
  'run:end',
  'test:begin',
  'test:end',
  'step:begin',
  'step:end',
]);

export function normalizeLegacyEvent(
  input: unknown,
  context: {
    workspaceId: string;
    eventId: string;
    occurredAt: string;
  },
): CanonicalReporterEvent {
  if (!input || typeof input !== 'object') throw new Error('Legacy event must be an object');
  const value = input as Record<string, unknown>;
  const type = typeof value.type === 'string' ? value.type : '';
  if (!legacyTypes.has(type)) throw new Error(`Unsupported legacy event type: ${type}`);
  const payload =
    value.payload && typeof value.payload === 'object'
      ? (value.payload as Record<string, unknown>)
      : {};
  const runId = typeof value.runId === 'string' ? value.runId : '';
  const base = {
    contractVersion: '2' as const,
    eventId: context.eventId,
    occurredAt: context.occurredAt,
    runId,
    workspaceId: context.workspaceId,
  };
  if (type === 'run:start') {
    return CanonicalReporterEventSchema.parse({
      ...base,
      type: 'run.started',
      data: { runId, workspaceId: context.workspaceId },
    });
  }
  if (type === 'run:end') {
    return CanonicalReporterEventSchema.parse({
      ...base,
      type: 'run.completed',
      data: {
        status: payload.status === 'passed' ? 'passed' : 'failed',
        finishedAt: context.occurredAt,
        resultDigest: '0'.repeat(64),
      },
    });
  }
  const testId = typeof payload.testId === 'string' ? payload.testId : '';
  const attempt = {
    index: typeof payload.retry === 'number' ? payload.retry + 1 : 1,
    testId,
    specPath: typeof payload.file === 'string' ? payload.file : 'unknown.spec.ts',
    title: typeof payload.title === 'string' ? payload.title : testId,
    status:
      payload.status === 'passed' ? 'passed' : payload.status === 'failed' ? 'failed' : 'unknown',
    rawStatus: typeof payload.status === 'string' ? payload.status : 'unknown',
    startedAt: context.occurredAt,
    finishedAt: context.occurredAt,
    evidence: [],
    flakiness: 'unknown' as const,
  };
  return CanonicalReporterEventSchema.parse({
    ...base,
    type: type === 'test:begin' ? 'check.started' : 'check.completed',
    data:
      type === 'test:begin'
        ? { index: attempt.index, testId, specPath: attempt.specPath, title: attempt.title }
        : attempt,
  });
}
