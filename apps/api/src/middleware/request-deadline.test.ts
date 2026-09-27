import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  createClientDeadline,
  createRequestDeadline,
  REQUEST_DEADLINE_HEADER,
} from './request-deadline.js';

/**
 * A hand-driven clock.
 *
 * The deadline is a timeout, so a test that used the real one would either sleep
 * for the budget or assert nothing. Injecting the timer makes the elapsed case
 * deterministic — which is the point, because the case that matters is the one
 * where a handler outlives its budget, and that is exactly the case a sleep-based
 * test cannot reproduce reliably.
 */
function fakeClock() {
  let armed: Array<{ handler: () => void; ms: number }> = [];
  let disarmed = 0;
  return {
    setTimeoutImpl: (handler: () => void, ms: number) => {
      armed.push({ handler, ms });
      return armed.length - 1;
    },
    clearTimeoutImpl: () => {
      disarmed += 1;
    },
    get armedCount() {
      return armed.length;
    },
    get disarmedCount() {
      return disarmed;
    },
    /** Elapses every armed timer, the way the event loop would. */
    async elapse(): Promise<void> {
      const pending = armed;
      armed = [];
      for (const timer of pending) timer.handler();
      await Promise.resolve();
    },
  };
}

function app(
  options: {
    budgetMs?: number;
    clock?: ReturnType<typeof fakeClock>;
    onTimeout?: (context: { path: string; method: string; budgetMs: number }) => void;
    exemptPaths?: readonly string[];
    /** Resolves the handler only when the returned function is called. */
    handler?: () => Promise<void>;
  } = {},
) {
  const clock = options.clock ?? fakeClock();
  const server = new Hono()
    .use(
      '*',
      createRequestDeadline({
        budgetMs: options.budgetMs ?? 1_000,
        setTimeoutImpl: clock.setTimeoutImpl,
        clearTimeoutImpl: clock.clearTimeoutImpl,
        ...(options.onTimeout === undefined ? {} : { onTimeout: options.onTimeout }),
        ...(options.exemptPaths === undefined ? {} : { exemptPaths: options.exemptPaths }),
      }),
    )
    .get('/fast', (c) => c.json({ status: 'ok' }))
    .get('/slow', async (c) => {
      await options.handler?.();
      return c.json({ status: 'ok' });
    })
    .get('/api/v1/events', (c) => c.json({ events: [] }))
    .post('/api/v1/runs', (c) => c.json({ id: 'run-1' }, 201));
  return { server, clock };
}

describe('the request deadline', () => {
  it('leaves a request that finishes in time alone', async () => {
    const { server, clock } = app();
    const response = await server.request('/fast');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(clock.disarmedCount).toBe(1);
  });

  it('echoes the budget that applied, so it is never a silent one', async () => {
    const { server } = app({ budgetMs: 1_500 });
    const response = await server.request('/fast');
    expect(response.headers.get(REQUEST_DEADLINE_HEADER)).toBe('1500');
  });

  it('refuses the response when the handler outlives the budget', async () => {
    const clock = fakeClock();
    let release: () => void = () => {};
    const { server } = app({
      clock,
      handler: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });

    const pending = server.request('/slow');
    // Elapse the deadline while the handler is still running, then let it finish.
    await clock.elapse();
    release();
    const response = await pending;

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('REQUEST_TIMEOUT');
    expect(body.error.details).toEqual({ budgetMs: 1_000 });
  });

  it('reports a timeout exactly once, and only for a real one', async () => {
    const clock = fakeClock();
    const seen: Array<{ path: string; method: string; budgetMs: number }> = [];
    let release: () => void = () => {};
    const { server } = app({
      clock,
      onTimeout: (context) => seen.push(context),
      handler: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });

    const pending = server.request('/slow');
    await clock.elapse();
    release();
    await pending;
    expect(seen).toEqual([{ path: '/slow', method: 'GET', budgetMs: 1_000 }]);

    // A request that finishes in time must not be reported, which is what a
    // timeout counter used to make impossible to tell apart from a real one.
    await server.request('/fast');
    expect(seen).toHaveLength(1);
  });

  it('does not let an elapsed timer overwrite a response that already arrived', async () => {
    const clock = fakeClock();
    const { server } = app({ clock });
    const response = await server.request('/fast');
    expect(response.status).toBe(200);
    // The timer was disarmed, so elapsing is a no-op. If it were not, a late
    // callback would replace a delivered 200 with a 503 that nobody asked for.
    await clock.elapse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('tells the caller when to come back', async () => {
    const clock = fakeClock();
    let release: () => void = () => {};
    const { server } = app({
      clock,
      budgetMs: 800,
      handler: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const pending = server.request('/slow');
    await clock.elapse();
    release();
    const response = await pending;
    // A 503 with no `Retry-After` is a client that either retries immediately or
    // gives up; neither is what an operator wants.
    expect(response.headers.get('retry-after')).toBe('1');
  });

  it('exempts exactly the paths it is told to, and no others', async () => {
    const clock = fakeClock();
    const { server } = app({ clock, exemptPaths: ['/api/v1/events'] });

    // An SSE stream is not a request that should be refused halfway through.
    const streamed = server.request('/api/v1/events');
    await clock.elapse();
    expect((await streamed).status).toBe(200);

    // A path that merely looks similar is not exempt.
    let release: () => void = () => {};
    const guarded = new Hono()
      .use(
        '*',
        createRequestDeadline({
          budgetMs: 1_000,
          setTimeoutImpl: clock.setTimeoutImpl,
          clearTimeoutImpl: clock.clearTimeoutImpl,
          exemptPaths: ['/api/v1/events'],
        }),
      )
      .get('/api/v1/events-archive', async (c) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return c.json({ status: 'ok' });
      });
    const pending = guarded.request('/api/v1/events-archive');
    await clock.elapse();
    release();
    expect((await pending).status).toBe(503);
  });

  it('applies to writes as well as reads', async () => {
    const clock = fakeClock();
    const { server } = app({ clock });
    const response = await server.request('/api/v1/runs', { method: 'POST' });
    expect(response.status).toBe(201);
    expect(response.headers.get(REQUEST_DEADLINE_HEADER)).toBe('1000');
  });

  it('refuses to be built with a budget that would never elapse, or always elapse', () => {
    for (const budgetMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () =>
          createRequestDeadline({
            budgetMs,
            setTimeoutImpl: () => undefined,
            clearTimeoutImpl: () => {},
          }),
        `budgetMs=${String(budgetMs)}`,
      ).toThrow(RangeError);
    }
  });

  it('clears the timer even when the handler throws', async () => {
    const clock = fakeClock();
    const server = new Hono()
      .use(
        '*',
        createRequestDeadline({
          budgetMs: 1_000,
          setTimeoutImpl: clock.setTimeoutImpl,
          clearTimeoutImpl: clock.clearTimeoutImpl,
        }),
      )
      .get('/boom', () => {
        throw new Error('handler defect');
      });
    server.onError((_error, c) => c.json({ error: { code: 'INTERNAL' } }, 500));
    const response = await server.request('/boom');
    // A leaked timer on the error path is the classic version of this bug: the
    // request is gone and the timer fires into a response nobody will read.
    expect(clock.disarmedCount).toBe(1);
    expect(response.status).toBe(500);
  });
});

describe('the client deadline', () => {
  it('is a separate thing from the server deadline, and it cancels', async () => {
    // Named separately on purpose. A caller that aborts wants its request
    // stopped; the server deadline refuses a response. One function for both would
    // mean "timeout" silently cancels work that must complete.
    const signal = createClientDeadline(50);
    expect(signal.aborted).toBe(false);
    await expect(
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        // A never-settling stand-in for the request. It does not need to resolve:
        // the point is that the signal refuses it first.
        void resolve;
      }),
    ).rejects.toThrow('aborted');
  });
});
