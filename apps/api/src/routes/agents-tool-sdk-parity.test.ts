import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTIONS,
  AGENT_DOMAINS,
  createToolRegistry,
  toAgentProblem,
} from '@automate/tool-sdk';
import { createAgentRoutes } from './agents.js';

/**
 * `packages/tool-sdk` is the answer `agents.ts` will one day delegate to, so for as long as
 * both exist they must give the same one. This pins it from the route's side: whatever the
 * route sends today for a pair no adapter serves, the SDK's classification of that pair renders
 * to the same status and the same body, key for key.
 *
 * `agents.ts` dispatches through the SDK, so this holds by construction for every pair no
 * adapter serves. It stays as the pin on the wire: the status and the body, key for key, and
 * the intended differences (`browser.run` and `api.run` are served; the unserved browser and api
 * actions add a `reason`).
 */
describe('agents.ts and @automate/tool-sdk agree', () => {
  const app = createAgentRoutes();
  const registry = createToolRegistry();

  it('answers every pair no adapter serves with the 501 the SDK renders for it', async () => {
    let pairs = 0;
    for (const domain of AGENT_DOMAINS) {
      for (const action of AGENT_ACTIONS) {
        // The browser and api pairs are covered by their own route tests and the test below.
        if (domain === 'browser' || domain === 'api') continue;
        pairs += 1;
        const response = await app.request(`/api/v1/agents/${domain}/${action}`, {
          method: 'POST',
        });
        const dispatched = await registry.dispatch(domain, action, {});
        if (dispatched.ok) throw new Error(`${domain}.${action} dispatched with no adapter`);
        const problem = toAgentProblem(dispatched.failure);

        expect(response.status).toBe(problem.httpStatus);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toEqual(problem.body);
        expect(Object.keys(body)).toEqual(Object.keys(problem.body));
      }
    }
    expect(pairs).toBe(9);
  });

  it('answers the unserved browser and api actions with the SDK body plus the reason', async () => {
    for (const [domain, action] of [
      ['browser', 'scan'],
      ['browser', 'generate'],
      ['api', 'scan'],
      ['api', 'generate'],
    ] as const) {
      const response = await app.request(`/api/v1/agents/${domain}/${action}`, { method: 'POST' });
      const dispatched = await registry.dispatch(domain, action, {});
      if (dispatched.ok) throw new Error('dispatched');
      const problem = toAgentProblem(dispatched.failure);
      const { reason, ...rest } = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(problem.httpStatus);
      expect(rest).toEqual(problem.body);
      expect(typeof reason).toBe('string');
    }
  });

  it('answers an unknown domain and an unknown action with the SDK’s two 404s', async () => {
    for (const [domain, action] of [
      ['other', 'scan'],
      ['api', 'destroy'],
    ] as const) {
      const response = await app.request(`/api/v1/agents/${domain}/${action}`, { method: 'POST' });
      const dispatched = await registry.dispatch(domain, action, {});
      if (dispatched.ok) throw new Error('dispatched');
      const problem = toAgentProblem(dispatched.failure);
      expect(response.status).toBe(problem.httpStatus);
      expect(await response.json()).toEqual(problem.body);
    }
  });
});
