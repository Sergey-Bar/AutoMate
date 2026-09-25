import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamTextMock = vi.hoisted(() => vi.fn(() => ({ mockStream: true })));
const createOllamaMock = vi.hoisted(() =>
  vi.fn((opts: { baseURL: string }) => (modelId: string) => ({ provider: 'ollama', modelId, baseURL: opts.baseURL })),
);
const ollamaMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'legacy-ollama', modelId })),
);

vi.mock('ai', () => ({
  streamText: streamTextMock,
}));

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: createOllamaMock,
  ollama: ollamaMock,
}));

import { buildPlannerInput, createPlannerConfig, plan, planWithMessages } from './planner.js';

describe('planner input', () => {
  beforeEach(() => {
    streamTextMock.mockClear();
    createOllamaMock.mockClear();
    ollamaMock.mockClear();
  });

  it('injects tools and flow prompt into system message', () => {
    const input = buildPlannerInput('hello', 'flow prompt', { 'github.create_issue': {} });
    expect(input.system).toContain('flow prompt');
    expect(Object.keys(input.tools)).toContain('github.create_issue');
  });

  it('includes user prompt', () => {
    const input = buildPlannerInput('run tests', 'analyze', {});
    expect(input.prompt).toBe('run tests');
  });

  it('exports planWithMessages for chat-style interactions', () => {
    expect(planWithMessages).toBeTypeOf('function');
  });

  it('createPlannerConfig throws for unsupported provider', () => {
    expect(() =>
      createPlannerConfig({
        provider: 'unknown-llm',
        model: 'some-model',
        endpoint: 'http://localhost:1234',
      }),
    ).toThrow('Unsupported');
  });

  it('createPlannerConfig returns model, temperature and maxTokens for ollama provider', () => {
    const config = createPlannerConfig({
      provider: 'ollama',
      model: 'llama3.1:8b',
      endpoint: 'http://localhost:11434',
    });

    expect(config).toEqual({
      model: { provider: 'ollama', modelId: 'llama3.1:8b', baseURL: 'http://localhost:11434/api' },
      temperature: 0.7,
      maxTokens: 4096,
    });
  });

  it('createPlannerConfig normalizes trailing slash on endpoint', () => {
    const config = createPlannerConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434/',
    });

    expect(config.model).toEqual({
      provider: 'ollama',
      modelId: 'llama3.1',
      baseURL: 'http://localhost:11434/api',
    });
  });

  it('createPlannerConfig respects custom temperature and maxTokens', () => {
    const config = createPlannerConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.2,
      maxTokens: 1234,
    });

    expect(config.temperature).toBe(0.2);
    expect(config.maxTokens).toBe(1234);
  });

  it('createPlannerConfig uses default temperature and maxTokens when not provided', () => {
    const config = createPlannerConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });

    expect(config.temperature).toBe(0.7);
    expect(config.maxTokens).toBe(4096);
  });

  it('buildPlannerInput merges default provider and endpoint when config omits them', () => {
    const input = buildPlannerInput('defaulted prompt', 'defaulted flow', {}, {
      model: 'llama3.1',
    } as unknown as Parameters<typeof buildPlannerInput>[3]);

    expect(input.model).toEqual({
      provider: 'ollama',
      modelId: 'llama3.1',
      baseURL: 'http://localhost:11434/api',
    });
  });

  it('buildPlannerInput without config uses legacy planner configuration path', () => {
    const input = buildPlannerInput('legacy prompt', 'legacy flow', {});

    expect(input.model).toEqual({ provider: 'ollama', modelId: 'llama3.1', baseURL: 'http://localhost:11434/api' });
    expect(input.temperature).toBe(0.7);
    expect(input.maxTokens).toBe(4096);
  });

  it('buildPlannerInput with config uses createPlannerConfig path', () => {
    const input = buildPlannerInput('configured prompt', 'configured flow', {}, {
      provider: 'ollama',
      model: 'llama3.2',
      endpoint: 'http://ollama.local:11434',
    });

    expect(input.model).toEqual({
      provider: 'ollama',
      modelId: 'llama3.2',
      baseURL: 'http://ollama.local:11434/api',
    });
    expect(input.temperature).toBe(0.7);
    expect(input.maxTokens).toBe(4096);
  });

  it('buildPlannerInput system prompt includes Automate orchestration planner prefix', () => {
    const input = buildPlannerInput('hello', 'flow details', {});
    expect(input.system).toBe('You are Automate orchestration planner. flow details');
  });

  it('plan calls streamText with expected arguments', () => {
    const tools = { 'github.create_issue': { description: 'Create issue' } };

    const result = plan('ship this', 'follow release flow', tools, {
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });

    expect(result).toEqual({ mockStream: true });
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).toHaveBeenCalledWith({
      model: { provider: 'ollama', modelId: 'llama3.1', baseURL: 'http://localhost:11434/api' },
      system: 'You are Automate orchestration planner. follow release flow',
      prompt: 'ship this',
      tools,
    });
  });

  it('planWithMessages formats messages and calls streamText', () => {
    const tools = { search: { description: 'Search tool' } } as unknown as Parameters<typeof planWithMessages>[2];
    const messages = [
      { role: 'system' as const, content: 'system context' },
      { role: 'user' as const, content: 'how are you?' },
      { role: 'assistant' as const, content: 'I am fine.' },
    ];

    const result = planWithMessages(messages, 'system prompt', tools, {
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });

    expect(result).toEqual({ mockStream: true });
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).toHaveBeenCalledWith({
      model: { provider: 'ollama', modelId: 'llama3.1', baseURL: 'http://localhost:11434/api' },
      system: 'system prompt',
      messages: [
        { role: 'system', content: 'system context' },
        { role: 'user', content: 'how are you?' },
        { role: 'assistant', content: 'I am fine.' },
      ],
      tools,
    });
  });

  it('planWithMessages without config uses legacy planner configuration', () => {
    const tools = { explain: { description: 'Explain tool' } } as unknown as Parameters<typeof planWithMessages>[2];
    const messages = [{ role: 'user' as const, content: 'summarize this' }];

    planWithMessages(messages, 'legacy system', tools);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).toHaveBeenCalledWith({
      model: { provider: 'ollama', modelId: 'llama3.1', baseURL: 'http://localhost:11434/api' },
      system: 'legacy system',
      messages: [{ role: 'user', content: 'summarize this' }],
      tools,
    });
  });

  it('createPlannerConfig handles CJS default export pattern', async () => {
    vi.resetModules();
    vi.doMock('ai', () => ({
      streamText: streamTextMock,
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

    const { createPlannerConfig: freshCreatePlannerConfig } = await import('./planner.js');
    const config = freshCreatePlannerConfig({
      provider: 'ollama',
      model: 'test',
      endpoint: 'http://localhost:11434',
    });

    expect(config.model).toEqual({
      provider: 'cjs-ollama',
      modelId: 'test',
      baseURL: 'http://localhost:11434/api',
    });
  });

  it('createPlannerConfig falls back to stub model when no provider functions available', async () => {
    vi.resetModules();
    vi.doMock('ai', () => ({
      streamText: streamTextMock,
    }));
    vi.doMock('ollama-ai-provider-v2', () => ({
      createOllama: undefined,
      ollama: undefined,
      default: undefined,
      somethingElse: 'nope',
    }));

    const { createPlannerConfig: freshCreatePlannerConfig } = await import('./planner.js');
    const config = freshCreatePlannerConfig({
      provider: 'ollama',
      model: 'fallback-model',
      endpoint: 'http://localhost:11434',
    });

    expect(config.model).toEqual({ modelId: 'fallback-model' });
  });

  it('buildPlannerInput legacy path with no provider functions creates stub model', async () => {
    vi.resetModules();
    vi.doMock('ai', () => ({
      streamText: streamTextMock,
    }));
    vi.doMock('ollama-ai-provider-v2', () => ({
      createOllama: undefined,
      ollama: undefined,
      default: undefined,
    }));

    const { buildPlannerInput: freshBuildPlannerInput } = await import('./planner.js');
    const input = freshBuildPlannerInput('prompt', 'flow', {});

    expect(input.model).toEqual({ modelId: 'llama3.1' });
  });
});
