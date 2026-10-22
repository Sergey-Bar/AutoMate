import { describe, expect, it } from 'vitest';
import { ToolCancelledError, ToolTimeoutError } from './errors.js';
import { raceAbort } from './abort.js';

describe('raceAbort', () => {
  it('passes the value through when there is no signal', async () => {
    await expect(raceAbort(Promise.resolve(7), undefined)).resolves.toBe(7);
    await expect(raceAbort(Promise.reject(new Error('x')), undefined)).rejects.toThrow('x');
  });

  it('passes the value or the failure through while the signal stays quiet', async () => {
    const controller = new AbortController();
    await expect(raceAbort(Promise.resolve('v'), controller.signal)).resolves.toBe('v');
    await expect(raceAbort(Promise.reject(new Error('boom')), controller.signal)).rejects.toThrow(
      'boom',
    );
  });

  it('rejects as a timeout when the deadline fires, even if the work never settles', async () => {
    const controller = new AbortController();
    const pending = raceAbort(new Promise<never>(() => undefined), controller.signal);
    controller.abort(new DOMException('Timed out after 5 ms', 'TimeoutError'));
    await expect(pending).rejects.toBeInstanceOf(ToolTimeoutError);
  });

  it('rejects as a cancellation when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = raceAbort(new Promise<never>(() => undefined), controller.signal);
    controller.abort('stop');
    await expect(pending).rejects.toBeInstanceOf(ToolCancelledError);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(raceAbort(Promise.resolve(1), controller.signal)).rejects.toBeInstanceOf(
      ToolCancelledError,
    );
    // And work that fails after being abandoned is swallowed rather than left unhandled.
    await expect(
      raceAbort(Promise.reject(new Error('late')), controller.signal),
    ).rejects.toBeInstanceOf(ToolCancelledError);
  });

  it('does not leak an unhandled rejection from work that fails after the race is lost', async () => {
    const controller = new AbortController();
    let fail: (error: Error) => void = () => undefined;
    const work = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const pending = raceAbort(work, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ToolCancelledError);
    fail(new Error('late'));
    await Promise.resolve();
  });
});
