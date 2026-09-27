import { createHash } from 'node:crypto';
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

/**
 * A digest of the run's outcome, for the field `DigestSchema` calls `resultDigest`.
 *
 * This was `'0'.repeat(64)` — a constant. `DigestSchema` only checks that the value is
 * 64 hex characters, so 64 zeros passed it, and every run in the installation produced
 * the same digest end to end. A digest that cannot distinguish two results is not a
 * digest: it made two different runs indistinguishable to anything downstream that
 * compared them, and it made a replayed event look like a fresh one.
 *
 * SHA-256 over a canonical serialisation of the legacy payload. Canonical means
 * key-sorted and nested, so the same outcome hashes the same however the producer
 * ordered its keys — a replay must not produce a different digest from the original,
 * or deduplication would treat a redelivery as a new result.
 *
 * @param payload the legacy `run:end` payload
 */
export function digestRunOutcome(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/**
 * JSON with every object's keys in sorted order, at any depth.
 *
 * `JSON.stringify` preserves insertion order, so two producers that assemble the same
 * object in a different order would hash differently. That is a digest that reports a
 * difference where there is none.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

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
        resultDigest: digestRunOutcome(payload),
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
