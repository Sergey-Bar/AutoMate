import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toDataStreamResponse: () => new Response('data: done\n\n'),
    })),
  };
});

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: vi.fn(() => vi.fn(() => ({}))),
  ollama: vi.fn(() => ({})),
}));

vi.mock('./logging.js', () => ({
  buildExecutionLogRow: vi.fn(() => ({ id: 'test-log-row' })),
}));

import { streamText } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { buildExecutionLogRow } from './logging.js';
import { createOrchestrator } from './orchestrator-loop.js';

function makeRegistry(
  dispatchImpl?: (toolName: string, input: unknown, creds: Record<string, string>) => Promise<{ content: Array<{ text: string }> }> | { content: Array<{ text: string }> },
) {
  const dispatch = vi.fn(dispatchImpl ?? (async () => ({ content: [{ text: 'result text' }] })));
  return {
    listManifests: () => [{
      name: 'github',
      tools: [{
        name: 'create_issue',
        description: 'Create issue',
        inputSchema: {} as Record<string, unknown>,
        handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
      }],
    }],
    dispatch,
  };
}

function getLastStreamCallArgs() {
  const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;
  const calls = mockStreamText.mock.calls;
  return calls[calls.length - 1][0] as {
    tools: Record<string, { execute?: (input: unknown) => Promise<unknown> }>;
  };
}

describe('orchestrator loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds streamText params with tools from registry', () => {
    const mockRegistry = {
      listManifests: () => [{
        name: 'github',
        tools: [{
          name: 'create_issue',
          description: 'Create issue',
          inputSchema: {} as Record<string, unknown>,
          handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
        }],
      }],
      dispatch: vi.fn(),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create an issue' }],
      'You are Automate.',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    expect(params.system).toContain('Automate');
    expect(params.tools).toBeDefined();
    expect(Object.keys(params.tools)).toContain('github__create_issue');
    expect(params.maxSteps).toBe(5);
  });

  it('uses correct temperature and maxTokens from config', () => {
    const mockRegistry = {
      listManifests: () => [],
      dispatch: vi.fn(),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434', temperature: 0.3, maxTokens: 1024 },
      {},
    );

    expect(params.temperature).toBe(0.3);
    expect(params.maxTokens).toBe(1024);
  });

  it('buildStreamParams normalizes endpoint trailing slash', () => {
    const mockRegistry = {
      listManifests: () => [],
      dispatch: vi.fn(),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.buildStreamParams(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434/' },
      {},
    );

    const mockedCreateOllama = createOllama as unknown as ReturnType<typeof vi.fn>;
    expect(mockedCreateOllama).toHaveBeenCalledWith({ baseURL: 'http://localhost:11434/api' });
  });

  it('buildStreamParams uses default temperature and maxTokens when not provided', () => {
    const mockRegistry = {
      listManifests: () => [],
      dispatch: vi.fn(),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    expect(params.temperature).toBe(0.7);
    expect(params.maxTokens).toBe(4096);
  });

  it('buildStreamParams passes credentials per connector', async () => {
    const mockRegistry = makeRegistry();
    const creds = { github: { token: 'gh-token' } };
    const input = { title: 'bug' };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      creds,
    );

    const execute = (params.tools.github__create_issue as unknown as { execute: (value: unknown) => Promise<unknown> }).execute;
    const result = await execute(input);

    expect(mockRegistry.dispatch).toHaveBeenCalledWith('github.create_issue', input, creds.github);
    expect(result).toBe('result text');
  });

  it('buildStreamParams tool execute joins multiple content items with newlines', async () => {
    const mockRegistry = makeRegistry(async () => ({
      content: [{ text: 'line1' }, { text: 'line2' }],
    }));

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
    );

    const execute = (params.tools.github__create_issue as unknown as { execute: (value: unknown) => Promise<unknown> }).execute;
    const result = await execute({ title: 'bug' });

    expect(result).toBe('line1\nline2');
  });

  it('stream() without options calls streamText with params directly', () => {
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    const fakeParams = {
      model: { id: 'm' },
      system: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: {},
      maxSteps: 5,
      temperature: 0.7,
      maxTokens: 4096,
    };

    const buildSpy = vi.spyOn(orch, 'buildStreamParams').mockReturnValue(fakeParams as never);
    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;
    expect(buildSpy).toHaveBeenCalledOnce();
    expect(mockStreamText).toHaveBeenCalledWith(fakeParams);
  });

  it('stream() without callbacks preserves original tools object identity', () => {
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const toolExecute = vi.fn(async () => 'ok');
    const tools = { github__create_issue: { execute: toolExecute } };
    const fakeParams = {
      model: { id: 'm' },
      system: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools,
      maxSteps: 5,
      temperature: 0.7,
      maxTokens: 4096,
    };

    vi.spyOn(orch, 'buildStreamParams').mockReturnValue(fakeParams as never);
    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
      {},
    );

    const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;
    const calledWith = mockStreamText.mock.calls[mockStreamText.mock.calls.length - 1][0] as { tools: unknown };
    expect(calledWith.tools).toBe(tools);
  });

  it('stream() with onToolStart callback wraps tools and calls callback before execute', async () => {
    const order: string[] = [];
    const mockRegistry = makeRegistry(async () => {
      order.push('dispatch');
      return { content: [{ text: 'result text' }] };
    });
    const onToolStart = vi.fn(() => {
      order.push('start');
    });
    const onToolExecute = vi.fn();

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolStart, onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    await wrappedExecute?.({ title: 'issue' });

    expect(onToolStart).toHaveBeenCalledWith('github__create_issue');
    expect(order[0]).toBe('start');
    expect(order[1]).toBe('dispatch');
  });

  it('stream() with onToolExecute callback reports success event', async () => {
    const mockRegistry = makeRegistry();
    const onToolExecute = vi.fn();
    const input = { title: 'issue' };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    const result = await wrappedExecute?.(input);

    expect(result).toBe('result text');
    expect(onToolExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'github__create_issue',
        input,
        output: 'result text',
        status: 'success',
        errorMessage: null,
        durationMs: expect.any(Number),
      }),
    );
  });

  it('stream() with onToolExecute callback reports error event and re-throws', async () => {
    const mockRegistry = makeRegistry(async () => {
      throw new Error('dispatch failed');
    });
    const onToolExecute = vi.fn();
    const input = { title: 'issue' };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;

    await expect(wrappedExecute?.(input)).rejects.toThrow('dispatch failed');
    expect(onToolExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'github__create_issue',
        input,
        output: null,
        status: 'error',
        errorMessage: 'dispatch failed',
        durationMs: expect.any(Number),
      }),
    );
  });

  it('stream() wrapped tool execute calls registry.dispatch', async () => {
    const mockRegistry = makeRegistry();
    const input = { title: 'issue' };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolExecute: vi.fn() },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    await wrappedExecute?.(input);

    expect(mockRegistry.dispatch).toHaveBeenCalledWith('github.create_issue', input, { token: 'gh-token' });
  });

  it('stream() with conversationId passes it to buildExecutionLogRow', async () => {
    const mockRegistry = makeRegistry();
    const onToolExecute = vi.fn();
    const input = { title: 'issue' };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { conversationId: 'conv-123', onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    await wrappedExecute?.(input);

    expect(buildExecutionLogRow).toHaveBeenCalledWith(
      'conv-123',
      'github__create_issue',
      input,
      'result text',
      'success',
      expect.any(Number),
      null,
    );
  });

  it('buildStreamParams handles CJS default export pattern for provider functions', async () => {
    vi.resetModules();
    vi.doMock('ai', async () => {
      const actual = await vi.importActual('ai');
      return {
        ...actual,
        tool: (definition: unknown) => definition,
        streamText: vi.fn(() => ({
          toDataStreamResponse: () => new Response('data: done\n\n'),
        })),
      };
    });
    vi.doMock('./logging.js', () => ({
      buildExecutionLogRow: vi.fn(() => ({ id: 'test-log-row' })),
    }));
    vi.doMock('ollama-ai-provider-v2', () => ({
      createOllama: undefined,
      ollama: undefined,
      default: {
        createOllama: (opts: { baseURL: string }) => (modelId: string) => ({
          provider: 'cjs-ollama',
          modelId,
          baseURL: opts.baseURL,
        }),
      },
    }));

    const { createOrchestrator: freshCreateOrchestrator } = await import('./orchestrator-loop.js');
    const orch = freshCreateOrchestrator(makeRegistry() as unknown as Parameters<typeof freshCreateOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    expect(params.model).toEqual({
      provider: 'cjs-ollama',
      modelId: 'llama3.1',
      baseURL: 'http://localhost:11434/api',
    });
  });

  it('buildStreamParams falls back to stub model when provider functions are unavailable', async () => {
    vi.resetModules();
    vi.doMock('ai', async () => {
      const actual = await vi.importActual('ai');
      return {
        ...actual,
        tool: (definition: unknown) => definition,
        streamText: vi.fn(() => ({
          toDataStreamResponse: () => new Response('data: done\n\n'),
        })),
      };
    });
    vi.doMock('./logging.js', () => ({
      buildExecutionLogRow: vi.fn(() => ({ id: 'test-log-row' })),
    }));
    vi.doMock('ollama-ai-provider-v2', () => ({
      createOllama: undefined,
      ollama: undefined,
      default: undefined,
    }));

    const { createOrchestrator: freshCreateOrchestrator } = await import('./orchestrator-loop.js');
    const orch = freshCreateOrchestrator(makeRegistry() as unknown as Parameters<typeof freshCreateOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'fallback-model', endpoint: 'http://localhost:11434' },
      {},
    );

    expect(params.model).toEqual({ modelId: 'fallback-model' });
  });

  it('stream() with only onToolStart wraps tools without onToolExecute callback', async () => {
    const onToolStart = vi.fn();
    const mockRegistry = makeRegistry();

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolStart },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    const result = await wrappedExecute?.({ title: 'test' });

    expect(onToolStart).toHaveBeenCalledWith('github__create_issue');
    expect(result).toBe('result text');
  });

  it('stream() with only onToolExecute wraps tools without onToolStart', async () => {
    const onToolExecute = vi.fn();
    const mockRegistry = makeRegistry();

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    const result = await wrappedExecute?.({ title: 'no-start-callback' });

    expect(onToolExecute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', toolName: 'github__create_issue' }),
    );
    expect(result).toBe('result text');
  });

  it('stream() onToolExecute callback handles non-Error throw with string message', async () => {
    const mockRegistry = makeRegistry(async () => {
       
      throw 'string error message';
    });
    const onToolExecute = vi.fn();

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;

    await expect(wrappedExecute?.({ title: 'test' })).rejects.toBe('string error message');
    expect(onToolExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorMessage: 'string error message',
        output: null,
      }),
    );
  });

  it('buildStreamParams with no credentials for a connector falls back to empty creds', async () => {
    const mockRegistry = makeRegistry();

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {}, // no github credentials
    );

    const execute = (params.tools.github__create_issue as unknown as { execute: (value: unknown) => Promise<unknown> }).execute;
    await execute({ title: 'test' });

    // dispatch should be called with empty creds object
    expect(mockRegistry.dispatch).toHaveBeenCalledWith('github.create_issue', { title: 'test' }, {});
  });

  it('buildStreamParams with registry returning empty content array yields empty string', async () => {
    const mockRegistry = makeRegistry(async () => ({ content: [] }));

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: {} },
    );

    const execute = (params.tools.github__create_issue as unknown as { execute: (value: unknown) => Promise<unknown> }).execute;
    const result = await execute({ title: 'test' });

    expect(result).toBe('');
  });

  it('buildStreamParams with registry returning multiple content items joins them with newlines', async () => {
    const mockRegistry = makeRegistry(async () => ({
      content: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    }));

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    const params = orch.buildStreamParams(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: {} },
    );

    const execute = (params.tools.github__create_issue as unknown as { execute: (value: unknown) => Promise<unknown> }).execute;
    const result = await execute({});

    expect(result).toBe('a\nb\nc');
  });

  it('stream() without options and empty messages calls streamText', () => {
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    orch.stream(
      [],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;
    expect(mockStreamText).toHaveBeenCalledOnce();
    const callArgs = mockStreamText.mock.calls[0][0] as { messages: unknown[] };
    expect(callArgs.messages).toHaveLength(0);
  });

  it('stream() with conversationId empty string passes empty string to buildExecutionLogRow', async () => {
    const mockRegistry = makeRegistry();
    const onToolExecute = vi.fn();

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'hi' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'tok' } },
      { onToolExecute },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    await wrappedExecute?.({ title: 'x' });

    expect(buildExecutionLogRow).toHaveBeenCalledWith(
      '',
      'github__create_issue',
      { title: 'x' },
      'result text',
      'success',
      expect.any(Number),
      null,
    );
  });
});

describe('orchestrator loop — dashboard runId memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDashboardRegistry(triggerResult: string) {
    const dispatch = vi.fn(async () => ({
      content: [{ text: triggerResult }],
    }));
    return {
      listManifests: () => [
        {
          name: 'dashboard',
          tools: [
            {
              name: 'triggerTestRun',
              description: 'Trigger a test run',
              inputSchema: {} as Record<string, unknown>,
              handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: triggerResult }] })),
            },
          ],
        },
      ],
      dispatch,
    };
  }

  it('injects a system message with runId after dashboard__triggerTestRun succeeds', async () => {
    const triggerResult = 'Test run triggered. Run ID: run-abc-123, Status: queued';
    const mockRegistry = makeDashboardRegistry(triggerResult);

    const savedMessages: Array<{ id: string; conversationId: string; role: string; content: string }> = [];
    const mockRepo = {
      saveMessage: vi.fn(async (msg: { id: string; conversationId: string; role: string; content: string }) => {
        savedMessages.push(msg);
      }),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Run my tests' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { dashboard: {} },
      { conversationId: 'conv-999', onToolExecute: vi.fn(), repo: mockRepo as never },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.dashboard__triggerTestRun.execute;
    await wrappedExecute?.({ specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' });

    expect(mockRepo.saveMessage).toHaveBeenCalledOnce();
    const saved = savedMessages[0];
    expect(saved.conversationId).toBe('conv-999');
    expect(saved.role).toBe('system');
    expect(saved.content).toContain('run-abc-123');
    expect(saved.content).toContain('dashboard__getRunStatus');
  });

  it('does NOT inject a system message when dashboard__triggerTestRun result has no Run ID', async () => {
    const triggerResult = 'Failed to trigger run: 500 Internal Server Error';
    const mockRegistry = makeDashboardRegistry(triggerResult);

    const mockRepo = {
      saveMessage: vi.fn(async () => {}),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Run my tests' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { dashboard: {} },
      { conversationId: 'conv-999', onToolExecute: vi.fn(), repo: mockRepo as never },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.dashboard__triggerTestRun.execute;
    await wrappedExecute?.({ specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' });

    expect(mockRepo.saveMessage).not.toHaveBeenCalled();
  });

  it('does NOT inject a system message when tool is not dashboard__triggerTestRun', async () => {
    const mockRegistry = makeRegistry();
    const mockRepo = {
      saveMessage: vi.fn(async () => {}),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Create issue' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'tok' } },
      { conversationId: 'conv-100', onToolExecute: vi.fn(), repo: mockRepo as never },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.github__create_issue.execute;
    await wrappedExecute?.({ title: 'issue' });

    expect(mockRepo.saveMessage).not.toHaveBeenCalled();
  });

  it('does NOT inject a system message when conversationId is absent', async () => {
    const triggerResult = 'Test run triggered. Run ID: run-xyz, Status: queued';
    const mockRegistry = makeDashboardRegistry(triggerResult);

    const mockRepo = {
      saveMessage: vi.fn(async () => {}),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Run tests' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { dashboard: {} },
      // no conversationId
      { onToolExecute: vi.fn(), repo: mockRepo as never },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.dashboard__triggerTestRun.execute;
    await wrappedExecute?.({ specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' });

    expect(mockRepo.saveMessage).not.toHaveBeenCalled();
  });

  it('does NOT inject a system message when no repo is provided', async () => {
    const triggerResult = 'Test run triggered. Run ID: run-xyz, Status: queued';
    const mockRegistry = makeDashboardRegistry(triggerResult);

    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);
    orch.stream(
      [{ role: 'user', content: 'Run tests' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { dashboard: {} },
      { conversationId: 'conv-999', onToolExecute: vi.fn() },
    );

    const callArgs = getLastStreamCallArgs();
    const wrappedExecute = callArgs.tools.dashboard__triggerTestRun.execute;
    // Should not throw even without a repo
    await expect(wrappedExecute?.({ specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' })).resolves.toBeDefined();
  });
});
