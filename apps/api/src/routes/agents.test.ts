import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentDomainSchema, AgentRequestSchema } from '@automate/shared-contracts';
import { createAgentRoutes } from './agents.js';

/** The two sets the route used to hand-write, taken from the schemas that define them. */
const DOMAINS = AgentDomainSchema.options;
const ACTIONS = (AgentRequestSchema.shape.action as { options: string[] }).options;

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

  it('derives its allowlist from the contract rather than restating it', () => {
    // The route used to hand-write `new Set(['browser', 'api', 'load', 'security',
    // 'mobile'])` beside the `AgentDomainSchema` that defines exactly those five
    // values — in a route that serves them and never imports the schema. Adding a
    // domain to the contract would have left the endpoint rejecting it, and
    // nothing would have said so, because both files were individually correct.
    //
    // This is the same defect class the repository has already fixed twice ("the
    // event allowlist is derived").
    //
    // Asserted against the source rather than by comparing two lists: today the
    // hand-written set and the schema hold the same five values, so a
    // value-comparison test passes against exactly the code it is meant to catch.
    // What has to be true is the *provenance* — that there is no second copy to
    // drift.
    const source = readFileSync(path.join(import.meta.dirname, 'agents.ts'), 'utf8');
    expect(source).toMatch(/agent-registry/);
    expect(source).toMatch(/AgentRequestSchema\.shape/);
    // And no hand-written literal of the five values anywhere in the file.
    expect(source).not.toMatch(/new Set\(\s*\[\s*'browser'/);
  });

  it('serves the same domain set the contract declares', async () => {
    // The observable consequence of the derivation: the endpoint's answers are
    // the contract's, so a domain added to the schema is served without a second
    // edit here.
    const app = createAgentRoutes();
    const listing = (await (await app.request('/api/v1/agents')).json()) as {
      integrations: Array<{ domain: string }>;
    };
    expect(listing.integrations.map((item) => item.domain)).toEqual(DOMAINS);
  });

  it('accepts every domain/action pair the contract declares', async () => {
    // The derived sets, asserted against the contract rather than against a copy
    // of it: a 404 here means the route's allowlist no longer matches the schema.
    for (const domain of DOMAINS) {
      for (const action of ACTIONS) {
        const response = await createAgentRoutes().request(`/api/v1/agents/${domain}/${action}`, {
          method: 'POST',
        });
        expect(
          response.status,
          `${domain}.${action} must be a registered pair, not a 404`,
        ).not.toBe(404);
      }
    }
  });

  it('refuses an unregistered pair, and says which half is wrong', async () => {
    const app = createAgentRoutes();
    const badDomain = (await (
      await app.request('/api/v1/agents/other/scan', { method: 'POST' })
    ).json()) as { code: string; message: string };
    expect(badDomain.code).toBe('AGENT_ROUTE_NOT_FOUND');

    // A real domain with an action the contract does not declare. Previously this
    // returned the same opaque 404 as an unknown domain, so a caller could not
    // tell "I do not know this tool" from "that verb does not exist".
    const badAction = (await (
      await app.request('/api/v1/agents/browser/exfiltrate', { method: 'POST' })
    ).json()) as { code: string };
    expect(badAction.code).toBe('AGENT_ACTION_NOT_FOUND');
  });
});
