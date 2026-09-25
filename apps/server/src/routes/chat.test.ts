import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes, ChatBodySchema, toSseEvent, type ChatDeps } from './chat.js';
import { createMemoryRepository } from '../agent/memory.js';
import { ConnectorRegistry } from '../connectors/registry.js';
import { createOrchestrator } from '../agent/orchestrator-loop.js';

// Mock the orchestrator-loop module
vi.mock('../agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(() => ({
    stream: vi.fn(() => Promise.resolve({
      toTextStreamResponse: () =>
        new Response('data: {"type":"text-delta","text":"hello"}\n\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }),
    })),
    buildStreamParams: vi.fn(),
  })),
}));

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
    getSystemPrompt: () => 'You are Automate, an AI assistant for QA automation.',
    ...overrides,
  };
}

describe('chatRoutes', () => {
  it('registers POST /api/chat with provided rateLimitConfig', async () => {
    const app = Fastify();
    const rateLimitConfig = {
      rateLimit: {
        max: 7,
        timeWindow: '30 seconds',
      },
    };
    const deps = createTestDeps({ rateLimitConfig });

    let chatRouteConfig: unknown;
    app.addHook('onRoute', (routeOptions) => {
      const method = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method];

      if (routeOptions.url === '/api/chat' && method.includes('POST')) {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
        chatRouteConfig = routeOptions.config;
      }
    });

    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    expect(chatRouteConfig).toEqual(rateLimitConfig);

    await app.close();
  });

  it('POST /api/chat returns stream response for valid messages', async () => {
    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const messages = [{ role: 'user', content: 'Hi' }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('data:');

    await app.close();
  });

  it('POST /api/chat returns 400 when messages are missing', async () => {
    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toContain('messages');

    await app.close();
  });

  it('creates conversation and saves user message', async () => {
    const memory = createMemoryRepository();
    const app = Fastify();
    const deps = createTestDeps({ memory });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const messages = [{ role: 'user', content: 'Hello Automate' }];
    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages },
    });

    const conversations = await memory.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toBe('Hello Automate');

    const msgs = await memory.listMessages(conversations[0].id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hello Automate');

    await app.close();
  });

  it('creates conversation title truncated to 100 chars', async () => {
    const memory = createMemoryRepository();
    const app = Fastify();
    const deps = createTestDeps({ memory });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const longContent = 'A'.repeat(150);
    const messages = [{ role: 'user', content: longContent }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages },
    });

    expect(response.statusCode).toBe(200);
    const conversations = await memory.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toHaveLength(100);
    expect(conversations[0].title).toBe(longContent.slice(0, 100));

    await app.close();
  });

  it('POST /api/chat returns 400 when request body is missing', async () => {
    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');

    await app.close();
  });

  it('POST /api/chat with conversationId does not create conversation and still saves user message', async () => {
    const mockMemory = {
      saveConversation: vi.fn(async () => {}),
      saveMessage: vi.fn(async () => {}),
      listConversations: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      getConversation: vi.fn(async () => null),
      deleteConversation: vi.fn(async () => {}),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const app = Fastify();
    const deps = createTestDeps({ memory: mockMemory as ChatDeps['memory'] });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const conversationId = 'existing-conv-id';
    const messages = [{ role: 'user', content: 'Continue this thread' }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages, conversationId },
    });

    expect(response.statusCode).toBe(200);
    expect(mockMemory.saveConversation).not.toHaveBeenCalled();
    expect(mockMemory.saveMessage).toHaveBeenCalledTimes(1);
    expect(mockMemory.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        role: 'user',
        content: 'Continue this thread',
      }),
    );

    await app.close();
  });

  it('POST /api/chat skips saveMessage when last message is not from user', async () => {
    const memory = createMemoryRepository();
    const saveMessageSpy = vi.spyOn(memory, 'saveMessage');

    const app = Fastify();
    const deps = createTestDeps({ memory });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const messages = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Intermediate response' },
    ];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages },
    });

    expect(response.statusCode).toBe(200);
    expect(saveMessageSpy).not.toHaveBeenCalled();

    const conversations = await memory.listConversations();
    expect(conversations).toHaveLength(1);
    const savedMessages = await memory.listMessages(conversations[0].id);
    expect(savedMessages).toEqual([]);

    await app.close();
  });

  it('POST /api/chat with empty messages array does not crash', async () => {
    const memory = createMemoryRepository();
    const saveMessageSpy = vi.spyOn(memory, 'saveMessage');

    const app = Fastify();
    const deps = createTestDeps({ memory });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(saveMessageSpy).not.toHaveBeenCalled();

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('messages');

    await app.close();
  });

  it('POST /api/chat with no user messages uses default title New Chat', async () => {
    const memory = createMemoryRepository();

    const app = Fastify();
    const deps = createTestDeps({ memory });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const messages = [{ role: 'assistant', content: 'System preamble' }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages },
    });

    expect(response.statusCode).toBe(200);
    const conversations = await memory.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toBe('New Chat');

    await app.close();
  });

  it('POST /api/chat with eventHub passes onToolStart and onToolExecute callbacks', async () => {
    const app = Fastify();
    const eventHub = {
      broadcast: vi.fn(),
    };
    const deps = createTestDeps({ eventHub: eventHub as unknown as ChatDeps['eventHub'] });

    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const conversationId = 'conv-for-events';
    const messages = [{ role: 'user', content: 'Run a tool' }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages, conversationId },
    });

    expect(response.statusCode).toBe(200);

    const createOrchestratorMock = vi.mocked(createOrchestrator);
    const orchestratorInstance = createOrchestratorMock.mock.results.at(-1)?.value;
    expect(orchestratorInstance).toBeDefined();

    const streamCalls = orchestratorInstance.stream.mock.calls;
    expect(streamCalls).toHaveLength(1);
    const options = streamCalls[0][4];

    expect(options.conversationId).toBe(conversationId);
    expect(options.onToolStart).toBeTypeOf('function');
    expect(options.onToolExecute).toBeTypeOf('function');

    options.onToolStart('search-docs');
    expect(eventHub.broadcast).toHaveBeenCalledWith({
      type: 'tool:start',
      payload: { toolName: 'search-docs', conversationId },
    });

    options.onToolExecute({
      toolName: 'search-docs',
      status: 'completed',
      durationMs: 42,
    });
    expect(eventHub.broadcast).toHaveBeenCalledWith({
      type: 'tool:complete',
      payload: {
        toolName: 'search-docs',
        conversationId,
        durationMs: 42,
      },
    });

    options.onToolExecute({
      toolName: 'search-docs',
      status: 'error',
      durationMs: 11,
      errorMessage: 'boom',
    });
    expect(eventHub.broadcast).toHaveBeenCalledWith({
      type: 'tool:error',
      payload: {
        toolName: 'search-docs',
        conversationId,
        durationMs: 11,
        error: 'boom',
      },
    });

    await app.close();
  });

  it('POST /api/chat without eventHub passes undefined tool callbacks', async () => {
    const app = Fastify();
    const deps = createTestDeps();

    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const messages = [{ role: 'user', content: 'No events expected' }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages },
    });

    expect(response.statusCode).toBe(200);

    const createOrchestratorMock = vi.mocked(createOrchestrator);
    const orchestratorInstance = createOrchestratorMock.mock.results.at(-1)?.value;
    expect(orchestratorInstance).toBeDefined();

    const streamCalls = orchestratorInstance.stream.mock.calls;
    expect(streamCalls).toHaveLength(1);
    const options = streamCalls[0][4];

    expect(options.onToolStart).toBeUndefined();
    expect(options.onToolExecute).toBeUndefined();

    await app.close();
  });

  it('POST /api/chat returns 400 when messages is not an array', async () => {
    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: 'not-an-array' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('messages');

    await app.close();
  });
});

describe('ChatBodySchema', () => {
  it('accepts valid messages with optional conversationId', () => {
    const result = ChatBodySchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
      conversationId: 'abc-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid messages with optional flowTemplate', () => {
    const result = ChatBodySchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
      flowTemplate: 'qa-assistant',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty messages array', () => {
    const result = ChatBodySchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  it('rejects messages with invalid shape', () => {
    const result = ChatBodySchema.safeParse({
      messages: [{ role: 123, content: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object body', () => {
    const result = ChatBodySchema.safeParse('not-an-object');
    expect(result.success).toBe(false);
  });
});

describe('toSseEvent', () => {
  it('formats data event frame', () => {
    const event = toSseEvent({ type: 'text-delta', text: 'Hi' });
    expect(event).toContain('data:');
    expect(event).toContain('"text-delta"');
    expect(event.endsWith('\n\n')).toBe(true);
  });
});

describe('chatRoutes — flow template', () => {
  it('calls getFlowTemplate with the provided flowTemplate id', async () => {
    const getFlowTemplate = vi.fn(async () => undefined);
    const app = Fastify();
    const deps = createTestDeps({ getFlowTemplate });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Which tests are most risky?' }],
        flowTemplate: 'qa-assistant',
      },
    });

    expect(getFlowTemplate).toHaveBeenCalledWith('qa-assistant');

    await app.close();
  });

  it('prepends the flow template systemPrompt to the base system prompt', async () => {
    const templateSystemPrompt = 'You are a QA intelligence assistant.';
    const getFlowTemplate = vi.fn(async () => ({
      id: 'qa-assistant',
      name: 'QA Assistant',
      description: 'Test assistant',
      systemPrompt: templateSystemPrompt,
      steps: null,
      category: 'qa-intelligence',
      isBuiltIn: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }));

    const app = Fastify();
    const deps = createTestDeps({ getFlowTemplate });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Is it safe to release?' }],
        flowTemplate: 'qa-assistant',
      },
    });

    expect(response.statusCode).toBe(200);

    const createOrchestratorMock = vi.mocked(createOrchestrator);
    const orchestratorInstance = createOrchestratorMock.mock.results.at(-1)?.value;
    const streamCalls = orchestratorInstance.stream.mock.calls;
    expect(streamCalls).toHaveLength(1);
    const usedSystemPrompt: string = streamCalls[0][1];

    expect(usedSystemPrompt).toContain(templateSystemPrompt);
    expect(usedSystemPrompt).toContain('You are Automate');
    expect(usedSystemPrompt.indexOf(templateSystemPrompt)).toBeLessThan(
      usedSystemPrompt.indexOf('You are Automate'),
    );

    await app.close();
  });

  it('uses default system prompt when getFlowTemplate returns undefined (template not found)', async () => {
    const getFlowTemplate = vi.fn(async () => undefined);

    const app = Fastify();
    const deps = createTestDeps({ getFlowTemplate });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Show me the flakiest tests' }],
        flowTemplate: 'nonexistent-template',
      },
    });

    expect(response.statusCode).toBe(200);

    const createOrchestratorMock = vi.mocked(createOrchestrator);
    const orchestratorInstance = createOrchestratorMock.mock.results.at(-1)?.value;
    const streamCalls = orchestratorInstance.stream.mock.calls;
    expect(streamCalls).toHaveLength(1);
    const usedSystemPrompt: string = streamCalls[0][1];

    expect(usedSystemPrompt).toBe('You are Automate, an AI assistant for QA automation.');

    await app.close();
  });

  it('uses default system prompt when getFlowTemplate throws (error is caught gracefully)', async () => {
    const getFlowTemplate = vi.fn(async () => {
      throw new Error('db error loading template');
    });

    const app = Fastify();
    const deps = createTestDeps({ getFlowTemplate });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Show me the flakiest tests' }],
        flowTemplate: 'qa-assistant',
      },
    });

    // Should still return 200 — error is caught and default prompt is used
    expect(response.statusCode).toBe(200);

    const createOrchestratorMock = vi.mocked(createOrchestrator);
    const orchestratorInstance = createOrchestratorMock.mock.results.at(-1)?.value;
    const streamCalls = orchestratorInstance.stream.mock.calls;
    expect(streamCalls).toHaveLength(1);
    const usedSystemPrompt: string = streamCalls[0][1];

    expect(usedSystemPrompt).toBe('You are Automate, an AI assistant for QA automation.');

    await app.close();
  });
});

describe('chatRoutes — error paths', () => {
  it('stream fails after headers sent: route completes with status 200 and does not crash', async () => {
    // Build a ReadableStream that yields one chunk then throws
    const encoder = new TextEncoder();
    const streamWithError = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"text-delta","text":"hi"}\n\n'));
        controller.error(new Error('stream error mid-flight'));
      },
    });

    vi.mocked(createOrchestrator).mockReturnValueOnce({
      stream: vi.fn(() =>
        Promise.resolve({
          toTextStreamResponse: () =>
            new Response(streamWithError, {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            }),
        }),
      ),
      buildStreamParams: vi.fn(),
    } as unknown as ReturnType<typeof createOrchestrator>);

    const app = Fastify();
    const deps = createTestDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    // Should not throw — the route catches the stream error and ends the raw response
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Test stream error' }] },
    });

    // Headers were already sent (writeHead called), so status 200 is already committed
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('returns 500 when getModelConfig throws', async () => {
    const app = Fastify();
    const deps = createTestDeps({
      getModelConfig: async () => {
        throw new Error('config error');
      },
    });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('Failed to initialize AI configuration');

    await app.close();
  });

  it('returns 500 when memory.saveConversation throws', async () => {
    const mockMemory = {
      saveConversation: vi.fn(async () => {
        throw new Error('db write error');
      }),
      saveMessage: vi.fn(async () => {}),
      listConversations: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      getConversation: vi.fn(async () => null),
      deleteConversation: vi.fn(async () => {}),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const app = Fastify();
    const deps = createTestDeps({ memory: mockMemory as ChatDeps['memory'] });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    // No conversationId so saveConversation is called
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'New conversation' }] },
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('Failed to save conversation');

    await app.close();
  });

  it('returns 500 when memory.saveMessage throws', async () => {
    const mockMemory = {
      saveConversation: vi.fn(async () => {}),
      saveMessage: vi.fn(async () => {
        throw new Error('saveMessage db error');
      }),
      listConversations: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      getConversation: vi.fn(async () => null),
      deleteConversation: vi.fn(async () => {}),
      insertExecutionLog: vi.fn(async () => {}),
    };

    const app = Fastify();
    const deps = createTestDeps({ memory: mockMemory as ChatDeps['memory'] });
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Trigger saveMessage error' }] },
    });

    expect(response.statusCode).toBe(500);
    const body2 = response.json();
    expect(body2.error).toBe('Failed to save message');

    await app.close();
  });
});
