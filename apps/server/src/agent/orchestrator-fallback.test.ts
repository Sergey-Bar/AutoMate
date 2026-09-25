/**
 * Tests for multi-provider fallback logic: getFallbackModelConfig + streamWithFallback
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toDataStreamResponse: () => new Response('ok'),
      text: Promise.resolve(''),
    })),
    tool: (definition: unknown) => definition,
  };
});

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: vi.fn(() => vi.fn(() => ({ provider: 'ollama' }))),
  ollama: vi.fn(() => ({ provider: 'ollama' })),
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn((modelId: string) => ({ provider: 'openai', modelId })),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => ({ provider: 'anthropic', modelId })),
}));

vi.mock('./logging.js', () => ({
  buildExecutionLogRow: vi.fn(() => ({ id: 'test-log-row' })),
}));

vi.mock('./providers.js', () => ({
  createModelForProvider: vi.fn((config: { provider: string; model: string }) => ({
    provider: config.provider,
    modelId: config.model,
  })),
  isSupportedProvider: vi.fn((provider: string) => ['ollama', 'openai', 'anthropic'].includes(provider)),
}));

import { getFallbackModelConfig } from './orchestrator-loop.js';
import { streamText } from 'ai';

// ---- getFallbackModelConfig tests ----

describe('getFallbackModelConfig', () => {
  beforeEach(() => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', '');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', '');
    vi.stubEnv('AUTOMATE_FALLBACK_ENDPOINT', '');
    delete process.env.AUTOMATE_FALLBACK_PROVIDER; // eslint-disable-line test-flakiness/no-global-state-mutation
    delete process.env.AUTOMATE_FALLBACK_MODEL; // eslint-disable-line test-flakiness/no-global-state-mutation
    delete process.env.AUTOMATE_FALLBACK_ENDPOINT; // eslint-disable-line test-flakiness/no-global-state-mutation
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when AUTOMATE_FALLBACK_PROVIDER is not set', () => {
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result).toBeNull();
  });

  it('returns null when AUTOMATE_FALLBACK_PROVIDER is unsupported', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'groq');
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result).toBeNull();
  });

  it('returns null when fallback provider equals primary provider', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'ollama');
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result).toBeNull();
  });

  it('returns fallback config with openai provider', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'openai');
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.5,
      maxTokens: 2048,
    });
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('llama3.1'); // defaults to primary model
    expect(result?.temperature).toBe(0.5);
    expect(result?.maxTokens).toBe(2048);
  });

  it('uses AUTOMATE_FALLBACK_MODEL when set', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'openai');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', 'gpt-4o-mini');
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result?.model).toBe('gpt-4o-mini');
  });

  it('uses AUTOMATE_FALLBACK_ENDPOINT when set', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'anthropic');
    vi.stubEnv('AUTOMATE_FALLBACK_ENDPOINT', 'https://custom-anthropic.example.com');
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result?.endpoint).toBe('https://custom-anthropic.example.com');
  });

  it('falls back to primary endpoint when AUTOMATE_FALLBACK_ENDPOINT not set', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'anthropic');
    const result = getFallbackModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result?.endpoint).toBe('http://localhost:11434');
  });

  it('returns fallback config with anthropic provider', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'anthropic');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', 'claude-3-5-haiku-20241022');
    const result = getFallbackModelConfig({
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
    });
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('anthropic');
    expect(result?.model).toBe('claude-3-5-haiku-20241022');
  });
});

// ---- Fallback stream behavior tests using streamText mock calls ----

describe('stream() fallback behavior — streamText call counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', '');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', '');
    vi.stubEnv('AUTOMATE_FALLBACK_ENDPOINT', '');
    delete process.env.AUTOMATE_FALLBACK_PROVIDER; // eslint-disable-line test-flakiness/no-global-state-mutation
    delete process.env.AUTOMATE_FALLBACK_MODEL; // eslint-disable-line test-flakiness/no-global-state-mutation
    delete process.env.AUTOMATE_FALLBACK_ENDPOINT; // eslint-disable-line test-flakiness/no-global-state-mutation
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeRegistry() {
    return {
      listManifests: () => [],
      dispatch: vi.fn(async () => ({ content: [{ text: 'result' }] })),
    };
  }

  it('stream() calls streamText once when no fallback configured', async () => {
    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    const mockStreamFn = streamText as ReturnType<typeof vi.fn>;
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
  });

  it('stream() calls streamText twice when fallback is configured (primary + fallback model params)', async () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'openai');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', 'gpt-4o-mini');

    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    // streamWithFallback calls streamText for primary immediately (sync)
    const mockStreamFn = streamText as ReturnType<typeof vi.fn>;
    expect(mockStreamFn).toHaveBeenCalledTimes(1);

    // First call should use ollama model
    const firstCallArgs = mockStreamFn.mock.calls[0][0] as { model: { provider: string } };
    expect(firstCallArgs.model).toMatchObject({ provider: 'ollama' });
  });

  it('getFallbackModelConfig returns correct config shape when fallback set to anthropic', () => {
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'anthropic');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', 'claude-3-5-sonnet-20241022');

    const primary = {
      provider: 'openai' as const,
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      temperature: 0.8,
      maxTokens: 4096,
    };

    const fallback = getFallbackModelConfig(primary);
    expect(fallback).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.8,
      maxTokens: 4096,
    });
  });

  it('stream() without fallback — streamText called with correct provider model', async () => {
    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'openai', model: 'gpt-4o-mini', endpoint: '' },
      {},
    );

    const mockStreamFn = streamText as ReturnType<typeof vi.fn>;
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamFn.mock.calls[0][0] as { model: { provider: string; modelId: string } };
    expect(callArgs.model).toMatchObject({ provider: 'openai', modelId: 'gpt-4o-mini' });
  });

   it('stream() with anthropic provider — streamText called with anthropic model', async () => {
    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', endpoint: '' },
      {},
    );

    const mockStreamFn = streamText as ReturnType<typeof vi.fn>;
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamFn.mock.calls[0][0] as { model: { provider: string; modelId: string } };
    expect(callArgs.model).toMatchObject({ provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022' });
  });
});

// ---- streamWithFallback — error-triggered fallback tests ----

describe('streamWithFallback — error-triggered fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTOMATE_FALLBACK_PROVIDER', 'openai');
    vi.stubEnv('AUTOMATE_FALLBACK_MODEL', 'gpt-4o-mini');
    vi.stubEnv('AUTOMATE_FALLBACK_ENDPOINT', '');
    delete process.env.AUTOMATE_FALLBACK_ENDPOINT; // eslint-disable-line test-flakiness/no-global-state-mutation
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function makeRegistry() {
    return {
      listManifests: () => [],
      dispatch: vi.fn(async () => ({ content: [{ text: 'result' }] })),
    };
  }

  function makePrimaryResultWithReject(errorMessage: string) {
    let rejectText!: (err: Error) => void;
    const textPromise = new Promise<string>((_resolve, reject) => {
      // eslint-disable-next-line test-flakiness/no-global-state-mutation
      rejectText = reject;
    });
    // Suppress unhandled rejection — streamWithFallback attaches its own handler
    textPromise.catch(() => undefined);

    const result = {
      toDataStreamResponse: () => new Response('ok'),
      text: textPromise,
    };

    return { result, rejectText: () => rejectText(new Error(errorMessage)) };
  }

  it.each([
    ['ECONNREFUSED connection refused', 'ECONNREFUSED 127.0.0.1:11434'],
    ['ENOTFOUND dns failure', 'ENOTFOUND localhost'],
    ['fetch failed', 'fetch failed'],
    ['401 unauthorized', '401 Unauthorized'],
    ['403 forbidden', '403 Forbidden'],
    ['Connection refused', 'Connection refused'],
    ['API key invalid', 'invalid API key provided'],
  ])(
    'retryable error "%s" triggers fallback streamText call',
    async (_label, errorMessage) => {
      const { result, rejectText } = makePrimaryResultWithReject(errorMessage);

      const mockStreamFn = vi.mocked(streamText);
      // First call returns the primary result that will reject; second call uses default mock
      mockStreamFn.mockReturnValueOnce(result as unknown as ReturnType<typeof streamText>);

      const { createOrchestrator } = await import('./orchestrator-loop.js');
      const orch = createOrchestrator(makeRegistry() as never);

      orch.stream(
        [{ role: 'user', content: 'hello' }],
        'system',
        { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
        {},
      );

      // Primary streamText called once synchronously
      expect(mockStreamFn).toHaveBeenCalledTimes(1);

      // Trigger the primary stream rejection
      rejectText();

      // Flush microtasks so the .then(undefined, handler) callback fires
      await new Promise((r) => setTimeout(r, 0));

      // Fallback streamText should have been called
      expect(mockStreamFn).toHaveBeenCalledTimes(2);

      // Second call must use the fallback model (openai/gpt-4o-mini)
      const fallbackCallArgs = mockStreamFn.mock.calls[1][0] as { model: { provider: string; modelId: string } };
      expect(fallbackCallArgs.model).toMatchObject({ provider: 'openai', modelId: 'gpt-4o-mini' });
    },
  );

  it('non-retryable error does NOT trigger fallback streamText call', async () => {
    const { result, rejectText } = makePrimaryResultWithReject('Internal server error');

    const mockStreamFn = vi.mocked(streamText);
    mockStreamFn.mockReturnValueOnce(result as unknown as ReturnType<typeof streamText>);

    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    expect(mockStreamFn).toHaveBeenCalledTimes(1);

    rejectText();
    await new Promise((r) => setTimeout(r, 0));

    // Still only 1 call — no fallback for non-retryable error
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
  });

  it('logs console.warn when primary fails with retryable error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result, rejectText } = makePrimaryResultWithReject('ECONNREFUSED 127.0.0.1:11434');

    const mockStreamFn = vi.mocked(streamText);
    mockStreamFn.mockReturnValueOnce(result as unknown as ReturnType<typeof streamText>);

    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    rejectText();
    await new Promise((r) => setTimeout(r, 0));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Primary provider failed/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/openai\/gpt-4o-mini/);
  });

  it('does NOT log console.warn when primary fails with non-retryable error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result, rejectText } = makePrimaryResultWithReject('Something totally unexpected');

    const mockStreamFn = vi.mocked(streamText);
    mockStreamFn.mockReturnValueOnce(result as unknown as ReturnType<typeof streamText>);

    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    rejectText();
    await new Promise((r) => setTimeout(r, 0));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('silently swallows fallback error when both primary and fallback fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result: primaryResult, rejectText: rejectPrimary } =
      makePrimaryResultWithReject('ECONNREFUSED 127.0.0.1:11434');

    // Fallback also rejects
    let rejectFallback!: (err: Error) => void;
    const fallbackTextPromise = new Promise<string>((_resolve, reject) => {
      // eslint-disable-next-line test-flakiness/no-global-state-mutation
      rejectFallback = reject;
    });
    fallbackTextPromise.catch(() => undefined);

    const fallbackResult = {
      toDataStreamResponse: () => new Response('ok'),
      text: fallbackTextPromise,
    };

    const mockStreamFn = vi.mocked(streamText);
    // First call → primary (rejects), second call → fallback (also rejects)
    mockStreamFn
      .mockReturnValueOnce(primaryResult as unknown as ReturnType<typeof streamText>)
      .mockReturnValueOnce(fallbackResult as unknown as ReturnType<typeof streamText>);

    const { createOrchestrator } = await import('./orchestrator-loop.js');
    const orch = createOrchestrator(makeRegistry() as never);

    orch.stream(
      [{ role: 'user', content: 'hello' }],
      'system',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      {},
    );

    // Trigger primary failure → initiates fallback
    rejectPrimary();
    await new Promise((r) => setTimeout(r, 0));

    // Verify fallback was attempted (second streamText call)
    expect(mockStreamFn).toHaveBeenCalledTimes(2);

    // console.warn was called for the fallback attempt (primary error log)
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Primary provider failed/);

    // Now trigger fallback failure — should be swallowed silently (no throw, no extra warn)
    rejectFallback(new Error('openai API error'));
    await new Promise((r) => setTimeout(r, 0));

    // Still only 1 warn — fallback error is silently swallowed
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
