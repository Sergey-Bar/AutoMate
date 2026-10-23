import { describe, expect, it } from 'vitest';
import { AgentAcceptedRunSchema } from '@automate/shared-contracts';
import { createToolRegistry } from '@automate/tool-sdk';
import { registerApiAgent } from '../agents/api-adapter.js';
import { registerBrowserAgent } from '../agents/browser-adapter.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { createAgentCatalog } from './agent-registry.js';
import { createAgentRoutes } from './agents.js';
import { createExecutionRoutes } from './execution.js';
import { createHealthRoutes } from './health.js';

const VALID = { collection: 'pass', environment: 'local', targetUrl: 'http://127.0.0.1:3000' };

function compose(workspaceId = 'ws-a', store = new InMemoryExecutionStore()) {
  const registry = createToolRegistry();
  registerBrowserAgent({ registry, store, workspaceId, requireIdempotencyKey: false });
  registerApiAgent({ registry, store, workspaceId, requireIdempotencyKey: false });
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
  return (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describe('POST /api/v1/agents/api/run', () => {
  it('answers 202 with a Location, and the job is readable through the runs API', async () => {
    const { agents, runs } = compose();
    const response = await post(agents)('/api/v1/agents/api/run', VALID);

    expect(response.status).toBe(202);
    const accepted = AgentAcceptedRunSchema.parse(await response.json());
    expect(accepted).toMatchObject({ domain: 'api', action: 'run', phase: 'queued' });
    expect(response.headers.get('location')).toBe(`/api/v1/runs/${accepted.runId}`);

    const read = await runs.request(accepted.links.run);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: accepted.runId,
      phase: 'queued',
      outcome: null,
      framework: 'bruno',
      testType: 'api',
    });
    const listed = (await (await runs.request('/api/v1/runs')).json()) as Array<{ id: string }>;
    expect(listed.map((run) => run.id)).toContain(accepted.runId);
  });

  it('refuses a command, a traversal and a missing target with the 400 body, queueing nothing', async () => {
    const { agents, store } = compose();
    for (const body of [
      { ...VALID, command: 'curl' },
      { ...VALID, collection: '../../etc' },
      { collection: 'pass' },
    ]) {
      const response = await post(agents)('/api/v1/agents/api/run', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        status: 'invalid_input',
        code: 'AGENT_INVALID_INPUT',
        domain: 'api',
        action: 'run',
      });
    }
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('a run created for one workspace is invisible to the runs API of another', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose('ws-a', store);
    const b = compose('ws-b', store);
    const accepted = AgentAcceptedRunSchema.parse(
      await (await post(a.agents)('/api/v1/agents/api/run', VALID)).json(),
    );

    expect((await (await b.runs.request('/api/v1/runs')).json()) as unknown[]).toEqual([]);
    expect(await store.getRun(accepted.runId, 'ws-b')).toBeNull();
    expect(await store.getJob(accepted.jobId, 'ws-b')).toBeNull();
    expect(((await (await a.runs.request('/api/v1/runs')).json()) as unknown[]).length).toBe(1);
  });
});

describe('the other api actions', () => {
  it('keeps api.scan and api.generate at 501 and says why', async () => {
    const { agents } = compose();
    for (const action of ['scan', 'generate']) {
      const response = await post(agents)(`/api/v1/agents/api/${action}`, VALID);
      expect(response.status).toBe(501);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'not_configured',
        implemented: false,
        code: 'AGENT_NOT_CONFIGURED',
        domain: 'api',
        action,
      });
      expect(String(body['reason']).length).toBeGreaterThan(20);
    }
  });
});

describe('availability is read from the registry', () => {
  it('/api/v1/agents reports api configured with only run', async () => {
    const { agents } = compose();
    const listing = (await (await agents.request('/api/v1/agents')).json()) as {
      integrations: Array<{ domain: string; status: string; actions?: string[] }>;
    };
    expect(listing.integrations.find((item) => item.domain === 'api')).toEqual({
      domain: 'api',
      status: 'configured',
      implemented: true,
      actions: ['run'],
    });
  });

  it('/api/v1/features is derived from the same registry', async () => {
    const { registry } = compose();
    const health = createHealthRoutes({
      agentAvailability: createAgentCatalog(registry).available,
    });
    const body = (await (await health.request('/api/v1/features')).json()) as {
      features: Record<string, boolean>;
    };
    expect(body.features['agent.api']).toBe(true);
    expect(body.features['agent.browser']).toBe(true);
    expect(body.features['agent.security']).toBe(false);
  });
});
