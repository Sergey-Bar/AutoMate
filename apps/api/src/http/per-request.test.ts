import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { perRequest } from './per-request.js';

/**
 * A lookup that runs once per request, however many checks ask for it — including a request
 * the workspace dispatch forwards, whole, to another workspace's composition.
 */
describe('perRequest', () => {
  it('loads once for one request, and again for the next', async () => {
    const load = vi.fn(async () => 'ana');
    const who = perRequest(load);
    const app = new Hono().get('/', async (context) =>
      context.json([await who(context), await who(context), await who(context)]),
    );
    expect(await (await app.request('/')).json()).toEqual(['ana', 'ana', 'ana']);
    expect(load).toHaveBeenCalledTimes(1);
    await app.request('/');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares the answer with the composition a request is forwarded to', async () => {
    const load = vi.fn(async () => 'ana');
    const who = perRequest(load);
    const inner = new Hono().get('/', async (context) => context.text(await who(context)));
    const outer = new Hono();
    outer.use('*', async (context) => {
      await who(context);
      return inner.fetch(context.req.raw);
    });
    expect(await (await outer.request('/')).text()).toBe('ana');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('gives every asker in a request the same failure, rather than retrying it', async () => {
    const load = vi.fn(async () => {
      throw new Error('the session store is down');
    });
    const who = perRequest(load);
    const app = new Hono().get('/', async (context) => {
      const outcomes = await Promise.allSettled([who(context), who(context)]);
      return context.json(outcomes.map((outcome) => outcome.status));
    });
    expect(await (await app.request('/')).json()).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
