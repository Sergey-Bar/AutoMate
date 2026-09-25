import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

const criticMocks = vi.hoisted(() => ({
  runCritic: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: fsMocks.readFile,
  writeFile: fsMocks.writeFile,
  mkdir: fsMocks.mkdir,
}));

vi.mock('../ai-critic.js', () => ({
  runCritic: criticMocks.runCritic,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('aiRoutes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { aiRoutes } = await import('../ai-explain.js');
    app = Fastify({ logger: false });
    await app.register(aiRoutes);
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.mkdir.mockResolvedValue(undefined);
    criticMocks.runCritic.mockResolvedValue({
      validated: true,
      confidence: 0.8,
      critique: 'Diagnosis looks correct',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/ai/explain returns 404 when AI is not configured', async () => {
    fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'timeout exceeded' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'AI not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/ai/explain returns explanation for OpenAI config', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-openai-secret-1234',
        model: 'gpt-4o-mini',
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'This test is failing because the locator resolves to multiple elements.\nSuggestion: scope the locator by role and name in the test.',
            },
          },
        ],
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'strict mode violation in test locator' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      summary: 'This test is failing because the locator resolves to multiple elements.',
      suggestion: 'Suggestion: scope the locator by role and name in the test.',
      confidence: 0.8,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai-secret-1234',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('POST /api/ai/explain handles Anthropic response format', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'anthropic',
        apiKey: 'anthropic-key-abc',
        model: 'claude-3-5-sonnet',
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: 'Root cause in test setup.\nTry isolating shared state in beforeEach.' }],
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'shared mutable state leak' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      summary: 'Root cause in test setup.',
      suggestion: 'Try isolating shared state in beforeEach.',
      confidence: 0.8,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    const body = JSON.parse(options.body) as {
      system: string;
      messages: Array<{ role: string; content: string }>;
      model: string;
      max_tokens: number;
    };
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining('Error: shared mutable state leak') }]);
    expect(body.system).toContain('test automation expert');
    expect(options.headers['x-api-key']).toBe('anthropic-key-abc');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('POST /api/ai/explain returns 500 when AI API fails', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-fail-999',
        model: 'gpt-4o-mini',
      }),
    );
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'unauthorized test call' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: 'Failed to generate explanation',
      details: 'AI API error: 401 Unauthorized',
    });
  });

  it('POST /api/ai/explain includes truncated stack trace and test code in prompt', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-prompt-777',
        model: 'gpt-4o-mini',
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Failure likely in test assertion.\nSuggestion: align expected text with actual output in test.' } }],
      }),
    });

    const stack = Array.from({ length: 12 }, (_, i) => `line-${i + 1}`).join('\n');
    const testCode = `test('x', async () => {\n${'a'.repeat(700)}\n});`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: {
        error: 'assertion failed',
        stack,
        testCode,
      },
    });

    expect(res.statusCode).toBe(200);

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = body.messages[1].content;

    expect(prompt).toContain('Stack trace:\nline-1');
    expect(prompt).toContain('line-10');
    expect(prompt).not.toContain('line-11');
    expect(prompt).toContain('Test code:\n');
    expect(prompt).toContain(`test('x', async () => {`);
    expect(prompt).toContain('a'.repeat(400));
    expect(prompt).not.toContain('a'.repeat(600));
  });

  it('POST /api/ai/explain sets lower confidence for short generic response', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-low-111',
        model: 'gpt-4o-mini',
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Investigate logs.' } }] }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'some failure' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      summary: 'Investigate logs.',
      suggestion: 'Review the error details above',
      confidence: 0.5,
    });
  });

  it('GET /api/ai/config returns 404 when config is missing', async () => {
    fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));

    const res = await app.inject({ method: 'GET', url: '/api/ai/config' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'AI not configured' });
  });

  it('GET /api/ai/config returns masked API key', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-1234567890abcdefgh',
        model: 'gpt-4o-mini',
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/ai/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      provider: 'openai',
      apiKey: 'sk-12345...efgh',
      model: 'gpt-4o-mini',
    });
  });

  it('POST /api/ai/explain returns 404 when provider config is invalid', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        provider: 'unsupported-provider-xyz',
        apiKey: 'some-key',
        model: 'some-model',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'test error' },
    });

    // AiProviderConfigSchema.parse() throws for unknown provider → readConfig returns null → 404
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'AI not configured' });
  });

  it('PUT /api/ai/config saves config and returns success', async () => {
    const payload = {
      provider: 'ollama',
      model: 'llama3.1:8b',
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/ai/config',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(fsMocks.mkdir).toHaveBeenCalledWith(expect.stringContaining('.automate'), { recursive: true });
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);

    const [writtenPath, writtenJson, encoding] = fsMocks.writeFile.mock.calls[0] as [string, string, string];
    expect(writtenPath).toContain('.automate');
    expect(encoding).toBe('utf-8');
    expect(JSON.parse(writtenJson)).toEqual(payload);
  });

  it('POST /api/ai/explain injects spec context when spec-aware-triage is enabled', async () => {
    // Enable the feature flag
    const originalEnv = process.env['FEATURE_SPEC_AWARE_TRIAGE'];
    process.env['FEATURE_SPEC_AWARE_TRIAGE'] = 'true';

    try {
      fsMocks.readFile.mockResolvedValue(
        JSON.stringify({
          provider: 'openai',
          apiKey: 'sk-spec-test-123',
          model: 'gpt-4o-mini',
        }),
      );
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Contract violation detected.\nSuggestion: Check the spec.' } }],
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/explain',
        payload: {
          error: 'Expected 200 but got 404',
          specContext: 'Endpoint: GET /pets\nExpected Status: 200',
        },
      });

      expect(res.statusCode).toBe(200);

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as { messages: Array<{ role: string; content: string }> };
      const prompt = body.messages[1].content;
      expect(prompt).toContain('API Specification Context:');
      expect(prompt).toContain('Endpoint: GET /pets');
    } finally {
      if (originalEnv === undefined) {
        delete process.env['FEATURE_SPEC_AWARE_TRIAGE'];
      } else {
        process.env['FEATURE_SPEC_AWARE_TRIAGE'] = originalEnv;
      }
    }
  });

  it('POST /api/ai/explain does NOT inject spec context when feature is disabled', async () => {
    const originalEnv = process.env['FEATURE_SPEC_AWARE_TRIAGE'];
    delete process.env['FEATURE_SPEC_AWARE_TRIAGE']; // Default is false

    try {
      fsMocks.readFile.mockResolvedValue(
        JSON.stringify({
          provider: 'openai',
          apiKey: 'sk-spec-off-456',
          model: 'gpt-4o-mini',
        }),
      );
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Some analysis.\nSuggestion: Fix the test.' } }],
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/explain',
        payload: {
          error: 'Expected 200 but got 404',
          specContext: 'Endpoint: GET /pets\nExpected Status: 200',
        },
      });

      expect(res.statusCode).toBe(200);

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as { messages: Array<{ role: string; content: string }> };
      const prompt = body.messages[1].content;
      expect(prompt).not.toContain('API Specification Context:');
    } finally {
      if (originalEnv !== undefined) {
        process.env['FEATURE_SPEC_AWARE_TRIAGE'] = originalEnv;
      }
    }
  });

  it('POST /api/ai/explain ignores specContext when empty string even if feature enabled', async () => {
    const originalEnv = process.env['FEATURE_SPEC_AWARE_TRIAGE'];
    process.env['FEATURE_SPEC_AWARE_TRIAGE'] = 'true';

    try {
      fsMocks.readFile.mockResolvedValue(
        JSON.stringify({
          provider: 'openai',
          apiKey: 'sk-empty-ctx-789',
          model: 'gpt-4o-mini',
        }),
      );
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Some analysis.\nSuggestion: Fix.' } }],
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/explain',
        payload: {
          error: 'test error',
          specContext: '',
        },
      });

      expect(res.statusCode).toBe(200);

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as { messages: Array<{ role: string; content: string }> };
      const prompt = body.messages[1].content;
      expect(prompt).not.toContain('API Specification Context:');
    } finally {
      if (originalEnv === undefined) {
        delete process.env['FEATURE_SPEC_AWARE_TRIAGE'];
      } else {
        process.env['FEATURE_SPEC_AWARE_TRIAGE'] = originalEnv;
      }
    }
  });
});

describe('buildSpecContext', () => {
  it('formats spec context string correctly', async () => {
    const { buildSpecContext } = await import('../ai-explain.js');
    const result = buildSpecContext('{ "responses": { "200": {} } }', 'GET /pets', 200);
    expect(result).toBe('Endpoint: GET /pets\nExpected Status: 200\nSpec Snippet:\n{ "responses": { "200": {} } }');
  });
});

describe('dual-agent RCA', () => {
  let dualApp: FastifyInstance;

  beforeAll(async () => {
    const { aiRoutes } = await import('../ai-explain.js');
    dualApp = Fastify({ logger: false });
    await dualApp.register(aiRoutes);
    await dualApp.ready();
  });

  afterAll(async () => {
    await dualApp.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.mkdir.mockResolvedValue(undefined);
  });

  it('uses single-pass when dualAgentRca is not set', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'This test timed out.\nSuggestion: Increase timeout in test config.' } }],
      }),
    });

    const res = await dualApp.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'timeout exceeded' },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('validated');
    expect(body).not.toHaveProperty('critique');
    expect(criticMocks.runCritic).not.toHaveBeenCalled();
  });

  it('uses single-pass when dualAgentRca is false', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', dualAgentRca: false }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Some failure.\nSuggestion: Fix the test.' } }],
      }),
    });

    const res = await dualApp.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'some error' },
    });

    expect(res.statusCode).toBe(200);
    expect(criticMocks.runCritic).not.toHaveBeenCalled();
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('critique');
  });

  it('calls critic when dualAgentRca is true', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', dualAgentRca: true }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Root cause found.\nSuggestion: Fix the assertion.' } }],
      }),
    });
    criticMocks.runCritic.mockResolvedValue({
      validated: true,
      confidence: 0.92,
      critique: 'Diagnosis is accurate.',
      adjustedSummary: undefined,
      adjustedSuggestion: undefined,
    });

    const res = await dualApp.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'assertion failed' },
    });

    expect(res.statusCode).toBe(200);
    expect(criticMocks.runCritic).toHaveBeenCalledTimes(1);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('criticConfidence', 0.92);
    expect(body).toHaveProperty('critique', 'Diagnosis is accurate.');
    expect(body).toHaveProperty('validated', true);
  });

  it('uses critic adjusted summary when provided', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', dualAgentRca: true }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Original summary.\nSuggestion: Original suggestion.' } }],
      }),
    });
    criticMocks.runCritic.mockResolvedValue({
      validated: false,
      confidence: 0.3,
      critique: 'The analyzer missed the real cause.',
      adjustedSummary: 'Adjusted root cause from critic.',
      adjustedSuggestion: 'Better fix from critic.',
    });

    const res = await dualApp.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'connection refused' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('summary', 'Adjusted root cause from critic.');
    expect(body).toHaveProperty('suggestion', 'Better fix from critic.');
    expect(body).toHaveProperty('validated', false);
  });

  it('returns critic fallback when critic provides validation timed out', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', dualAgentRca: true }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Analyzer result.\nSuggestion: Try something.' } }],
      }),
    });
    criticMocks.runCritic.mockResolvedValue({
      validated: false,
      confidence: 0.5,
      critique: 'Validation timed out',
      adjustedSummary: undefined,
      adjustedSuggestion: undefined,
    });

    const res = await dualApp.inject({
      method: 'POST',
      url: '/api/ai/explain',
      payload: { error: 'network error' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('critique', 'Validation timed out');
    expect(body).toHaveProperty('validated', false);
    expect(body).toHaveProperty('confidence', 0.5);
  });
});
