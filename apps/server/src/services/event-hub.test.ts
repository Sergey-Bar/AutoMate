import { describe, expect, it, vi } from 'vitest';
import { EventHub } from './event-hub.js';
import type { Logger } from './event-hub.js';

describe('EventHub', () => {
  it('broadcasts typed events to subscribers', () => {
    const hub = new EventHub();
    const events: unknown[] = [];
    hub.subscribe((event) => events.push(event));
    hub.broadcast({ type: 'connector:status', payload: { name: 'github', status: 'up' } });
    expect(events).toHaveLength(1);
  });

  it('unsubscribe stops delivery', () => {
    const hub = new EventHub();
    const events: unknown[] = [];
    const unsub = hub.subscribe((event) => events.push(event));
    unsub();
    hub.broadcast({ type: 'test', payload: {} });
    expect(events).toHaveLength(0);
  });

  // Mutation kill: constructor logger assignment — mutated to empty constructor {}
  it('stores logger passed to constructor', () => {
    const logger: Logger = { error: vi.fn() };
    const hub = new EventHub(logger);
    const err = new Error('boom');
    hub.subscribe(() => { throw err; });
    hub.broadcast({ type: 'test:event', payload: {} });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  // Mutation kill: if (this.logger) → if (true) / if (false); exact error message; logger.error object shape
  it('calls logger.error with exact message and correct object when listener throws and logger is present', () => {
    const logger: Logger = { error: vi.fn() };
    const hub = new EventHub(logger);
    const err = new Error('listener-failure');
    hub.subscribe(() => { throw err; });
    hub.broadcast({ type: 'my:event', payload: {} });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [obj, msg] = vi.mocked(logger.error).mock.calls[0] as [Record<string, unknown>, string];
    // Mutation kill: exact message string
    expect(msg).toBe('EventHub listener threw during broadcast');
    // Mutation kill: object contains err and eventType
    expect(obj).toMatchObject({ err, eventType: 'my:event' });
  });

  // Mutation kill: if (this.logger) → if (true) — logger must NOT be called when hub has no logger
  it('does not call any logger when EventHub is created without logger and listener throws', () => {
    const hub = new EventHub();
    // Just ensure no throw leaks to the test
    hub.subscribe(() => { throw new Error('no-logger'); });
    expect(() => hub.broadcast({ type: 'silent', payload: {} })).not.toThrow();
  });

  // Mutation kill: stderr fallback / else block removal — process.stderr.write called with non-empty message
  it('writes non-empty message to process.stderr when no logger is configured and listener throws', () => {
    const writespy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hub = new EventHub();
    const err = new Error('stderr-error');
    hub.subscribe(() => { throw err; });
    hub.broadcast({ type: 'stderr:test', payload: {} });

    expect(writespy).toHaveBeenCalledTimes(1);
    const written = writespy.mock.calls[0]?.[0];
    expect(typeof written).toBe('string');
    expect((written as string).length).toBeGreaterThan(0);
    writespy.mockRestore();
  });

  // Mutation kill: catch block removal — verify error is caught (no rethrow)
  it('does not rethrow errors from listeners — catch block must exist', () => {
    const hub = new EventHub();
    hub.subscribe(() => { throw new Error('catch-me'); });
    // Should not throw
    expect(() => hub.broadcast({ type: 'no:rethrow', payload: {} })).not.toThrow();
  });

  // Mutation kill: stderr write content — ensure the message includes error info and eventType
  it('stderr message includes error string and eventType when no logger configured', () => {
    const writespy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hub = new EventHub();
    const err = new Error('specific-error-msg');
    hub.subscribe(() => { throw err; });
    hub.broadcast({ type: 'type:check', payload: {} });

    const written = writespy.mock.calls[0]?.[0] as string;
    expect(written).toContain('specific-error-msg');
    expect(written).toContain('type:check');
    writespy.mockRestore();
  });
});
