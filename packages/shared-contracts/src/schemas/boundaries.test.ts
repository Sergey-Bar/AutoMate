import { describe, expect, it } from 'vitest';
import { isAdminPermission } from './auth.js';
import { RunResultSchema } from './canonical-reporting.js';
import { CopilotSuggestionSchema, DraftedFileSchema } from './copilot.js';
import {
  toDurableSseEventName,
  toDurableSseFrame,
  type DurableSseRecord,
} from './durable-realtime.js';

/**
 * Boundary cases found by mutation testing (`pnpm mutation`). Each block names the
 * mutant it was written to kill, so a reader can tell the assertion from decoration.
 */

describe('isAdminPermission', () => {
  // `packages/auth` exercised this through its own suite, but nothing inside this
  // package did, so every branch of it was uncovered here: the mutation run reported ten
  // NoCoverage mutants on a function that decides who is an administrator.
  it.each(['admin', 'admin:all'])('accepts the %s spelling', (value) => {
    expect(isAdminPermission(value)).toBe(true);
  });

  it.each(['', 'ADMIN', 'Admin:All', 'admin:', 'admin:read', 'administer', ' admin', 'runs:read'])(
    'refuses %j',
    (value) => {
      expect(isAdminPermission(value)).toBe(false);
    },
  );
});

describe('a drafted file path is repo-relative, in each of the ways it can fail', () => {
  const file = { content: 'x', covers: ['f1'] };
  const check = (path: string) => DraftedFileSchema.safeParse({ ...file, path });

  it('accepts an ordinary nested path, and a colon that is not a drive letter', () => {
    expect(check('tests/regression/a.test.ts').success).toBe(true);
    // `^[A-Za-z]:` survived as the unanchored `[A-Za-z]:`, which refuses this.
    expect(check('tests/a:b.test.ts').success).toBe(true);
  });

  it.each(['/etc/passwd', '\\etc\\passwd', '\\share'])('refuses the absolute path %j', (path) => {
    const result = check(path);
    expect(result.success).toBe(false);
  });

  it.each(['C:/windows/x.ts', 'c:relative.ts', 'D:\\x.ts'])('refuses the drive path %j', (path) => {
    expect(check(path).success).toBe(false);
  });

  it('refuses a backslash separator even with no drive letter', () => {
    // `&&` survived as `||`, which accepted any path that lacked a drive letter.
    expect(check('tests\\a.test.ts').success).toBe(false);
  });

  it('refuses traversal and names why', () => {
    const result = check('tests/../../etc/passwd');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      'path must not traverse out of the repository',
    );
  });

  it('says which rule an absolute path broke', () => {
    const issues = check('/etc/passwd').error?.issues ?? [];
    expect(issues.map((issue) => issue.message)).toContain(
      'path must be repo-relative, not absolute',
    );
    const drive = check('C:/x.ts').error?.issues ?? [];
    expect(drive.map((issue) => issue.message)).toContain(
      'path must use POSIX separators and carry no drive letter',
    );
  });
});

describe('a copilot suggestion reports a misplaced payload against the field that is misplaced', () => {
  const base = {
    kind: 'add-missing-suite',
    what: 'Add a unit suite.',
    why: 'unit:backend has presence 0.',
    target: 'unit:backend',
    impact: -1,
    evidence: [{ kind: 'cell', id: 'unit:backend', summary: 'presence 0' }],
    overrides: { version: 1 },
    confidence: 1,
  };

  it('points at `draft`, with the reason', () => {
    const result = CopilotSuggestionSchema.safeParse({
      ...base,
      draft: [{ path: 'tests/a.ts', content: 'x', covers: ['f1'] }],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['draft'],
        message: 'a draft is only meaningful on a draft-regression-suite suggestion',
      }),
    ]);
  });

  it('points at `plain`, with the reason', () => {
    const result = CopilotSuggestionSchema.safeParse({
      ...base,
      plain: { readAloud: 'We score 0.', plainTotal: 0, citedCells: ['unit:backend'] },
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['plain'],
        message: 'a plain explanation is only meaningful on an explain-for-stakeholder suggestion',
      }),
    ]);
  });
});

describe('RunResultSchema attempt numbering', () => {
  const timestamp = '2026-09-25T00:00:00.000Z';
  const digest = 'a'.repeat(64);
  const attempt = (testId: string, index: number) => ({
    index,
    testId,
    specPath: 'tests/example.spec.ts',
    title: 'example test',
    status: 'passed' as const,
    rawStatus: 'passed',
    startedAt: timestamp,
    finishedAt: timestamp,
    evidence: [],
    flakiness: 'unknown' as const,
  });
  const result = (attempts: ReturnType<typeof attempt>[]) => ({
    contractVersion: '2' as const,
    identity: { runId: 'run-1', workspaceId: 'workspace-1' },
    status: 'passed' as const,
    startedAt: timestamp,
    finishedAt: timestamp,
    attempts,
    steps: [],
    evidence: [],
    provenance: {
      producer: 'playwright' as const,
      producerVersion: '1.0.0',
      adapterVersion: '1.0.0',
      sourceDigest: digest,
      sourceUri: 'artifact://run-1/report.json',
    },
    retention: { class: 'standard' as const },
    proof: { state: 'verified' as const, digest, verifier: 'test' },
    completeness: { state: 'complete' as const, missingShards: [], duplicateShards: [] },
    raw: {},
  });

  it('accepts attempts that arrive out of order, however many there are', () => {
    // The comparator `a - b` survived as `a + b`, which only misorders three or more.
    const shuffled = [attempt('t', 3), attempt('t', 1), attempt('t', 4), attempt('t', 2)];
    expect(RunResultSchema.safeParse(result(shuffled)).success).toBe(true);
  });

  it('names the test, the expected range and what arrived, against `attempts`', () => {
    const parsed = RunResultSchema.safeParse(
      result([attempt('tests/a:dup', 2), attempt('tests/a:dup', 2)]),
    );
    const issue = parsed.error?.issues.find((candidate) =>
      candidate.message.includes('tests/a:dup'),
    );
    expect(issue?.path).toEqual(['attempts']);
    expect(issue?.message).toContain('must be numbered 1..2 with no gap and no repeat');
    expect(issue?.message).toContain('got [2, 2]');
  });
});

describe('the durable SSE frame', () => {
  const record = (overrides: Partial<DurableSseRecord>): DurableSseRecord => ({
    sequence: 5,
    eventId: 'outer-id',
    eventVersion: 1,
    eventType: 'run:updated',
    occurredAt: new Date('2026-10-01T00:00:00.000Z'),
    payload: { runId: 'run-1' },
    ...overrides,
  });

  it('names an event from its own type, and ignores a nested type unless it is the wrapper', () => {
    // `eventType === 'execution.event.appended'` survived as `true`: any record whose
    // payload happened to carry a `type` was renamed by it.
    expect(toDurableSseEventName('run:updated', { type: 'run.completed' })).toBe(
      'run.phase_changed',
    );
    expect(toDurableSseEventName('execution.event.appended', { type: 'run.completed' })).toBe(
      'run.completed',
    );
    expect(toDurableSseEventName('execution.event.appended', { type: 'nonsense' })).toBe('message');
    expect(toDurableSseEventName('something.unknown')).toBe('message');
  });

  it('a plain record reports its own id, sequence, time and payload, not a nested look-alike', () => {
    const frame = toDurableSseFrame(
      record({
        payload: {
          runId: 'run-1',
          eventId: 'inner-id',
          sequence: 99,
          occurredAt: 'inner-time',
          payload: { shadow: true },
          type: 'run.completed',
        },
      }),
    );
    expect(frame.event).toBe('run.phase_changed');
    expect(frame.data).toMatchObject({
      version: 1,
      type: 'run.phase_changed',
      eventId: 'outer-id',
      sequence: 5,
      occurredAt: '2026-10-01T00:00:00.000Z',
      runId: 'run-1',
    });
    // The payload is the record's own payload, wrapper fields and all - not the nested one.
    expect(frame.data['payload']).toMatchObject({ eventId: 'inner-id', sequence: 99 });
    expect(frame.data['payload']).not.toEqual({ shadow: true });
  });

  it('an appended record reports the nested id, sequence, time and payload', () => {
    const frame = toDurableSseFrame(
      record({
        eventType: 'execution.event.appended',
        payload: {
          runId: 'run-1',
          type: 'run.completed',
          eventId: 'inner-id',
          sequence: 99,
          occurredAt: 'inner-time',
          payload: { detail: 1 },
        },
      }),
    );
    expect(frame.data).toMatchObject({
      type: 'run.completed',
      eventId: 'inner-id',
      sequence: 99,
      occurredAt: 'inner-time',
      payload: { detail: 1 },
    });
  });

  it('falls back to the record when the nested fields are the wrong type or shape', () => {
    for (const nestedPayload of [null, 'text', 7, ['array']]) {
      const frame = toDurableSseFrame(
        record({
          eventType: 'execution.event.appended',
          payload: {
            runId: 'run-1',
            type: 'run.completed',
            eventId: 5,
            sequence: '99',
            occurredAt: 12,
            payload: nestedPayload,
          },
        }),
      );
      expect(frame.data).toMatchObject({
        eventId: 'outer-id',
        sequence: 5,
        occurredAt: '2026-10-01T00:00:00.000Z',
      });
      expect(frame.data['payload']).toMatchObject({ runId: 'run-1', type: 'run.completed' });
    }
  });

  it('reports an unrecognised appended type as itself, never as a phase change', () => {
    const frame = toDurableSseFrame(
      record({
        eventType: 'execution.event.appended',
        payload: { runId: 'run-1', type: 'vendor.custom' },
      }),
    );
    expect(frame.event).toBe('message');
    expect(frame.data['type']).toBe('vendor.custom');
    const bare = toDurableSseFrame(
      record({ eventType: 'execution.event.appended', payload: { runId: 'r', type: '' } }),
    );
    expect(bare.data['type']).toBe('execution.event.appended');
  });
});
