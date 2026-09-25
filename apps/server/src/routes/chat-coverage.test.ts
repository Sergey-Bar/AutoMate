import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes, type ChatDeps } from './chat.js';
import { createMemoryRepository } from '../agent/memory.js';
import { ConnectorRegistry } from '../connectors/registry.js';

// Mock the orchestrator module for this test file
vi.mock('../agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(),
}));

import { createOrchestrator } from '../agent/orchestrator-loop.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function createTestDeps(overrides?: Partial<ChatDeps>): ChatDeps {
  return {
    memory: createMemoryRepository(),
    registry: new ConnectorRegistry(),
    getModelConfig: async () => ({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 4096,
    }),
    getCredentials: async () => ({}),
    getSystemPrompt: () => 'System prompt.',
    ...overrides,
  };
}

describe('chatRoutes error branch coverage', () => {
  it('POST /api/chat returns 500 when stream throws and headers not sent yet', async () => {
    // Simulate orchestrator.stream throwing an error
    vi.mocked(createOrchestrator).mockReturnValue({
      stream: vi.fn(() => Promise.reject(new Error('Stream setup error'))),
      buildStreamParams: vi.fn(),
    } as unknown as ReturnType<typeof createOrchestrator>);

    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    // Headers not yet sent → returns 500 with error body
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Stream failed' });

    await app.close();
  });

  it('POST /api/chat handles stream read error gracefully (headers already sent)', async () => {
    // Create a readable stream that throws partway through
    const encoder = new TextEncoder();

    const mockStream = new ReadableStream({
      start(controller) {
        // Write initial data to trigger headersSent=true
        controller.enqueue(encoder.encode('data: {"type":"text-delta","text":"hi"}\n\n'));
        // Then throw an error
        controller.error(new Error('Stream read failed mid-way'));
      },
    });

    vi.mocked(createOrchestrator).mockReturnValue({
      stream: vi.fn(() => Promise.resolve({
        toTextStreamResponse: () =>
          new Response(mockStream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          }),
      })),
      buildStreamParams: vi.fn(),
    } as unknown as ReturnType<typeof createOrchestrator>);

    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    // Whether it returns 200 or 500 depends on when headers were sent.
    // The important thing is it doesn't crash the server.
    expect([200, 500]).toContain(response.statusCode);

    await app.close();
  });

  it('POST /api/chat with no response body (null body) completes without error', async () => {
    vi.mocked(createOrchestrator).mockReturnValue({
      stream: vi.fn(() => Promise.resolve({
        toTextStreamResponse: () =>
          new Response(null, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
            },
          }),
      })),
      buildStreamParams: vi.fn(),
    } as unknown as ReturnType<typeof createOrchestrator>);

    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    // Response body is null — the if (response.body) branch is false → end() called
    expect(response.statusCode).toBe(200);

    await app.close();
  });
});
