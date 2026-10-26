import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeReport, ProjectEvals } from '@automate/shared-contracts';
import type { AgentsClient } from '../lib/agents-client.js';
import {
  makeDatasets,
  makeEvalRunDetail,
  makeHealthDouble,
  makeMcpServers,
  makeProjectEvals,
  makeQa,
  makeRuntimeReport,
  pending,
  serverRefusal,
  TEST_PROJECT,
} from '../test-utils.js';
import { AgentsPage, failingSuites } from './Agents.js';
import { ToastProvider } from './Toasts.js';

beforeAll(() => {
  // jsdom has no <dialog> behaviour; the drawer only needs open and close.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function agentsDouble(overrides: Partial<AgentsClient> = {}): AgentsClient {
  return {
    getEvals: vi.fn(async () => makeProjectEvals()),
    getEvalRun: vi.fn(async () => makeEvalRunDetail()),
    getRuntime: vi.fn(async () => makeRuntimeReport()),
    getChatRuntime: vi.fn(async () => makeRuntimeReport({ projectId: null })),
    getMcpServers: vi.fn(async () => makeMcpServers()),
    getDatasets: vi.fn(async () => makeDatasets()),
    runDataset: vi.fn(async () => ({
      datasetId: 'ds-1',
      suite: 'support answers',
      branch: 'main',
      attempts: 3,
      status: 'started' as const,
    })),
    ...overrides,
  };
}

function renderAgents(
  agents: AgentsClient = agentsDouble(),
  role: 'viewer' | 'operator' | 'admin' = 'operator',
) {
  return render(
    <ToastProvider>
      <AgentsPage qa={makeQa()} health={makeHealthDouble(role)} agents={agents} />
    </ToastProvider>,
  );
}

const emptyRuntime = (): AgentRuntimeReport => {
  const report = makeRuntimeReport();
  return {
    ...report,
    runtime: {
      ...report.runtime,
      overall: {
        ...report.runtime.overall,
        current: { ...report.runtime.overall.current, runs: 0 },
      },
    },
  };
};

describe('the agents page', () => {
  it('leads with failing suites, then each suite’s verdict, significant regressions and flaky cases', async () => {
    const agents = agentsDouble();
    renderAgents(agents);
    expect(await screen.findByTestId('agents-status')).toHaveTextContent(
      '1of 1 eval suite on feature/x fails against main.',
    );
    const suite = screen.getByTestId('suite-answers');
    expect(suite).toHaveTextContent('Fail');
    const regressions = within(suite).getByTestId('significant-regressions');
    expect(regressions).toHaveTextContent('refund-policy');
    expect(regressions).toHaveTextContent('100% → 33%');
    // A regression the comparison did not call significant is not listed as one.
    expect(regressions).not.toHaveTextContent('greeting');
    expect(within(suite).getByTestId('flaky-cases')).toHaveTextContent('shipping-times');
    expect(within(suite).getByTestId('scorecard-agent-quality')).toHaveTextContent(
      'refund-policy regressed',
    );
    expect(agents.getEvals).toHaveBeenCalledWith(TEST_PROJECT.id, undefined);
  });

  it('compares another branch when one is named', async () => {
    const agents = agentsDouble();
    renderAgents(agents);
    const form = await screen.findByRole('form', { name: 'Branch' });
    fireEvent.change(within(form).getByLabelText('Branch'), { target: { value: ' release/2 ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Compare' }));
    await waitFor(() =>
      expect(agents.getEvals).toHaveBeenLastCalledWith(TEST_PROJECT.id, 'release/2'),
    );
    expect(agents.getMcpServers).toHaveBeenLastCalledWith(TEST_PROJECT.id, 'release/2');
    fireEvent.change(within(form).getByLabelText('Branch'), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Compare' }));
    await waitFor(() =>
      expect(agents.getEvals).toHaveBeenLastCalledWith(TEST_PROJECT.id, undefined),
    );
  });

  it('opens a run in a drawer with every case and attempt, and closes it', async () => {
    const agents = agentsDouble();
    renderAgents(agents);
    fireEvent.click(await screen.findByRole('button', { name: 'Open run eval-2' }));
    const drawer = await screen.findByTestId('eval-run-drawer');
    expect(await within(drawer).findByTestId('case-refund-policy')).toHaveTextContent(
      'Attempt 1: failed · 900 ms',
    );
    expect(agents.getEvalRun).toHaveBeenCalledWith(TEST_PROJECT.id, 'eval-2');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('eval-run-drawer')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Open the latest run of answers' }));
    expect(await screen.findByTestId('eval-run-drawer')).toBeInTheDocument();
  });

  it('says when a run was truncated, an attempt errored or was not judged, and when it fails to load', async () => {
    const detail = makeEvalRunDetail();
    const agents = agentsDouble({
      getEvalRun: vi
        .fn()
        .mockResolvedValueOnce({
          ...detail,
          truncated: true,
          commitSha: null,
          model: null,
          cases: [
            {
              ...detail.cases[0]!,
              label: '',
              attempts: [
                {
                  ...detail.cases[0]!.attempts[0]!,
                  passed: null,
                  latencyMs: null,
                  error: 'timeout',
                },
                { ...detail.cases[0]!.attempts[0]!, epoch: 1, passed: true },
              ],
            },
          ],
        })
        .mockRejectedValueOnce(serverRefusal('No eval run eval-2', 404)),
    });
    renderAgents(agents);
    fireEvent.click(await screen.findByRole('button', { name: 'Open run eval-2' }));
    const drawer = await screen.findByTestId('eval-run-drawer');
    expect(
      await within(drawer).findByText('The report had more cases than were kept.'),
    ).toBeInTheDocument();
    expect(drawer).toHaveTextContent('no model');
    expect(within(drawer).getByTestId('case-refund-policy')).toHaveTextContent(
      'Attempt 1: not judged · timeout',
    );
    expect(within(drawer).getByTestId('case-refund-policy')).toHaveTextContent('Attempt 2: passed');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open run eval-2' }));
    expect(await screen.findByTestId('eval-run-error')).toHaveTextContent('No eval run eval-2');
  });

  it('says a suite has nothing to compare against, or is the default branch', async () => {
    const evals = makeProjectEvals();
    const suite = evals.suites[0]!;
    renderAgents(
      agentsDouble({
        getEvals: vi.fn(async (): Promise<ProjectEvals> => ({
          ...evals,
          suites: [
            { ...suite, suite: 'first', comparison: null, baseline: null },
            {
              ...suite,
              suite: 'second',
              comparison: null,
              scorecard: { ...suite.scorecard, status: 'pass', reasons: [] },
            },
            {
              ...suite,
              suite: 'third',
              comparison: {
                ...suite.comparison!,
                verdict: 'insufficient',
                regressions: [],
                flaky: [],
              },
              scorecard: {
                ...suite.scorecard,
                status: 'insufficient',
                score: null,
                cappedBy: null,
                reasons: [],
              },
            },
          ],
        })),
      }),
    );
    expect(await screen.findByTestId('suite-first')).toHaveTextContent(
      'Nothing on the default branch to compare against.',
    );
    expect(screen.getByTestId('suite-first')).toHaveTextContent('No baseline');
    expect(screen.getByTestId('suite-second')).toHaveTextContent('This is the default branch');
    const third = screen.getByTestId('suite-third');
    expect(third).toHaveTextContent('Too little data');
    expect(within(third).getByTestId('significant-regressions')).toHaveTextContent('None.');
    expect(within(third).getByTestId('flaky-cases')).toHaveTextContent('None.');
    // Only the first still fails, on its scorecard: insufficient is not failing.
    expect(screen.getByTestId('agents-status')).toHaveTextContent('1of 3 eval suites');
  });

  it('says what an empty eval history is waiting for, a read in flight, and the server’s refusal', async () => {
    const { unmount } = renderAgents(
      agentsDouble({ getEvals: vi.fn(async () => makeProjectEvals({ suites: [], runs: [] })) }),
    );
    expect(await screen.findByTestId('evals-empty')).toHaveTextContent(
      'No eval suite has reported on feature/x',
    );
    unmount();
    const second = renderAgents(agentsDouble({ getEvals: vi.fn(() => pending<ProjectEvals>()) }));
    expect(await screen.findByTestId('evals-loading')).toBeInTheDocument();
    second.unmount();
    renderAgents(
      agentsDouble({
        getEvals: vi.fn(async () => {
          throw serverRefusal('No project project-1', 404);
        }),
      }),
    );
    expect(await screen.findByTestId('evals-error')).toHaveTextContent('No project project-1');
  });

  it('breaks runtime down by agent and model, with intervals, budgets and loops', async () => {
    const agents = agentsDouble();
    renderAgents(agents);
    const runtime = await screen.findByTestId('agent-runtime');
    const agent = await within(runtime).findByTestId('runtime-support-bot');
    expect(agent).toHaveTextContent('$0.1250');
    expect(agent).toHaveTextContent('1.2K tokens');
    expect(agent).toHaveTextContent('10% (2%–40%)');
    expect(within(runtime).getByTestId('runtime-gpt-x')).toBeInTheDocument();
    expect(within(runtime).getByTestId('scorecard-agent-quality')).toHaveTextContent(
      'target ≤ 10.0 s',
    );
    expect(within(runtime).getByTestId('runtime-loops')).toHaveTextContent(
      'support-bot called search 4 times with the same arguments',
    );
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(agents.getRuntime).toHaveBeenLastCalledWith(TEST_PROJECT.id, 30));
    expect(agents.getChatRuntime).toHaveBeenLastCalledWith(30);
  });

  it('marks unpriced spans, missing intervals, truncation, no loops, and an empty agent list', async () => {
    const report = makeRuntimeReport();
    const row = report.runtime.agents[0]!;
    renderAgents(
      agentsDouble({
        getRuntime: vi.fn(async (): Promise<AgentRuntimeReport> => ({
          ...report,
          truncated: true,
          runtime: {
            ...report.runtime,
            agents: [
              {
                ...row,
                current: {
                  ...row.current,
                  costPerRunUsd: null,
                  tokensPerRun: null,
                  latency: { p50Ms: null, p95Ms: null },
                  cost: { ...row.current.cost, unknownSpans: 3 },
                  errors: { failed: 0, rate: null },
                  loops: 0,
                },
              },
            ],
            models: [],
            loops: [],
          },
        })),
      }),
    );
    const runtime = await screen.findByTestId('agent-runtime');
    const agent = await within(runtime).findByTestId('runtime-support-bot');
    expect(agent).toHaveTextContent('3 unpriced');
    expect(agent).toHaveTextContent('too little data');
    expect(runtime).toHaveTextContent('these describe the newest');
    expect(runtime).toHaveTextContent('No model reported a run in this window.');
    expect(within(runtime).getByTestId('runtime-loops')).toHaveTextContent('No agent called');
  });

  it('says when no agent ran, and when the runtime cannot be read', async () => {
    const { unmount } = renderAgents(
      agentsDouble({ getRuntime: vi.fn(async () => emptyRuntime()) }),
    );
    expect(await screen.findByTestId('runtime-empty')).toHaveTextContent('OTLP traces');
    unmount();
    renderAgents(
      agentsDouble({
        getRuntime: vi.fn(async () => {
          throw serverRefusal('Trace store offline');
        }),
      }),
    );
    expect(await screen.findByTestId('agent-runtime-error')).toHaveTextContent(
      'Trace store offline',
    );
  });

  it('lists MCP servers with transport, pinning and env key names only', async () => {
    renderAgents();
    const github = await screen.findByTestId('mcp-github');
    expect(github).toHaveTextContent('stdio');
    expect(github).toHaveTextContent('Pinned');
    expect(github).toHaveTextContent('@modelcontextprotocol/server-github@1.2.0');
    expect(github).toHaveTextContent('env: GITHUB_TOKEN');
    const docs = screen.getByTestId('mcp-docs');
    expect(docs).toHaveTextContent('Not pinned');
    expect(docs).toHaveTextContent('https://mcp.example.test');
    expect(docs).toHaveTextContent('env: none');
  });

  it('names a server by its package without a version, or its command', async () => {
    const list = makeMcpServers();
    const github = list.servers[0]!;
    renderAgents(
      agentsDouble({
        getMcpServers: vi.fn(async () => ({
          ...list,
          servers: [
            { ...github, name: 'a', version: null },
            { ...github, name: 'b', package: null, url: null, command: 'uvx' },
            { ...github, name: 'c', package: null, url: null, command: null },
          ],
        })),
      }),
    );
    expect(await screen.findByTestId('mcp-a')).toHaveTextContent(
      '@modelcontextprotocol/server-github',
    );
    expect(screen.getByTestId('mcp-a')).not.toHaveTextContent('@1.2.0');
    expect(screen.getByTestId('mcp-b')).toHaveTextContent('uvx');
    expect(screen.getByTestId('mcp-c')).toHaveTextContent('—');
  });

  it('says when no MCP server or dataset exists', async () => {
    renderAgents(
      agentsDouble({
        getMcpServers: vi.fn(async () => makeMcpServers({ servers: [] })),
        getDatasets: vi.fn(async () => makeDatasets({ datasets: [] })),
      }),
    );
    expect(await screen.findByTestId('mcp-empty')).toHaveTextContent(
      'No MCP server is configured on main',
    );
    expect(await screen.findByTestId('datasets-empty')).toBeInTheDocument();
  });

  it('runs a dataset for an operator and shows the 202 as started', async () => {
    const agents = agentsDouble();
    renderAgents(agents);
    fireEvent.click(await screen.findByRole('button', { name: 'Run support answers' }));
    await waitFor(() => expect(agents.runDataset).toHaveBeenCalledWith(TEST_PROJECT.id, 'ds-1'));
    expect(await screen.findByText('Started support answers')).toBeInTheDocument();
    expect(within(screen.getByTestId('dataset-ds-1')).getByRole('status')).toHaveTextContent(
      'Started',
    );
    expect(screen.queryByRole('button', { name: 'Run support answers' })).not.toBeInTheDocument();
  });

  it('says why a dataset did not start, and offers Run again', async () => {
    const agents = agentsDouble({
      runDataset: vi.fn(async () => {
        throw serverRefusal('No model provider is configured', 409);
      }),
      getDatasets: vi.fn(async () =>
        makeDatasets({
          datasets: [
            { ...makeDatasets().datasets[0]!, judge: { model: 'judge-x', rubric: 'Be right' } },
          ],
        }),
      ),
    });
    renderAgents(agents);
    expect(await screen.findByTestId('dataset-ds-1')).toHaveTextContent('judged');
    fireEvent.click(screen.getByRole('button', { name: 'Run support answers' }));
    expect(await screen.findByText('No model provider is configured')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run support answers' })).toBeEnabled(),
    );
  });

  it('hides Run from a viewer', async () => {
    renderAgents(agentsDouble(), 'viewer');
    expect(await screen.findByTestId('dataset-ds-1')).toHaveTextContent('1 cases × 3 · gpt-x');
    expect(screen.queryByRole('button', { name: 'Run support answers' })).not.toBeInTheDocument();
  });

  it('shows Automate’s own chat runtime as secondary chrome, or that it has not run', async () => {
    const agents = agentsDouble();
    const { unmount } = renderAgents(agents);
    const chat = await screen.findByTestId('chat-runtime');
    expect(chat).toHaveAttribute('data-chrome', 'secondary');
    expect(await within(chat).findByTestId('runtime-gpt-x')).toBeInTheDocument();
    expect(agents.getChatRuntime).toHaveBeenCalledWith(7);
    unmount();
    renderAgents(agentsDouble({ getChatRuntime: vi.fn(async () => emptyRuntime()) }));
    expect(await screen.findByTestId('chat-runtime-empty')).toBeInTheDocument();
  });
});

describe('failingSuites', () => {
  it('counts a failing comparison or scorecard, never an insufficient one', () => {
    const evals = makeProjectEvals();
    const suite = evals.suites[0]!;
    expect(failingSuites(evals)).toBe(1);
    expect(
      failingSuites({
        ...evals,
        suites: [
          {
            ...suite,
            comparison: null,
            scorecard: {
              ...suite.scorecard,
              status: 'insufficient',
              score: null,
              cappedBy: null,
              reasons: [],
            },
          },
        ],
      }),
    ).toBe(0);
  });
});
