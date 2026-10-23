import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConnectorHttpError, ConnectorInputError } from '@automate/connectors-sdk';
import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import {
  AGENT_ACTIONS,
  AGENT_DOMAINS,
  ToolCancelledError,
  ToolConfigurationError,
  ToolFailureError,
  ToolInputError,
  ToolRefusedError,
  ToolTransientError,
  createToolRegistry,
  runResultOperation,
  toAgentProblem,
  type AdapterCall,
  type AgentAdapter,
  type DispatchResult,
  type ToolOperation,
} from './index.js';

// --- fixtures ----------------------------------------------------------------------------

/** A run result that satisfies `CanonicalRunResultSchema`, as `tests/contract/fixtures` does. */
function runResultFixture(status: 'passed' | 'failed'): unknown {
  const digest = 'a'.repeat(64);
  return {
    contractVersion: '2',
    identity: { runId: 'run-1', workspaceId: 'workspace-1' },
    status,
    startedAt: '2026-09-25T00:00:00.000Z',
    attempts: [
      {
        index: 1,
        testId: 'test-1',
        specPath: 'tests/example.spec.ts',
        title: 'example',
        status,
        rawStatus: status,
        startedAt: '2026-09-25T00:00:00.000Z',
        finishedAt: '2026-09-25T00:00:01.000Z',
        evidence: [],
        flakiness: 'unknown',
      },
    ],
    evidence: [],
    provenance: {
      producer: 'generic',
      producerVersion: '1.0.0',
      adapterVersion: '1.0.0',
      sourceDigest: digest,
      sourceUri: 'artifact://run-1/report.json',
    },
    retention: { class: 'standard' },
    proof: { state: 'verified', digest, verifier: 'dispatch-test' },
    completeness: { state: 'complete', missingShards: [], duplicateShards: [] },
    raw: {},
  };
}

const LoadInputSchema = z.object({ script: z.string().min(1) });
type LoadInput = z.infer<typeof LoadInputSchema>;

function loadRun(
  overrides: {
    idempotent?: boolean;
    retries?: number;
    timeoutMs?: number;
    normalise?: (raw: unknown, input: LoadInput) => unknown;
  } = {},
): ToolOperation<LoadInput, CanonicalRunResult> {
  return runResultOperation({
    domain: 'load',
    action: 'run',
    input: LoadInputSchema,
    idempotent: overrides.idempotent ?? true,
    ...(overrides.retries === undefined ? {} : { retries: overrides.retries }),
    timeoutMs: overrides.timeoutMs ?? 1_000,
    normalise:
      overrides.normalise ??
      ((raw) => runResultFixture((raw as { ok: boolean }).ok ? 'passed' : 'failed')),
  });
}

type Step = (call: AdapterCall<LoadInput>) => unknown;

/** An adapter whose behaviour per attempt is a script; the last step repeats. */
function scripted(...steps: Step[]): AgentAdapter<LoadInput> & { calls: AdapterCall<LoadInput>[] } {
  const calls: AdapterCall<LoadInput>[] = [];
  return {
    id: 'scripted',
    calls,
    async execute(call) {
      const step = steps[Math.min(calls.length, steps.length - 1)] as Step;
      calls.push(call);
      return step(call);
    },
  };
}

const ok: Step = () => ({ ok: true });
const noSleep = (): Promise<void> => Promise.resolve();
const input = { script: 'smoke.js' };

function expectFailure<T>(result: DispatchResult<T>) {
  if (result.ok) throw new Error('expected a failure, got a value');
  return result.failure;
}

// --- tests -------------------------------------------------------------------------------

describe('an operation with no adapter', () => {
  it('is not_configured for every one of the 15 domain/action pairs, exactly as agents.ts answers', async () => {
    const registry = createToolRegistry();
    let pairs = 0;
    for (const domain of AGENT_DOMAINS) {
      for (const action of AGENT_ACTIONS) {
        pairs += 1;
        const failure = expectFailure(await registry.dispatch(domain, action, {}));
        expect(failure).toEqual({
          kind: 'configuration',
          code: 'AGENT_NOT_CONFIGURED',
          domain,
          action,
          attempts: 0,
          message: `${domain}.${action} has no configured execution adapter`,
        });
        expect(toAgentProblem(failure)).toEqual({
          httpStatus: 501,
          body: {
            status: 'not_configured',
            implemented: false,
            code: 'AGENT_NOT_CONFIGURED',
            domain,
            action,
            message: `${domain}.${action} has no configured execution adapter`,
          },
        });
      }
    }
    expect(pairs).toBe(15);
  });

  it('is still not_configured for the other actions of a domain that has one registered', async () => {
    const registry = createToolRegistry();
    registry.register(loadRun(), scripted(ok));
    const failure = expectFailure(await registry.dispatch('load', 'scan', {}));
    expect(failure.kind).toBe('configuration');
    expect(registry.configuredDomains()).toEqual(['load']);
  });
});

describe('routes that do not exist', () => {
  it('refuses an unknown domain and an unknown action separately, as agents.ts does', async () => {
    const registry = createToolRegistry();
    const domain = expectFailure(await registry.dispatch('other', 'scan', {}));
    expect(toAgentProblem(domain)).toEqual({
      httpStatus: 404,
      body: {
        status: 'not_implemented',
        implemented: false,
        code: 'AGENT_ROUTE_NOT_FOUND',
        message: 'Agent route is not implemented',
      },
    });
    const action = expectFailure(await registry.dispatch('api', 'destroy', {}));
    expect(toAgentProblem(action)).toEqual({
      httpStatus: 404,
      body: {
        status: 'not_implemented',
        implemented: false,
        code: 'AGENT_ACTION_NOT_FOUND',
        message: 'Action is not available on any agent. Supported: generate, run, scan',
      },
    });
  });
});

describe('registration', () => {
  it('refuses a second adapter for the same pair', () => {
    const registry = createToolRegistry();
    registry.register(loadRun(), scripted(ok));
    expect(() => registry.register(loadRun(), scripted(ok))).toThrow(/load\.run is already/);
    expect(registry.has('load', 'run')).toBe(true);
    expect(registry.has('load', 'scan')).toBe(false);
    expect(registry.has('nonsense', 'run')).toBe(false);
  });

  it('lists each configured domain once, in the contract order', () => {
    const registry = createToolRegistry();
    expect(registry.configuredDomains()).toEqual([]);
    registry.register(loadRun(), scripted(ok));
    registry.register(
      runResultOperation({
        domain: 'browser',
        action: 'run',
        input: z.object({}),
        idempotent: true,
        timeoutMs: 10,
        normalise: () => runResultFixture('passed'),
      }),
      { id: 'b', execute: () => Promise.resolve({}) },
    );
    registry.register(
      runResultOperation({
        domain: 'browser',
        action: 'scan',
        input: z.object({}),
        idempotent: true,
        timeoutMs: 10,
        normalise: () => runResultFixture('passed'),
      }),
      { id: 'b', execute: () => Promise.resolve({}) },
    );
    expect(registry.configuredDomains()).toEqual(['browser', 'load']);
  });
});

describe('a fake adapter round trip', () => {
  it('validates, executes, normalises to the canonical run result and reports one attempt', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(ok);
    registry.register(loadRun(), adapter);

    const result = await registry.dispatch('load', 'run', input);

    if (!result.ok) throw new Error(result.failure.message);
    expect(result.attempts).toBe(1);
    expect(CanonicalRunResultSchema.safeParse(result.value).success).toBe(true);
    expect(result.value).toMatchObject({ status: 'passed', identity: { runId: 'run-1' } });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toMatchObject({
      domain: 'load',
      action: 'run',
      input,
      attempt: 1,
    });
    expect(adapter.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('hands the adapter the parsed input, not the caller object', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(ok);
    registry.register(loadRun(), adapter);
    await registry.dispatch('load', 'run', { script: 'a.js', smuggled: true });
    expect(adapter.calls[0]?.input).toEqual({ script: 'a.js' });
  });

  it('reports a failed run as a value: the tool ran and said so', async () => {
    const registry = createToolRegistry();
    registry.register(
      loadRun(),
      scripted(() => ({ ok: false })),
    );
    const result = await registry.dispatch('load', 'run', input);
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.value).toMatchObject({ status: 'failed' });
  });
});

describe('invalid input', () => {
  it('is refused before the adapter is called, naming the field', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(ok);
    registry.register(loadRun(), adapter);

    const failure = expectFailure(await registry.dispatch('load', 'run', { script: '' }));

    expect(failure).toMatchObject({
      kind: 'invalid_input',
      code: 'AGENT_INVALID_INPUT',
      attempts: 0,
    });
    expect(failure.message).toMatch(/^script: /);
    expect(adapter.calls).toHaveLength(0);
    expect(toAgentProblem(failure).httpStatus).toBe(400);
  });

  it('names the whole input when the problem is not at a field', async () => {
    const registry = createToolRegistry();
    registry.register(loadRun(), scripted(ok));
    const failure = expectFailure(await registry.dispatch('load', 'run', 5));
    expect(failure.message).toMatch(/^input: /);
  });

  it('classifies an adapter that rejects the request itself as invalid input, unretried', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => {
      throw new ConnectorInputError('bad_script', 'script does not parse');
    });
    registry.register(loadRun(), adapter);
    const failure = expectFailure(
      await registry.dispatch('load', 'run', input, { sleep: noSleep }),
    );
    expect(failure).toMatchObject({
      kind: 'invalid_input',
      code: 'AGENT_INVALID_INPUT',
      message: 'script does not parse',
      attempts: 1,
    });
    expect(adapter.calls).toHaveLength(1);
  });
});

describe('retrying', () => {
  it('retries a transient failure of an idempotent operation and counts the attempts', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(
      () => {
        throw new ToolTransientError('tool is warming up');
      },
      () => {
        throw new ToolTransientError('tool is warming up');
      },
      ok,
    );
    registry.register(loadRun({ retries: 2 }), adapter);

    const result = await registry.dispatch('load', 'run', input, { sleep: noSleep });

    if (!result.ok) throw new Error(result.failure.message);
    expect(result.attempts).toBe(3);
    expect(adapter.calls.map((call) => call.attempt)).toEqual([1, 2, 3]);
  });

  it('does not retry a transient failure of an operation not known to be idempotent', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => {
      throw new ToolTransientError('tool is warming up');
    });
    registry.register(loadRun({ idempotent: false, retries: 5 }), adapter);

    const failure = expectFailure(
      await registry.dispatch('load', 'run', input, { sleep: noSleep }),
    );

    expect(adapter.calls).toHaveLength(1);
    expect(failure).toMatchObject({ kind: 'retryable', code: 'AGENT_UNAVAILABLE', attempts: 1 });
    expect(toAgentProblem(failure).httpStatus).toBe(503);
  });

  it('retries a refusal the tool reported before doing anything, whatever the idempotency', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => {
      throw new ToolRefusedError('queue full', 429);
    }, ok);
    registry.register(loadRun({ idempotent: false, retries: 1 }), adapter);
    const result = await registry.dispatch('load', 'run', input, { sleep: noSleep });
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.attempts).toBe(2);
  });

  it('gives up when the budget is spent and reports every attempt made', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => {
      throw new ToolTransientError('still down');
    });
    registry.register(loadRun({ retries: 2 }), adapter);
    const failure = expectFailure(
      await registry.dispatch('load', 'run', input, { sleep: noSleep }),
    );
    expect(adapter.calls).toHaveLength(3);
    expect(failure).toMatchObject({ kind: 'retryable', attempts: 3, message: 'still down' });
  });

  it('never retries a tool failure, a non-retryable status or a missing tool', async () => {
    for (const thrown of [
      new ToolFailureError('AGENT_TOOL_FAILED', 'exit 1'),
      new ConnectorHttpError(400, 'bad request'),
      new ToolConfigurationError('k6 is not installed'),
    ]) {
      const registry = createToolRegistry();
      const adapter = scripted(() => {
        throw thrown;
      });
      registry.register(loadRun({ retries: 4 }), adapter);
      await registry.dispatch('load', 'run', input, { sleep: noSleep });
      expect(adapter.calls).toHaveLength(1);
    }
  });

  it('backs off with the connector SDK own sleep when none is injected', async () => {
    const registry = createToolRegistry();
    registry.register(
      loadRun({ retries: 1 }),
      scripted(() => {
        throw new ToolTransientError('once');
      }, ok),
    );
    const result = await registry.dispatch('load', 'run', input);
    expect(result.ok).toBe(true);
  });
});

describe('classifying what an adapter throws', () => {
  async function failureOf(thrown: unknown) {
    const registry = createToolRegistry();
    registry.register(
      loadRun(),
      scripted(() => {
        throw thrown;
      }),
    );
    return expectFailure(await registry.dispatch('load', 'run', input, { sleep: noSleep }));
  }

  it('maps a missing tool to the not_configured 501', async () => {
    const failure = await failureOf(new ToolConfigurationError('k6 is not installed'));
    expect(failure).toMatchObject({
      kind: 'configuration',
      code: 'AGENT_NOT_CONFIGURED',
      message: 'k6 is not installed',
    });
    expect(toAgentProblem(failure).httpStatus).toBe(501);
  });

  it('maps a request the tool itself found wrong to a 400 that keeps its wording', async () => {
    const failure = await failureOf(new ToolInputError('projectId does not exist'));
    expect(failure).toMatchObject({
      kind: 'invalid_input',
      code: 'AGENT_INVALID_INPUT',
      message: 'projectId does not exist',
      attempts: 1,
    });
    expect(toAgentProblem(failure).httpStatus).toBe(400);
  });

  it('keeps the code a tool failure carries and maps it to 502', async () => {
    const failure = await failureOf(new ToolFailureError('K6_THRESHOLD', 'thresholds crossed'));
    expect(failure).toMatchObject({ kind: 'tool_failure', code: 'K6_THRESHOLD', attempts: 1 });
    expect(toAgentProblem(failure).httpStatus).toBe(502);
  });

  it('treats anything else as a tool failure and never throws out of dispatch', async () => {
    expect(await failureOf(new Error('segfault'))).toMatchObject({
      kind: 'tool_failure',
      code: 'AGENT_TOOL_FAILED',
      message: 'segfault',
    });
    expect(await failureOf('plain string')).toMatchObject({
      kind: 'tool_failure',
      message: 'plain string',
    });
    expect(await failureOf(new ConnectorHttpError(404, 'gone'))).toMatchObject({
      kind: 'tool_failure',
    });
  });

  it('keeps a cancellation the adapter itself reports out of the retry loop', async () => {
    expect(await failureOf(new ToolCancelledError('stopped by the tool'))).toMatchObject({
      kind: 'tool_failure',
      code: 'AGENT_CANCELLED',
      message: 'stopped by the tool',
    });
  });

  it('classifies a retryable status the tool reported as retryable', async () => {
    expect(await failureOf(new ConnectorHttpError(502, 'bad gateway'))).toMatchObject({
      kind: 'retryable',
      code: 'AGENT_UNAVAILABLE',
    });
  });
});

describe('the timeout', () => {
  it('is applied even to an adapter that ignores its signal, and is retryable', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => new Promise<never>(() => undefined));
    registry.register(loadRun({ timeoutMs: 15, retries: 0 }), adapter);

    const failure = expectFailure(
      await registry.dispatch('load', 'run', input, { sleep: noSleep }),
    );

    expect(failure).toMatchObject({ kind: 'retryable', code: 'AGENT_TIMEOUT', attempts: 1 });
    expect(failure.message).toMatch(/15 ms/);
  });

  it('retries a timed-out idempotent operation and succeeds on the next attempt', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => new Promise<never>(() => undefined), ok);
    registry.register(loadRun({ timeoutMs: 15, retries: 1 }), adapter);
    const result = await registry.dispatch('load', 'run', input, { sleep: noSleep });
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.attempts).toBe(2);
  });
});

describe('cancellation', () => {
  it('does not start work for a caller that has already given up', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(ok);
    registry.register(loadRun(), adapter);
    const controller = new AbortController();
    controller.abort();

    const failure = expectFailure(
      await registry.dispatch('load', 'run', input, { signal: controller.signal }),
    );

    expect(failure).toMatchObject({ kind: 'tool_failure', code: 'AGENT_CANCELLED', attempts: 0 });
    expect(adapter.calls).toHaveLength(0);
  });

  it('stops waiting when the caller aborts mid-flight', async () => {
    const registry = createToolRegistry();
    const adapter = scripted(() => new Promise<never>(() => undefined));
    registry.register(loadRun({ timeoutMs: 60_000 }), adapter);
    const controller = new AbortController();

    const pending = registry.dispatch('load', 'run', input, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    expect(expectFailure(await pending)).toMatchObject({
      kind: 'tool_failure',
      code: 'AGENT_CANCELLED',
    });
  });
});

describe('result normalisation', () => {
  it('refuses output that is not a canonical run result, and says it is the tool at fault', async () => {
    const registry = createToolRegistry();
    registry.register(loadRun({ normalise: () => ({ status: 'passed' }) }), scripted(ok));
    const failure = expectFailure(await registry.dispatch('load', 'run', input));
    expect(failure).toMatchObject({ kind: 'tool_failure', code: 'AGENT_OUTPUT_INVALID' });
    expect(failure.message).toMatch(/load\.run produced output/);
  });

  it('names the whole result when the output is not even an object', async () => {
    const registry = createToolRegistry();
    registry.register(loadRun({ normalise: () => 5 }), scripted(ok));
    expect(expectFailure(await registry.dispatch('load', 'run', input)).message).toMatch(
      /valid result: result: /,
    );
  });

  it('names a normaliser that threw, including a thrown non-error', async () => {
    const registry = createToolRegistry();
    registry.register(
      loadRun({
        normalise: () => {
          throw new Error('unexpected shape');
        },
      }),
      scripted(ok),
    );
    expect(expectFailure(await registry.dispatch('load', 'run', input))).toMatchObject({
      code: 'AGENT_OUTPUT_INVALID',
      message: 'load.run output could not be normalised: unexpected shape',
    });

    const other = createToolRegistry();
    other.register(
      loadRun({
        normalise: () => {
          throw 'bare';
        },
      }),
      scripted(ok),
    );
    expect(expectFailure(await other.dispatch('load', 'run', input)).message).toMatch(/bare$/);
  });

  it('passes the validated input to the normaliser', async () => {
    const registry = createToolRegistry();
    let seen: unknown;
    registry.register(
      loadRun({
        normalise: (_raw, parsed) => {
          seen = parsed;
          return runResultFixture('passed');
        },
      }),
      scripted(ok),
    );
    await registry.dispatch('load', 'run', { script: 'x.js', extra: 1 });
    expect(seen).toEqual({ script: 'x.js' });
  });
});
