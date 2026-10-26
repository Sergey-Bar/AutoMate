import { describe, expect, it, vi } from 'vitest';
import { HEALTH_DIMENSIONS, SCORECARD_IDS } from '@automate/shared-contracts';
import {
  makeAiCodeReport,
  makeAiPullRequests,
  makeComponentsPage,
  makeDatasets,
  makeDeliveryReport,
  makeDeliverySource,
  makeDiffCoverage,
  makeEvalRunDetail,
  makeMcpServers,
  makePolicyRecord,
  makePortfolioDelivery,
  makeProjectEvals,
  makeRuntimeReport,
  PROJECT_UUID,
} from '../test-utils.js';
import { createAgentsClient } from './agents-client.js';
import { createAiCodeClient } from './ai-code-client.js';
import { createDeliveryClient } from './delivery-client.js';
import { createHealthClient } from './health-client.js';
import { queryString } from './json-transport.js';
import { createSupplyChainClient } from './supply-chain-client.js';

/** A `fetch` double answering `body` and recording what was asked. */
function recorder(body: unknown, status = 200) {
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
  const call = (index = 0) => {
    const [input, init] = fetchImpl.mock.calls[index] ?? [];
    return {
      url: String(input),
      method: init?.method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      credentials: init?.credentials,
    };
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, call };
}

describe('the supply-chain client', () => {
  it('reads the inventory with its filters, and a page', async () => {
    const { fetchImpl, call } = recorder(makeComponentsPage());
    const page = await createSupplyChainClient('http://api', fetchImpl).getComponents('p 1', {
      type: 'library',
      licence: 'MIT',
      offset: 25,
      limit: 25,
      branch: undefined,
    });
    expect(page.components[0]?.purl).toBe('pkg:npm/react@19.0.0');
    expect(call()).toMatchObject({
      url: 'http://api/api/v1/projects/p%201/health/components?type=library&licence=MIT&offset=25&limit=25',
      method: 'GET',
      credentials: 'include',
    });
  });

  it('searches the portfolio by a trimmed purl prefix', async () => {
    const { fetchImpl, call } = recorder({ matches: [], total: 0, offset: 0, limit: 100 });
    await createSupplyChainClient('', fetchImpl).searchPortfolio('  pkg:npm/react ');
    expect(call().url).toBe('/api/v1/portfolio/components?purl=pkg%3Anpm%2Freact');
  });

  it('reads and saves the policy, and looks up diff coverage', async () => {
    const policy = makePolicyRecord();
    const { fetchImpl, call } = recorder(policy);
    const client = createSupplyChainClient('', fetchImpl);
    await client.getPolicy('p1');
    await client.setPolicy(
      'p1',
      policy.policy ?? {
        licences: { failOnUnknown: true },
        provenance: { trustedKeysPem: [], trustedRootsPem: [] },
      },
    );
    expect(call(0).url).toBe('/api/v1/projects/p1/health/supply-chain-policy');
    expect(call(1)).toMatchObject({ method: 'PUT', body: policy.policy });
    const diff = recorder(makeDiffCoverage());
    await createSupplyChainClient('', diff.fetchImpl).getDiffCoverage('p1', ' abcdef1 ');
    expect(diff.call().url).toBe('/api/v1/projects/p1/health/diff-coverage?commit=abcdef1');
  });

  it('says what the server said when it refuses', async () => {
    const { fetchImpl } = recorder({ error: { message: 'Only an admin can change it' } }, 403);
    await expect(
      createSupplyChainClient('', fetchImpl).setPolicy('p1', {
        licences: { failOnUnknown: true },
        provenance: { trustedKeysPem: [], trustedRootsPem: [] },
      }),
    ).rejects.toMatchObject({ status: 403, detail: 'Only an admin can change it' });
  });

  it('refuses a body that is not the contract', async () => {
    const { fetchImpl } = recorder({ branch: 'main' });
    await expect(createSupplyChainClient('', fetchImpl).getComponents('p1')).rejects.toMatchObject({
      detail: expect.stringContaining('did not match the expected shape') as string,
    });
  });
});

describe('the delivery client', () => {
  it('reads the report and the portfolio for a whole-day window', async () => {
    const { fetchImpl, call } = recorder(makeDeliveryReport());
    const report = await createDeliveryClient('', fetchImpl).getReport('p1', 30.7);
    expect(report.projectId).toBe(PROJECT_UUID);
    expect(call().url).toBe('/api/v1/projects/p1/delivery?days=30');
    const portfolio = recorder(makePortfolioDelivery());
    await createDeliveryClient('', portfolio.fetchImpl).getPortfolio(90);
    expect(portfolio.call().url).toBe('/api/v1/portfolio/delivery?days=90');
  });

  it('reads and saves the source, and queues a sync', async () => {
    const { fetchImpl, call } = recorder(makeDeliverySource());
    const client = createDeliveryClient('', fetchImpl);
    await client.getSource('p1');
    await client.setSource('p1', {
      enabled: true,
      cadence: 'hourly',
      productionEnvironments: ['production'],
      deployWorkflows: [],
    });
    expect(call(0).url).toBe('/api/v1/projects/p1/delivery/source');
    expect(call(1)).toMatchObject({ method: 'PUT', body: { cadence: 'hourly' } });
    const sync = recorder(
      { syncId: '33333333-3333-4333-8333-333333333333', duplicate: false, requestedBy: 'operator' },
      202,
    );
    const queued = await createDeliveryClient('', sync.fetchImpl).sync('p1');
    expect(queued.duplicate).toBe(false);
    expect(sync.call()).toMatchObject({ url: '/api/v1/projects/p1/delivery/sync', method: 'POST' });
  });
});

describe('the ai-code client', () => {
  it('reads the report, the pull requests by attribution, and the portfolio', async () => {
    const report = recorder(makeAiCodeReport());
    await createAiCodeClient('', report.fetchImpl).getReport('p1', 90);
    expect(report.call().url).toBe('/api/v1/projects/p1/ai-code?days=90');
    const list = recorder(makeAiPullRequests());
    await createAiCodeClient('', list.fetchImpl).getPullRequests('p1', {
      attribution: 'agent-authored',
      offset: 0,
      limit: 25,
    });
    expect(list.call().url).toBe(
      '/api/v1/projects/p1/ai-code/pull-requests?attribution=agent-authored&offset=0&limit=25',
    );
    const portfolio = recorder({
      windowDays: 90,
      evaluatedAt: '2026-10-23T12:00:00.000Z',
      projects: [],
    });
    await createAiCodeClient('', portfolio.fetchImpl).getPortfolio(30);
    expect(portfolio.call().url).toBe('/api/v1/portfolio/ai-code?days=30');
  });

  it('asks for every attribution when none is chosen', async () => {
    const list = recorder(makeAiPullRequests());
    await createAiCodeClient('', list.fetchImpl).getPullRequests('p1');
    expect(list.call().url).toBe('/api/v1/projects/p1/ai-code/pull-requests');
  });

  it('drops any field the contract does not name, so no person can reach a screen', async () => {
    const body = makeAiPullRequests();
    const list = recorder({
      ...body,
      items: body.items.map((item) => ({
        ...item,
        author: 'alice',
        authorEmail: 'a@example.test',
      })),
    });
    const parsed = await createAiCodeClient('', list.fetchImpl).getPullRequests('p1');
    expect(JSON.stringify(parsed)).not.toMatch(/alice|example\.test/u);
  });
});

describe('the agents client', () => {
  it('reads evals on a branch, a run, runtime, chat runtime and the MCP inventory', async () => {
    const evals = recorder(makeProjectEvals());
    await createAgentsClient('', evals.fetchImpl).getEvals('p1', 'feature/x');
    expect(evals.call().url).toBe('/api/v1/projects/p1/evals?branch=feature%2Fx');
    const run = recorder(makeEvalRunDetail());
    await createAgentsClient('', run.fetchImpl).getEvalRun('p1', 'run/1');
    expect(run.call().url).toBe('/api/v1/projects/p1/evals/runs/run%2F1');
    const runtime = recorder(makeRuntimeReport());
    await createAgentsClient('', runtime.fetchImpl).getRuntime('p1', 7);
    expect(runtime.call().url).toBe('/api/v1/projects/p1/agents/runtime?days=7');
    const chat = recorder(makeRuntimeReport({ projectId: null }));
    await createAgentsClient('', chat.fetchImpl).getChatRuntime(14);
    expect(chat.call().url).toBe('/api/v1/chat/runtime?days=14');
    const mcp = recorder(makeMcpServers());
    await createAgentsClient('', mcp.fetchImpl).getMcpServers('p1');
    expect(mcp.call().url).toBe('/api/v1/projects/p1/agents/mcp-servers');
  });

  it('lists datasets and starts one, which answers 202', async () => {
    const list = recorder(makeDatasets());
    const datasets = await createAgentsClient('', list.fetchImpl).getDatasets('p1');
    expect(datasets.datasets[0]?.name).toBe('support answers');
    const started = recorder(
      {
        datasetId: 'ds-1',
        suite: 'support answers',
        branch: 'main',
        attempts: 3,
        status: 'started',
      },
      202,
    );
    const answer = await createAgentsClient('', started.fetchImpl).runDataset('p1', 'ds 1');
    expect(answer.status).toBe('started');
    expect(started.call()).toMatchObject({
      url: '/api/v1/projects/p1/evals/datasets/ds%201/run',
      method: 'POST',
      body: {},
    });
  });
});

describe('queryString', () => {
  it('drops empty and undefined entries', () => {
    expect(queryString({ a: undefined, b: '', c: 0, d: 'x' })).toBe('?c=0&d=x');
    expect(queryString({})).toBe('');
  });
});

describe('the two scorecards that have their own endpoint, and the heatmap', () => {
  const card = (id: 'supply-chain' | 'test-effectiveness') => ({
    id,
    title: id,
    dimension: id,
    evaluatedAt: '2026-10-26T12:00:00.000Z',
    windowDays: 30,
    status: 'not_configured',
    score: null,
    cappedBy: null,
    metrics: [],
    reasons: [],
  });

  it('reads the supply-chain scorecard, on a branch when one is named', async () => {
    const { fetchImpl, call } = recorder(card('supply-chain'));
    const client = createSupplyChainClient('', fetchImpl);
    expect((await client.getScorecard('p 1')).id).toBe('supply-chain');
    await client.getScorecard('p 1', 'release/1');
    expect(call(0)).toMatchObject({
      url: '/api/v1/projects/p%201/supply-chain/scorecard',
      method: 'GET',
      credentials: 'include',
    });
    expect(call(1).url).toBe('/api/v1/projects/p%201/supply-chain/scorecard?branch=release%2F1');
  });

  it('reads the test-effectiveness scorecard and the heatmap through the health client', async () => {
    const effectiveness = recorder(card('test-effectiveness'));
    const health = createHealthClient('http://api', effectiveness.fetchImpl);
    expect((await health.getTestEffectiveness('p 1')).id).toBe('test-effectiveness');
    expect(effectiveness.call().url).toBe(
      'http://api/api/v1/projects/p%201/test-effectiveness/scorecard',
    );
    const heatmap = recorder({
      evaluatedAt: '2026-10-26T12:00:00.000Z',
      dimensions: [...HEALTH_DIMENSIONS],
      scorecards: [...SCORECARD_IDS],
      total: 0,
      limit: 50,
      truncated: false,
      projects: [],
    });
    expect((await createHealthClient('', heatmap.fetchImpl).getHeatmap()).total).toBe(0);
    expect(heatmap.call().url).toBe('/api/v1/portfolio/heatmap');
  });

  it('refuses a scorecard that breaks its contract', async () => {
    const { fetchImpl } = recorder({ ...card('supply-chain'), status: 'fail', reasons: [] });
    await expect(createSupplyChainClient('', fetchImpl).getScorecard('p1')).rejects.toMatchObject({
      detail: expect.stringContaining('did not match the expected shape') as unknown,
    });
  });
});
