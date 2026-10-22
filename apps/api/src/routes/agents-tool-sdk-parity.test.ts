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
 * Nothing in `agents.ts` imports the SDK yet. A later change wires adapters through it; until
 * then this is the only thing that would notice the two drifting.
 */
describe('agents.ts and @automate/tool-sdk agree', () => {
  const app = createAgentRoutes();
  const registry = createToolRegistry();

  it('answers all 15 registered pairs with the 501 the SDK renders for an unregistered pair', async () => {
    let pairs = 0;
    for (const domain of AGENT_DOMAINS) {
      for (const action of AGENT_ACTIONS) {
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
    expect(pairs).toBe(15);
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
