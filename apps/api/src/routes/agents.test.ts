import { describe, expect, it } from 'vitest';
import { createAgentRoutes } from './agents.js';

describe('agent maturity routes', () => {
  it('reports configured domains without claiming execution', async () => {
    const app = createAgentRoutes();
    const listing = await app.request('/api/v1/agents');
    expect(listing.status).toBe(200);
    const body = (await listing.json()) as {
      integrations: Array<{ status: string; implemented: boolean }>;
    };
    expect(body.integrations).toHaveLength(5);
    expect(
      body.integrations.every((item) => item.status === 'not_configured' && !item.implemented),
    ).toBe(true);

    const known = await app.request('/api/v1/agents/browser/scan', { method: 'POST' });
    expect(known.status).toBe(501);
    expect((await known.json()) as { implemented: boolean }).toMatchObject({ implemented: false });

    const unknown = await app.request('/api/v1/agents/other/scan', { method: 'POST' });
    expect(unknown.status).toBe(404);
    const domain = await app.request('/api/v1/agents/other');
    expect(domain.status).toBe(404);
    const domainKnown = await app.request('/api/v1/agents/api');
    expect(domainKnown.status).toBe(501);
  });
});
