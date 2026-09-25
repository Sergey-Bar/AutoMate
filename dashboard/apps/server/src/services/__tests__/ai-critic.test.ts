import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('runCritic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseConfig = { provider: 'openai' as const, apiKey: 'sk-test', model: 'gpt-4o-mini' };
  const baseInput = {
    error: 'Expected 200, got 500',
    analyzerSummary: 'The server returned 500',
    analyzerSuggestion: 'Check server logs',
    config: baseConfig,
  };

  it('returns validated result when critic agrees', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"validated": true, "confidence": 0.9, "critique": "Diagnosis is accurate.", "adjustedSummary": "Server error confirmed.", "adjustedSuggestion": "Check DB connection"}',
            },
          },
        ],
      }),
    });
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic(baseInput);
    expect(result.validated).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.critique).toBe('Diagnosis is accurate.');
    expect(result.adjustedSummary).toBe('Server error confirmed.');
  });

  it('returns fallback when critic times out', async () => {
    // Never resolves
    fetchMock.mockReturnValue(new Promise<never>(() => undefined));
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic({ ...baseInput, timeoutMs: 50 });
    expect(result.validated).toBe(false);
    expect(result.confidence).toBe(0.5);
    expect(result.critique).toBe('Validation timed out');
  });

  it('returns fallback when critic response is not valid JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'This is not JSON at all.' } }],
      }),
    });
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic(baseInput);
    expect(result.validated).toBe(false);
    expect(result.confidence).toBe(0.5);
    expect(result.critique).toContain('parsed');
  });

  it('returns fallback when fetch rejects with network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic(baseInput);
    expect(result.validated).toBe(false);
    expect(result.confidence).toBe(0.5);
    expect(result.critique).toContain('Critic failed');
  });

  it('handles JSON embedded in markdown fences', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '```json\n{"validated": false, "confidence": 0.3, "critique": "Missed the real cause", "adjustedSummary": "Different root cause", "adjustedSuggestion": "Try this"}\n```',
            },
          },
        ],
      }),
    });
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic(baseInput);
    expect(result.validated).toBe(false);
    expect(result.confidence).toBe(0.3);
    expect(result.adjustedSummary).toBe('Different root cause');
  });

  it('clamps confidence to [0, 1] range', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"validated": true, "confidence": 1.5, "critique": "Very confident", "adjustedSummary": null, "adjustedSuggestion": null}',
            },
          },
        ],
      }),
    });
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic(baseInput);
    expect(result.confidence).toBe(1);
  });

  it('omits adjustedSummary/adjustedSuggestion when they are null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"validated": true, "confidence": 0.8, "critique": "Good diagnosis", "adjustedSummary": null, "adjustedSuggestion": null}',
            },
          },
        ],
      }),
    });
    const { runCritic } = await import('../ai-critic.js');
    const result = await runCritic(baseInput);
    expect(result.adjustedSummary).toBeUndefined();
    expect(result.adjustedSuggestion).toBeUndefined();
  });

  it('includes stack and testCode in prompt when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"validated": true, "confidence": 0.85, "critique": "Accurate"}',
            },
          },
        ],
      }),
    });
    const { runCritic } = await import('../ai-critic.js');
    await runCritic({
      ...baseInput,
      stack: 'at Object.<anonymous> (test.spec.ts:10:5)\nat Context.<anonymous>',
      testCode: 'expect(response.status).toBe(200);',
    });
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { messages: Array<{ content: string }> };
    const promptContent = body.messages[1]?.content ?? '';
    expect(promptContent).toContain('Stack:');
    expect(promptContent).toContain('Test code:');
  });
});
