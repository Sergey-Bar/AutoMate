import { describe, expect, it } from 'vitest';
import { AgentAcceptedRunSchema } from '@automate/shared-contracts';
import { createToolRegistry, toAgentProblem, type ToolRegistry } from '@automate/tool-sdk';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import type { ExecutionStore } from '../execution/types.js';
import { DomainError } from '../errors/domain-error.js';
import { BROWSER_UNSUPPORTED_REASONS, registerBrowserAgent } from './browser-adapter.js';

const VALID = { project: 'smoke-pass', targetUrl: 'http://127.0.0.1:3000' };

function compose(
  overrides: { store?: ExecutionStore; workspaceId?: string; requireIdempotencyKey?: boolean } = {},
): { registry: ToolRegistry; store: ExecutionStore } {
  const store = overrides.store ?? new InMemoryExecutionStore();
  const registry = createToolRegistry();
  registerBrowserAgent({
    registry,
    store,
    workspaceId: overrides.workspaceId ?? 'ws-a',
    requireIdempotencyKey: overrides.requireIdempotencyKey ?? false,
  });
  return { registry, store };
}

async function failureOf(registry: ToolRegistry, domain: string, action: string, input: unknown) {
  const result = await registry.dispatch(domain, action, input);
  if (result.ok) throw new Error(`${domain}.${action} unexpectedly succeeded`);
  return result.failure;
}

describe('browser.run', () => {
  it('is the only browser pair registered: scan and generate stay unconfigured', () => {
    const { registry } = compose();
    expect(registry.has('browser', 'run')).toBe(true);
    expect(registry.has('browser', 'scan')).toBe(false);
    expect(registry.has('browser', 'generate')).toBe(false);
    expect(registry.configuredDomains()).toEqual(['browser']);
  });

  it('queues a Playwright job through the execution store and answers with its ids', async () => {
    const { registry, store } = compose();
    const result = await registry.dispatch('browser', 'run', {
      ...VALID,
      branch: 'feat/x',
      commit: 'abc123',
      timeoutMs: 120_000,
    });
    if (!result.ok) throw new Error(result.failure.message);

    const accepted = AgentAcceptedRunSchema.parse(result.value);
    expect(accepted).toMatchObject({
      status: 'accepted',
      domain: 'browser',
      action: 'run',
      phase: 'queued',
      duplicate: false,
    });
    expect(accepted.links.run).toBe(`/api/v1/runs/${accepted.runId}`);

    const run = await store.getRun(accepted.runId, 'ws-a');
    expect(run).toMatchObject({
      framework: 'playwright',
      testType: 'browser',
      branch: 'feat/x',
      commit: 'abc123',
      timeoutMs: 120_000,
      requiredCapabilities: ['playwright'],
    });
    // What the runner reads from the job: the project and the target, nothing invented.
    expect(run?.configuration).toEqual({
      playwrightProject: 'smoke-pass',
      targetUrl: 'http://127.0.0.1:3000',
    });
    const job = await store.getJob(accepted.jobId, 'ws-a');
    expect(job).toMatchObject({ state: 'queued', requiredCapabilities: ['playwright'] });
  });

  it('is idempotent on the key, and says so', async () => {
    const { registry, store } = compose();
    const input = { ...VALID, idempotencyKey: 'same-key' };
    const first = await registry.dispatch('browser', 'run', input);
    const second = await registry.dispatch('browser', 'run', input);
    if (!first.ok || !second.ok) throw new Error('both dispatches must be accepted');
    const a = AgentAcceptedRunSchema.parse(first.value);
    const b = AgentAcceptedRunSchema.parse(second.value);
    expect(b.runId).toBe(a.runId);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(1);
  });

  it('without a key creates a new run each time', async () => {
    const { registry, store } = compose();
    await registry.dispatch('browser', 'run', VALID);
    await registry.dispatch('browser', 'run', VALID);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(2);
  });

  it('demands a key when the runs API would (production)', async () => {
    const { registry, store } = compose({ requireIdempotencyKey: true });
    const failure = await failureOf(registry, 'browser', 'run', VALID);
    expect(failure).toMatchObject({ kind: 'invalid_input', code: 'AGENT_INVALID_INPUT' });
    expect(failure.message).toMatch(/idempotency/i);
    expect(toAgentProblem(failure).httpStatus).toBe(400);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);

    const ok = await registry.dispatch('browser', 'run', { ...VALID, idempotencyKey: 'k' });
    expect(ok.ok).toBe(true);
  });

  it.each([
    ['a missing project', { targetUrl: VALID.targetUrl }],
    ['a missing target', { project: VALID.project }],
    ['a file: target', { ...VALID, targetUrl: 'file:///etc/passwd' }],
    ['a target with credentials', { ...VALID, targetUrl: 'http://u:p@host.test/' }],
    ['a project that is a CLI flag', { ...VALID, project: '--ui' }],
    ['a spec selection the runner cannot honour', { ...VALID, grep: 'login' }],
    ['no input at all', undefined],
  ])('refuses %s with a 400 and creates nothing', async (_name, input) => {
    const { registry, store } = compose();
    const failure = await failureOf(registry, 'browser', 'run', input);
    expect(failure).toMatchObject({ kind: 'invalid_input', code: 'AGENT_INVALID_INPUT' });
    expect(toAgentProblem(failure).httpStatus).toBe(400);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('reports a store refusal the caller caused as a 400 with the store’s code', async () => {
    const store = new InMemoryExecutionStore();
    store.createRun = () => Promise.reject(new DomainError('INVALID_RUN', 'projectId is unknown'));
    const { registry } = compose({ store });
    const failure = await failureOf(registry, 'browser', 'run', VALID);
    expect(failure).toMatchObject({ kind: 'invalid_input', message: 'projectId is unknown' });
  });

  it('reports a store outage as a tool failure without leaking its message', async () => {
    const store = new InMemoryExecutionStore();
    store.createRun = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const { registry } = compose({ store });
    const failure = await failureOf(registry, 'browser', 'run', VALID);
    expect(failure.kind).toBe('tool_failure');
    expect(failure.code).toBe('AGENT_EXECUTION_STORE_FAILED');
    expect(failure.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(toAgentProblem(failure).httpStatus).toBe(502);
  });
});

describe('browser.scan and browser.generate', () => {
  it('state why they are not supported, and the reasons name what is missing', () => {
    expect(BROWSER_UNSUPPORTED_REASONS['scan']).toMatch(/list|dry-run|discover/i);
    expect(BROWSER_UNSUPPORTED_REASONS['generate']).toMatch(/gateway|model/i);
  });

  it('are still refused by the registry with the 501 the SDK renders', async () => {
    const { registry } = compose();
    for (const action of ['scan', 'generate']) {
      const failure = await failureOf(registry, 'browser', action, VALID);
      expect(toAgentProblem(failure).httpStatus).toBe(501);
    }
  });
});

describe('workspace isolation', () => {
  it('a run accepted for one workspace is invisible to another over the same store', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose({ store, workspaceId: 'ws-a' });
    const b = compose({ store, workspaceId: 'ws-b' });

    const result = await a.registry.dispatch('browser', 'run', VALID);
    if (!result.ok) throw new Error(result.failure.message);
    const accepted = AgentAcceptedRunSchema.parse(result.value);

    expect(await store.getRun(accepted.runId, 'ws-a')).not.toBeNull();
    expect(await store.getRun(accepted.runId, 'ws-b')).toBeNull();
    expect(await store.getJob(accepted.jobId, 'ws-b')).toBeNull();
    expect((await store.listRuns('ws-b')).runs).toEqual([]);
    expect(await store.listJobs('ws-b')).toEqual([]);

    // And the other workspace's adapter writes only into its own.
    const other = await b.registry.dispatch('browser', 'run', VALID);
    if (!other.ok) throw new Error(other.failure.message);
    const otherId = AgentAcceptedRunSchema.parse(other.value).runId;
    expect(await store.getRun(otherId, 'ws-a')).toBeNull();
    expect((await store.listRuns('ws-a')).runs.map((run) => run.id)).toEqual([accepted.runId]);
  });

  it('does not share an idempotency key across workspaces', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose({ store, workspaceId: 'ws-a' });
    const b = compose({ store, workspaceId: 'ws-b' });
    const input = { ...VALID, idempotencyKey: 'shared' };
    const first = await a.registry.dispatch('browser', 'run', input);
    const second = await b.registry.dispatch('browser', 'run', input);
    if (!first.ok || !second.ok) throw new Error('both must be accepted');
    expect(AgentAcceptedRunSchema.parse(second.value).duplicate).toBe(false);
    expect(AgentAcceptedRunSchema.parse(second.value).runId).not.toBe(
      AgentAcceptedRunSchema.parse(first.value).runId,
    );
  });
});
