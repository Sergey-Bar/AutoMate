import { describe, expect, it } from 'vitest';
import {
  AgentAcceptedRunSchema,
  LOAD_DEFAULT_DURATION_SECONDS,
  LOAD_DEFAULT_VUS,
  LOAD_MAX_DURATION_SECONDS,
  LOAD_MAX_VUS,
} from '@automate/shared-contracts';
import { createToolRegistry, toAgentProblem, type ToolRegistry } from '@automate/tool-sdk';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import type { ExecutionStore } from '../execution/types.js';
import { DomainError } from '../errors/domain-error.js';
import {
  LOAD_TIMEOUT_GRACE_MS,
  LOAD_UNSUPPORTED_REASONS,
  registerLoadAgent,
} from './load-adapter.js';

const VALID = { script: 'smoke.js', targetUrl: 'http://127.0.0.1:3000' };

function compose(
  overrides: { store?: ExecutionStore; workspaceId?: string; requireIdempotencyKey?: boolean } = {},
): { registry: ToolRegistry; store: ExecutionStore } {
  const store = overrides.store ?? new InMemoryExecutionStore();
  const registry = createToolRegistry();
  registerLoadAgent({
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

describe('load.run', () => {
  it('is the only load pair registered: scan and generate stay unconfigured', () => {
    const { registry } = compose();
    expect(registry.has('load', 'run')).toBe(true);
    expect(registry.has('load', 'scan')).toBe(false);
    expect(registry.has('load', 'generate')).toBe(false);
    expect(registry.configuredDomains()).toEqual(['load']);
  });

  it('queues a k6 job with the defaults made explicit, and answers with its ids', async () => {
    const { registry, store } = compose();
    const result = await registry.dispatch('load', 'run', {
      ...VALID,
      branch: 'feat/x',
      commit: 'abc123',
    });
    if (!result.ok) throw new Error(result.failure.message);

    const accepted = AgentAcceptedRunSchema.parse(result.value);
    expect(accepted).toMatchObject({
      status: 'accepted',
      domain: 'load',
      action: 'run',
      phase: 'queued',
      duplicate: false,
    });

    const run = await store.getRun(accepted.runId, 'ws-a');
    expect(run).toMatchObject({
      framework: 'k6',
      testType: 'performance',
      branch: 'feat/x',
      commit: 'abc123',
      requiredCapabilities: ['k6'],
      timeoutMs: LOAD_DEFAULT_DURATION_SECONDS * 1000 + LOAD_TIMEOUT_GRACE_MS,
    });
    // What the runner reads from the job: the script, the bounds and the target, nothing else.
    expect(run?.configuration).toEqual({
      k6: {
        script: 'smoke.js',
        vus: LOAD_DEFAULT_VUS,
        durationSeconds: LOAD_DEFAULT_DURATION_SECONDS,
      },
      targetUrl: 'http://127.0.0.1:3000',
    });
    const job = await store.getJob(accepted.jobId, 'ws-a');
    expect(job).toMatchObject({ state: 'queued', requiredCapabilities: ['k6'] });
  });

  it('derives the job timeout from the requested duration, so the deadline always covers it', async () => {
    const { registry, store } = compose();
    const result = await registry.dispatch('load', 'run', {
      ...VALID,
      vus: 7,
      durationSeconds: 90,
    });
    if (!result.ok) throw new Error(result.failure.message);
    const run = await store.getRun(AgentAcceptedRunSchema.parse(result.value).runId, 'ws-a');
    expect(run?.timeoutMs).toBe(90_000 + LOAD_TIMEOUT_GRACE_MS);
    expect(run?.configuration).toMatchObject({ k6: { vus: 7, durationSeconds: 90 } });
  });

  it('accepts the ceilings exactly', async () => {
    const { registry } = compose();
    const result = await registry.dispatch('load', 'run', {
      ...VALID,
      vus: LOAD_MAX_VUS,
      durationSeconds: LOAD_MAX_DURATION_SECONDS,
    });
    expect(result.ok).toBe(true);
  });

  it('is idempotent on the key, and says so', async () => {
    const { registry, store } = compose();
    const input = { ...VALID, idempotencyKey: 'same-key' };
    const first = await registry.dispatch('load', 'run', input);
    const second = await registry.dispatch('load', 'run', input);
    if (!first.ok || !second.ok) throw new Error('both dispatches must be accepted');
    const a = AgentAcceptedRunSchema.parse(first.value);
    const b = AgentAcceptedRunSchema.parse(second.value);
    expect(b.runId).toBe(a.runId);
    expect(b.duplicate).toBe(true);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(1);
  });

  it('demands a key when the runs API would (production)', async () => {
    const { registry, store } = compose({ requireIdempotencyKey: true });
    const failure = await failureOf(registry, 'load', 'run', VALID);
    expect(failure).toMatchObject({ kind: 'invalid_input', code: 'AGENT_INVALID_INPUT' });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
    expect((await registry.dispatch('load', 'run', { ...VALID, idempotencyKey: 'k' })).ok).toBe(
      true,
    );
  });

  it.each([
    ['more VUs than the ceiling', { ...VALID, vus: LOAD_MAX_VUS + 1 }],
    [
      'a longer duration than the ceiling',
      { ...VALID, durationSeconds: LOAD_MAX_DURATION_SECONDS + 1 },
    ],
    ['a fractional duration', { ...VALID, durationSeconds: 1.5 }],
    ['a script that escapes the script root', { ...VALID, script: '../../etc/passwd.js' }],
    ['an absolute script', { ...VALID, script: '/tmp/x.js' }],
    ['a non-script file', { ...VALID, script: 'smoke.sh' }],
    ['a script that is a CLI flag', { ...VALID, script: '--out.js' }],
    ['a missing script', { targetUrl: VALID.targetUrl }],
    ['a missing target', { script: VALID.script }],
    ['a file: target', { ...VALID, targetUrl: 'file:///etc/passwd' }],
    ['a target with credentials', { ...VALID, targetUrl: 'http://u:p@host.test/' }],
    ['arbitrary k6 arguments', { ...VALID, args: ['--out', 'cloud'] }],
    ['an arbitrary command', { ...VALID, command: ['sh', '-c', 'id'] }],
    ['a thresholds override', { ...VALID, thresholds: { http_req_duration: ['p(95)<1'] } }],
    ['a caller-chosen timeout', { ...VALID, timeoutMs: 1 }],
    ['no input at all', undefined],
  ])('refuses %s with a 400 and creates nothing', async (_name, input) => {
    const { registry, store } = compose();
    const failure = await failureOf(registry, 'load', 'run', input);
    expect(failure).toMatchObject({ kind: 'invalid_input', code: 'AGENT_INVALID_INPUT' });
    expect(toAgentProblem(failure).httpStatus).toBe(400);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('reports a store refusal the caller caused as a 400 with the store’s message', async () => {
    const store = new InMemoryExecutionStore();
    store.createRun = () => Promise.reject(new DomainError('INVALID_RUN', 'projectId is unknown'));
    const { registry } = compose({ store });
    const failure = await failureOf(registry, 'load', 'run', VALID);
    expect(failure).toMatchObject({ kind: 'invalid_input', message: 'projectId is unknown' });
  });

  it('reports a store outage as a tool failure without leaking its message', async () => {
    const store = new InMemoryExecutionStore();
    store.createRun = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const { registry } = compose({ store });
    const failure = await failureOf(registry, 'load', 'run', VALID);
    expect(failure.kind).toBe('tool_failure');
    expect(failure.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(toAgentProblem(failure).httpStatus).toBe(502);
  });
});

describe('load.scan and load.generate', () => {
  it('state why they are not supported, naming what is missing', () => {
    expect(LOAD_UNSUPPORTED_REASONS['scan']).toMatch(/discover|inventory|list/i);
    expect(LOAD_UNSUPPORTED_REASONS['generate']).toMatch(/gateway|model/i);
  });

  it('are still refused by the registry with the 501 the SDK renders', async () => {
    const { registry } = compose();
    for (const action of ['scan', 'generate']) {
      const failure = await failureOf(registry, 'load', action, VALID);
      expect(toAgentProblem(failure).httpStatus).toBe(501);
    }
  });
});

describe('workspace isolation', () => {
  it('a run accepted for one workspace is invisible to another over the same store', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose({ store, workspaceId: 'ws-a' });
    const b = compose({ store, workspaceId: 'ws-b' });

    const result = await a.registry.dispatch('load', 'run', VALID);
    if (!result.ok) throw new Error(result.failure.message);
    const accepted = AgentAcceptedRunSchema.parse(result.value);

    expect(await store.getRun(accepted.runId, 'ws-a')).not.toBeNull();
    expect(await store.getRun(accepted.runId, 'ws-b')).toBeNull();
    expect(await store.getJob(accepted.jobId, 'ws-b')).toBeNull();
    expect((await store.listRuns('ws-b')).runs).toEqual([]);
    expect(await store.listJobs('ws-b')).toEqual([]);

    const other = await b.registry.dispatch('load', 'run', VALID);
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
    const first = await a.registry.dispatch('load', 'run', input);
    const second = await b.registry.dispatch('load', 'run', input);
    if (!first.ok || !second.ok) throw new Error('both must be accepted');
    expect(AgentAcceptedRunSchema.parse(second.value).duplicate).toBe(false);
    expect(AgentAcceptedRunSchema.parse(second.value).runId).not.toBe(
      AgentAcceptedRunSchema.parse(first.value).runId,
    );
  });
});
