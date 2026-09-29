import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogRecord } from './logger.js';

/**
 * Collected records, so a test asserts on structure rather than on stdout.
 *
 * `createLogger` is given this instead of a stream, which is the same seam
 * production uses for its destination and the reason a test can read a line at all.
 */
function capture(): { sink: (record: LogRecord) => void; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { sink: (record) => records.push(record), records };
}

describe('the structured logger', () => {
  it('emits one object per line, with the record already shaped', () => {
    // A logger that hands a message plus a loose context to `console.error` is the
    // thing this replaces. Its output is not parseable, so a deployment's only
    // option for "show me every failure with code NOT_FOUND" is to read lines.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });

    log.error('request failed', { requestId: 'r-1', path: '/api/v1/runs', status: 500 });

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({
      level: 'error',
      msg: 'request failed',
      service: 'automate-api',
      requestId: 'r-1',
      path: '/api/v1/runs',
      status: 500,
    });
    // And it round-trips: a JSON line per record is what makes it queryable.
    expect(JSON.parse(JSON.stringify(record))).toMatchObject({ level: 'error' });
  });

  it('stamps time, level, and service on every record, whatever the caller passes', () => {
    // `level`, `msg`, and `service` are the record's identity, so a caller
    // supplying them would be able to forge the first two — and a log that can be
    // relabelled is a log that cannot be alerted on.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });

    log.warn('odd', { level: 'error', msg: 'forged', service: 'somebody-else' });

    const record = records[0];
    expect(record?.level).toBe('warn');
    expect(record?.msg).toBe('odd');
    expect(record?.service).toBe('automate-api');
    expect(typeof record?.time).toBe('string');
    expect(Number.isNaN(Date.parse(record?.time ?? ''))).toBe(false);
  });

  it('does not let a caller reach a reserved field, and does not lose the message', () => {
    // Reserved keys live in a nested object rather than being dropped, so the
    // caller's value is still there to read and is clearly not the record's.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });

    log.info('hello', { time: 'not-a-date', level: 'nope' });

    const record = records[0];
    expect(record?.time).not.toBe('not-a-date');
    expect(record?.level).toBe('info');
    expect(record?.fields).toMatchObject({ time: 'not-a-date', level: 'nope' });
  });

  it('serialises an Error so the cause survives the line', () => {
    // `JSON.stringify(new Error('x'))` is `{}`. A failure log that silently loses
    // the message is worse than no log, because it looks like a log.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });

    log.error('boom', { error: new TypeError('bad input') });

    const record = records[0];
    expect(JSON.stringify(record)).toContain('bad input');
    expect((record?.['error'] as { name: string }).name).toBe('TypeError');
  });

  it('keeps an Error cause chain, and an array, in the line', () => {
    // Both are shapes that reach a failure log constantly and that a naive
    // serialiser drops: `cause` is where a wrapped error's real origin lives, and
    // an array is what a list of failed items arrives as.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });
    const root = new RangeError('socket closed');
    const wrapper = new TypeError('request failed', { cause: root });

    log.error('boom', { error: wrapper, failed: [{ name: 'a' }, { name: 'b' }] });

    const record = records[0];
    const serialised = JSON.stringify(record);
    expect(serialised).toContain('socket closed');
    expect(serialised).toContain('request failed');
    expect(record?.['failed']).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('survives a circular value instead of throwing while reporting a failure', () => {
    // The worst possible moment for a `TypeError` from inside the logger: the
    // request has already failed, and the failure handler is what throws. A log
    // that cannot log must still not break the error boundary.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;

    expect(() => log.error('boom', { context: circular })).not.toThrow();
    expect(records).toHaveLength(1);
    // The outer object is serialisable, so it survives with its shape intact; the
    // back-reference that closes the loop is what is replaced.
    expect(records[0]?.['context']).toEqual({ name: 'loop', self: '[circular]' });
  });

  it('keeps a failure inside the sink from becoming an unhandled rejection', () => {
    // A destination that throws must not take the request with it.
    const log = createLogger({
      sink: () => {
        throw new Error('destination down');
      },
      service: 'automate-api',
      onSinkError: vi.fn(),
    });
    expect(() => log.error('boom', {})).not.toThrow();
  });

  it('offers every level, and treats a missing context as no context', () => {
    // `debug` is the only level nothing in the application emits yet, and an
    // untested level is an unverified one — so it is called here rather than
    // left for the first person who needs it. The omitted-context form is the
    // other default the arrow functions carry.
    const { sink, records } = capture();
    const log = createLogger({ sink, service: 'automate-api' });

    log.debug('starting');
    log.info('');
    log.warn('slow', { ms: 900 });
    log.error('failed');

    expect(records.map((record) => record.level)).toEqual(['debug', 'info', 'warn', 'error']);
    expect(records[0]?.msg).toBe('starting');
    // A record with nothing but its identity still serialises, which is what a
    // log line with no context has to do rather than print `undefined`.
    expect(JSON.parse(JSON.stringify(records[1]))).toMatchObject({ level: 'info', msg: '' });
  });

  it('writes to stdout for a routine line and stderr for a diagnostic, by default', () => {
    // The conventional split, and the one a container runtime's log pipeline
    // expects: diagnostics on stderr, ordinary output on stdout, so a deploy can
    // route one and ignore the other.
    const stdout = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const log = createLogger({ service: 'automate-api' });
      log.info('routine');
      log.warn('odd');
      log.error('not routine');
      expect(stdout).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledTimes(2);
      expect(String(stdout.mock.calls[0]?.[0])).toContain('"level":"info"');
      expect(String(stderr.mock.calls[0]?.[0])).toContain('"level":"warn"');
      expect(String(stderr.mock.calls[1]?.[0])).toContain('"level":"error"');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
