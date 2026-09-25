import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toUIMessageStreamResponse: () =>
        new Response('data: {"type":"text-delta","text":"planner"}\n\ndata: [DONE]\n\n', {
          headers: {
            'Content-Type': 'text/event-stream',
            'X-Vercel-AI-UI-Message-Stream': 'v1',
          },
        }),
    })),
  };
});

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: vi.fn(() => vi.fn(() => ({}))),
  ollama: vi.fn(() => ({})),
}));

import { createPlannerConfig } from './planner.js';

describe('planner config', () => {
  it('uses provided model config', () => {
    const config = createPlannerConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.5,
      maxTokens: 2048,
    });

    expect(config.temperature).toBe(0.5);
    expect(config.maxTokens).toBe(2048);
  });
});
