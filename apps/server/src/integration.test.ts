// apps/server/src/integration.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock connector manifest imports so tests don't require packages to be built
vi.mock('../../../../packages/connectors/github/src/index.js', () => ({
  githubManifest: {
    name: 'github',
    version: '0.1.0',
    displayName: 'GitHub',
    description: 'GitHub connector',
    icon: 'github',
    credentialSchema: {},
    tools: [{ name: 'create_issue', description: 'Create issue', inputSchema: {}, handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
  },
}));
vi.mock('../../../../packages/connectors/jira/src/index.js', () => ({
  jiraManifest: {
    name: 'jira',
    version: '0.1.0',
    displayName: 'Jira',
    description: 'Jira connector',
    icon: 'jira',
    credentialSchema: {},
    tools: [{ name: 'create_ticket', description: 'Create ticket', inputSchema: {}, handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
  },
}));
vi.mock('../../../../packages/connectors/slack/src/index.js', () => ({
  slackManifest: {
    name: 'slack',
    version: '0.1.0',
    displayName: 'Slack',
    description: 'Slack connector',
    icon: 'slack',
    credentialSchema: {},
    tools: [{ name: 'send_message', description: 'Send message', inputSchema: {}, handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
  },
}));

vi.mock('./db/migrate.js', () => ({
  migrateDb: vi.fn().mockResolvedValue(undefined),
  runDrizzleMigrations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./db/seed.js', () => ({
  seed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./db/client.js', () => {
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
        })),
        then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { buildServer } from './index.js';

// Mock Ollama to avoid actual LLM calls in tests
// Mock orchestrator-loop to avoid real LLM/tool calls
vi.mock('./agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(() => ({
    stream: vi.fn(() => Promise.resolve({
      toTextStreamResponse: () =>
        new Response(
          'data: {"type":"text-delta","text":"Hello from Automate!"}\n\ndata: [DONE]\n\n',
          {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          }
        ),
    })),
    buildStreamParams: vi.fn(),
  })),
}));

describe('Automate Integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('health check works', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', version: '1.0.0', db: 'connected' });
  });

  it('chat endpoint streams response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('text-delta');
  });

  it('rejects invalid chat requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: 'not-an-array' },
    });

    expect(response.statusCode).toBe(400);
  });
});
