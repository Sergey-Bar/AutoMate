import { describe, expect, it } from 'vitest';
import { AgentAcceptedRunSchema, AgentDomainSchema } from '@automate/shared-contracts';
import { createToolRegistry, toAgentProblem } from '@automate/tool-sdk';
import { registerBrowserAgent } from '../agents/browser-adapter.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { createAgentCatalog } from './agent-registry.js';
import { createAgentRoutes } from './agents.js';
import { createExecutionRoutes } from './execution.js';
import { createHealthRoutes } from './health.js';

const VALID = { project: 'smoke-pass', targetUrl: 'http://127.0.0.1:3000' };

function compose(workspaceId = 'ws-a', store = new InMemoryExecutionStore()) {
  const registry = createToolRegistry();
  registerBrowserAgent({ registry, store, workspaceId, requireIdempotencyKey: false });
  return {
    store,
    registry,
    agents: createAgentRoutes({ registry }),
    runs: createExecutionRoutes({ store, workspaceId }),
  };
}

function post(app: {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
}) {
  return (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describe('POST /api/v1/agents/browser/run', () => {
  it('answers 202 with a Location, and the run is readable through the runs API', async () => {
    const { agents, runs } = compose();
    const response = await post(agents)('/api/v1/agents/browser/run', VALID);

    expect(response.status).toBe(202);
    const accepted = AgentAcceptedRunSchema.parse(await response.json());
    expect(response.headers.get('location')).toBe(`/api/v1/runs/${accepted.runId}`);

    const read = await runs.request(accepted.links.run);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: accepted.runId,
      phase: 'queued',
      outcome: null,
    });
    const listed = (await (await runs.request('/api/v1/runs')).json()) as Array<{ id: string }>;
    expect(listed.map((run) => run.id)).toContain(accepted.runId);
  });

  it('does not wait for the run to finish', async () => {
    const { agents } = compose();
    const started = Date.now();
    const response = await post(agents)('/api/v1/agents/browser/run', VALID);
    expect(response.status).toBe(202);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('takes the Idempotency-Key header and replays the same run', async () => {
    const { agents, store } = compose();
    const headers = { 'idempotency-key': 'header-key' };
    const first = AgentAcceptedRunSchema.parse(
      await (await post(agents)('/api/v1/agents/browser/run', VALID, headers)).json(),
    );
    const second = AgentAcceptedRunSchema.parse(
      await (await post(agents)('/api/v1/agents/browser/run', VALID, headers)).json(),
    );
    expect(second).toMatchObject({ runId: first.runId, duplicate: true });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(1);
  });

  it('refuses a malformed request with the 400 body shape and queues nothing', async () => {
    const { agents, store } = compose();
    const response = await post(agents)('/api/v1/agents/browser/run', { project: '--ui' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 'invalid_input',
      implemented: true,
      code: 'AGENT_INVALID_INPUT',
      domain: 'browser',
      action: 'run',
    });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('refuses an empty body and a body that is not JSON, both as invalid input', async () => {
    const { agents } = compose();
    expect((await post(agents)('/api/v1/agents/browser/run')).status).toBe(400);
    const garbled = await agents.request('/api/v1/agents/browser/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(garbled.status).toBe(400);
  });

  it('refuses an oversized body as invalid input without queueing anything', async () => {
    const { agents, store } = compose();
    const response = await post(agents)('/api/v1/agents/browser/run', {
      ...VALID,
      branch: 'x'.repeat(70_000),
    });
    expect(response.status).toBe(400);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('a run created for one workspace is invisible to the runs API of another', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose('ws-a', store);
    const b = compose('ws-b', store);
    const accepted = AgentAcceptedRunSchema.parse(
      await (await post(a.agents)('/api/v1/agents/browser/run', VALID)).json(),
    );
    expect(
      (await (await b.runs.request('/api/v1/runs')).json()) as unknown[],
      "ws-b's run list must not contain ws-a's run",
    ).toEqual([]);
    expect(await store.getRun(accepted.runId, 'ws-b')).toBeNull();
    expect(((await (await a.runs.request('/api/v1/runs')).json()) as unknown[]).length).toBe(1);
  });
});

describe('the other browser actions and the other domains', () => {
  it('keeps browser.scan and browser.generate at 501 and says why', async () => {
    const { agents } = compose();
    for (const action of ['scan', 'generate']) {
      const response = await post(agents)(`/api/v1/agents/browser/${action}`, VALID);
      expect(response.status).toBe(501);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'not_configured',
        implemented: false,
        code: 'AGENT_NOT_CONFIGURED',
        domain: 'browser',
        action,
      });
      expect(String(body['reason']).length).toBeGreaterThan(20);
      expect(Object.keys(body).slice(0, 3)).toEqual(['status', 'implemented', 'code']);
    }
  });

  it('keeps api, load, security and mobile at the SDK’s 501, byte for byte', async () => {
    const { agents, registry } = compose();
    for (const domain of ['api', 'load', 'security', 'mobile']) {
      for (const action of ['generate', 'run', 'scan']) {
        const response = await post(agents)(`/api/v1/agents/${domain}/${action}`, {});
        const dispatched = await registry.dispatch(domain, action, {});
        if (dispatched.ok) throw new Error('dispatched');
        const problem = toAgentProblem(dispatched.failure);
        expect(response.status).toBe(501);
        expect(await response.json()).toEqual(problem.body);
      }
    }
  });
});

describe('availability is read from the registry', () => {
  it('/api/v1/agents reports browser configured and implemented, the rest not', async () => {
    const { agents } = compose();
    const listing = (await (await agents.request('/api/v1/agents')).json()) as {
      integrations: Array<{
        domain: string;
        status: string;
        implemented: boolean;
        actions?: string[];
      }>;
    };
    expect(listing.integrations.map((item) => item.domain)).toEqual(AgentDomainSchema.options);
    const browser = listing.integrations.find((item) => item.domain === 'browser');
    expect(browser).toEqual({
      domain: 'browser',
      status: 'configured',
      implemented: true,
      actions: ['run'],
    });
    for (const item of listing.integrations.filter((entry) => entry.domain !== 'browser')) {
      expect(item).toEqual({ domain: item.domain, status: 'not_configured', implemented: false });
    }
  });

  it('GET /api/v1/agents/browser describes the domain instead of refusing it', async () => {
    const { agents } = compose();
    const response = await agents.request('/api/v1/agents/browser');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      domain: 'browser',
      status: 'configured',
      implemented: true,
      actions: ['run'],
    });
    expect((await agents.request('/api/v1/agents/api')).status).toBe(501);
  });

  it('/api/v1/features is derived from the same registry', async () => {
    const { registry } = compose();
    const health = createHealthRoutes({
      agentAvailability: createAgentCatalog(registry).available,
    });
    const body = (await (await health.request('/api/v1/features')).json()) as {
      features: Record<string, boolean>;
    };
    expect(body.features).toEqual({
      'agent.browser': true,
      'agent.api': false,
      'agent.load': false,
      'agent.security': false,
      'agent.mobile': false,
    });
  });

  it('with nothing registered every domain is unavailable and browser.run answers 501', async () => {
    const registry = createToolRegistry();
    const agents = createAgentRoutes({ registry });
    const response = await post(agents)('/api/v1/agents/browser/run', VALID);
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ code: 'AGENT_NOT_CONFIGURED' });
    const catalog = createAgentCatalog(registry);
    expect(AgentDomainSchema.options.some((domain) => catalog.available(domain))).toBe(false);
  });
});
