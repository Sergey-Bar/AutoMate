import { describe, expect, it } from 'vitest';
import {
  AgentAcceptedRunSchema,
  AgentDomainSchema,
  LOAD_MAX_DURATION_SECONDS,
  LOAD_MAX_VUS,
} from '@automate/shared-contracts';
import { createToolRegistry } from '@automate/tool-sdk';
import { registerBrowserAgent } from '../agents/browser-adapter.js';
import { registerLoadAgent } from '../agents/load-adapter.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { createAgentCatalog } from './agent-registry.js';
import { createAgentRoutes } from './agents.js';
import { createExecutionRoutes } from './execution.js';
import { createHealthRoutes } from './health.js';

const VALID = { script: 'smoke.js', targetUrl: 'http://127.0.0.1:3000' };

function compose(workspaceId = 'ws-a', store = new InMemoryExecutionStore()) {
  const registry = createToolRegistry();
  registerBrowserAgent({ registry, store, workspaceId, requireIdempotencyKey: false });
  registerLoadAgent({ registry, store, workspaceId, requireIdempotencyKey: false });
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

describe('POST /api/v1/agents/load/run', () => {
  it('answers 202 with a Location, and the queued run and job are visible', async () => {
    const { agents, runs, store } = compose();
    const response = await post(agents)('/api/v1/agents/load/run', {
      ...VALID,
      vus: 5,
      durationSeconds: 20,
    });

    expect(response.status).toBe(202);
    const accepted = AgentAcceptedRunSchema.parse(await response.json());
    expect(accepted.domain).toBe('load');
    expect(response.headers.get('location')).toBe(`/api/v1/runs/${accepted.runId}`);

    const read = await runs.request(accepted.links.run);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ id: accepted.runId, phase: 'queued', outcome: null });
    expect(await store.getJob(accepted.jobId, 'ws-a')).toMatchObject({
      state: 'queued',
      requiredCapabilities: ['k6'],
    });
  });

  it('takes the Idempotency-Key header and replays the same run', async () => {
    const { agents, store } = compose();
    const headers = { 'idempotency-key': 'load-key' };
    const first = AgentAcceptedRunSchema.parse(
      await (await post(agents)('/api/v1/agents/load/run', VALID, headers)).json(),
    );
    const second = AgentAcceptedRunSchema.parse(
      await (await post(agents)('/api/v1/agents/load/run', VALID, headers)).json(),
    );
    expect(second).toMatchObject({ runId: first.runId, duplicate: true });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(1);
  });

  it.each([
    ['too many VUs', { ...VALID, vus: LOAD_MAX_VUS + 1 }],
    ['too long a duration', { ...VALID, durationSeconds: LOAD_MAX_DURATION_SECONDS + 1 }],
    ['a script outside the root', { ...VALID, script: '../x.js' }],
    ['an arbitrary command', { ...VALID, command: ['id'] }],
  ])('refuses %s with the 400 body shape and queues nothing', async (_name, body) => {
    const { agents, store } = compose();
    const response = await post(agents)('/api/v1/agents/load/run', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 'invalid_input',
      implemented: true,
      code: 'AGENT_INVALID_INPUT',
      domain: 'load',
      action: 'run',
    });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('a run created for one workspace is invisible to the runs API of another', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose('ws-a', store);
    const b = compose('ws-b', store);
    const accepted = AgentAcceptedRunSchema.parse(
      await (await post(a.agents)('/api/v1/agents/load/run', VALID)).json(),
    );
    expect((await (await b.runs.request('/api/v1/runs')).json()) as unknown[]).toEqual([]);
    expect(await store.getJob(accepted.jobId, 'ws-b')).toBeNull();
    expect(((await (await a.runs.request('/api/v1/runs')).json()) as unknown[]).length).toBe(1);
  });
});

describe('load.scan and load.generate', () => {
  it('stay at 501 and say why', async () => {
    const { agents } = compose();
    for (const action of ['scan', 'generate']) {
      const response = await post(agents)(`/api/v1/agents/load/${action}`, VALID);
      expect(response.status).toBe(501);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'not_configured',
        implemented: false,
        code: 'AGENT_NOT_CONFIGURED',
        domain: 'load',
        action,
      });
      expect(String(body['reason']).length).toBeGreaterThan(20);
    }
  });
});

describe('availability is read from the registry', () => {
  it('/api/v1/agents reports load configured with run only', async () => {
    const { agents } = compose();
    const listing = (await (await agents.request('/api/v1/agents')).json()) as {
      integrations: Array<{ domain: string; status: string; implemented: boolean }>;
    };
    expect(listing.integrations.map((item) => item.domain)).toEqual(AgentDomainSchema.options);
    expect(listing.integrations.find((item) => item.domain === 'load')).toEqual({
      domain: 'load',
      status: 'configured',
      implemented: true,
      actions: ['run'],
    });
  });

  it('/api/v1/features reports agent.load true', async () => {
    const { registry } = compose();
    const health = createHealthRoutes({
      agentAvailability: createAgentCatalog(registry).available,
    });
    const body = (await (await health.request('/api/v1/features')).json()) as {
      features: Record<string, boolean>;
    };
    expect(body.features['agent.load']).toBe(true);
    expect(body.features['agent.security']).toBe(false);
  });
});
