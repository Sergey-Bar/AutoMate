import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

// Mock connector packages to avoid requiring built workspace artifacts
vi.mock('@automate/connector-github', () => ({
  githubManifest: {
    name: 'github',
    version: '0.1.0',
    displayName: 'GitHub',
    description: 'GitHub connector',
    icon: 'github',
    credentialSchema: {},
    tools: [],
  },
}));

vi.mock('@automate/connector-jira', () => ({
  jiraManifest: {
    name: 'jira',
    version: '0.1.0',
    displayName: 'Jira',
    description: 'Jira connector',
    icon: 'jira',
    credentialSchema: {},
    tools: [],
  },
}));

vi.mock('@automate/connector-slack', () => ({
  slackManifest: {
    name: 'slack',
    version: '0.1.0',
    displayName: 'Slack',
    description: 'Slack connector',
    icon: 'slack',
    credentialSchema: {},
    tools: [],
  },
}));

// Mock orchestrator-loop to avoid real LLM/AI SDK calls
vi.mock('../agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(() => ({
    stream: vi.fn(() =>
      Promise.resolve({
        toTextStreamResponse: () =>
          new Response('data: {"type":"text-delta","text":"ok"}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
          }),
      }),
    ),
    buildStreamParams: vi.fn(),
  })),
}));

vi.mock('../db/client.js', () => {
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
        limit: vi.fn(() => Promise.resolve([])),
        then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    execute: vi.fn().mockResolvedValue([]),
  };
  return {
    db: mockDb,
    pgClient: Object.assign(vi.fn().mockResolvedValue([]), {
      unsafe: vi.fn().mockResolvedValue([]),
      end: vi.fn().mockResolvedValue(undefined),
    }),
    closeDb: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../db/migrate.js', () => ({
  migrateDb: vi.fn().mockResolvedValue(undefined),
  runDrizzleMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/seed.js', () => ({
  seed: vi.fn().mockResolvedValue(undefined),
}));

import { buildServer } from '../index.js';

const fetchMock = vi.fn().mockResolvedValue({ ok: false } as Response);

describe('buildServer', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);
    app = await buildServer({ logger: false });
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('returns a Fastify instance with an inject method', () => {
    expect(typeof app.inject).toBe('function');
  });

  it('returns a Fastify instance with a close method', () => {
    expect(typeof app.close).toBe('function');
  });

  it('GET /health returns HTTP 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health body has status ok and db connected', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json() as { status: string; db: string; ollama: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(body.version).toBe('1.0.0');
  });

  it('GET /health reports ollama as disconnected when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json() as { ollama: string };
    expect(body.ollama).toBe('disconnected');
  });

  it('GET /health reports ollama as connected when fetch succeeds', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json() as { ollama: string };
    expect(body.ollama).toBe('connected');
  });

  it('GET /health includes uptime field', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json() as { uptime: unknown };
    expect(typeof body.uptime).toBe('number');
  });

  it('buildServer accepts rateLimitMax option without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const tempApp = await buildServer({ logger: false, rateLimitMax: 50, rateLimitWindow: '30 seconds' });
    await tempApp.close();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
  });
});
