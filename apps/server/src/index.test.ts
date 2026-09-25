import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all route modules
vi.mock('./routes/chat.js', () => ({
  chatRoutes: vi.fn(async () => {}),
}));
vi.mock('./routes/conversations.js', () => ({
  conversationRoutes: vi.fn(async (_app: unknown, _opts: unknown, done: () => void) => {
    done();
  }),
}));
vi.mock('./routes/connectors.js', () => ({
  connectorRoutes: vi.fn(async () => {}),
}));
vi.mock('./routes/model-config.js', () => ({
  modelConfigRoutes: vi.fn(async () => {}),
}));
vi.mock('./routes/vault.js', () => ({
  vaultRoutes: vi.fn(async () => {}),
}));
vi.mock('./routes/ws.js', () => ({
  wsRoutes: vi.fn(async () => {}),
}));
vi.mock('./services/feature-flags.js', () => ({
  isEnabled: vi.fn(() => false),
  requireFeature: vi.fn(() => async () => {}),
}));
vi.mock('./connectors/mcp-connector.js', () => ({
  buildDashboardMcpConnectorManifest: vi.fn(async () => ({
    name: 'dashboard_mcp',
    version: '1.0.0',
    displayName: 'Dashboard MCP',
    description: 'Dashboard analytics tools exposed via MCP.',
    icon: 'dashboard',
    credentialSchema: { safeParse: () => ({ success: true }) },
    tools: [],
  })),
  getDashboardMcpContractValidationState: vi.fn(() => ({
    contractVersion: '1.0.0',
    validationStatus: 'passed',
    diagnostics: 'ok',
    mismatches: [],
    lastValidationTimestamp: '2026-01-01T00:00:00.000Z',
  })),
}));

// Mock DB
vi.mock('./db/migrate.js', () => ({ migrateDb: vi.fn().mockResolvedValue(undefined), runDrizzleMigrations: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./db/seed.js', () => ({ seed: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./db/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
  closeDb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./db/schema.js', () => ({ modelConfig: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

// Mock memory
vi.mock('./agent/memory-drizzle.js', () => ({
  createDrizzleMemory: vi.fn(() => ({
    saveConversation: vi.fn(),
    saveMessage: vi.fn(),
    listConversations: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
  })),
}));

// Mock vault
const mockVaultService = {
  unlock: vi.fn<(password: string) => Promise<void>>(async () => {}),
  lock: vi.fn<() => void>(() => {}),
  getCredential: vi.fn<(connectorName: string) => Promise<string | null>>(async () => null),
  setCredential: vi.fn<(connectorName: string, secret: string) => Promise<void>>(async () => {}),
  deleteCredential: vi.fn<(connectorName: string) => Promise<void>>(async () => {}),
  isUnlocked: vi.fn<() => boolean>(() => false),
  close: vi.fn<() => void>(() => {}),
};
vi.mock('./vault/service.js', () => ({
  createVaultService: vi.fn(() => mockVaultService),
}));

// Mock connectors
vi.mock('@automate/connector-github', () => ({ githubManifest: { name: 'github', tools: [] } }));
vi.mock('@automate/connector-jira', () => ({ jiraManifest: { name: 'jira', tools: [] } }));
vi.mock('@automate/connector-slack', () => ({ slackManifest: { name: 'slack', tools: [] } }));

import { buildServer } from './index.js';
import { chatRoutes } from './routes/chat.js';
import { vaultRoutes } from './routes/vault.js';
import { migrateDb } from './db/migrate.js';
import { seed } from './db/seed.js';
import { createVaultService } from './vault/service.js';
import { isEnabled } from './services/feature-flags.js';
import {
  buildDashboardMcpConnectorManifest,
  getDashboardMcpContractValidationState,
} from './connectors/mcp-connector.js';

type ChatDepsSnapshot = {
  registry: {
    listManifests: () => Array<{ name: string }>;
  };
  getCredentials: () => Promise<Record<string, Record<string, string>>>;
  rateLimitConfig: {
    rateLimit: {
      max: number;
      timeWindow: string;
    };
  };
};

const originalFetch = globalThis.fetch;

function getChatDepsFromMock(): ChatDepsSnapshot {
  const calls = vi.mocked(chatRoutes).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]?.[1] as ChatDepsSnapshot;
}

describe('buildServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVaultService.getCredential.mockResolvedValue(null);
    mockVaultService.unlock.mockResolvedValue(undefined);
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network unavailable');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('buildServer() with no options returns app and runs migration/seed with default rate limit', async () => {
    const app = await buildServer();

    expect(app).toBeDefined();
    expect(vi.mocked(migrateDb)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(seed)).toHaveBeenCalledTimes(1);

    const deps = getChatDepsFromMock();
    expect(deps.rateLimitConfig).toEqual({
      rateLimit: {
        max: 100,
        timeWindow: '1 minute',
      },
    });

    await app.close();
  });

  it('registers /health endpoint and returns status ok', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;

    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      status: 'ok',
      version: '1.0.0',
      db: 'connected',
      ollama: 'connected',
    });

    await app.close();
  });

  it('/health sets ollama status to connected when fetch is ok', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;

    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().ollama).toBe('connected');

    await app.close();
  });

  it('/health sets ollama status to disconnected when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network error');
    }) as typeof fetch;

    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().ollama).toBe('disconnected');

    await app.close();
  });

  it('/health sets ollama status to error when fetch returns non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch;

    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().ollama).toBe('error');

    await app.close();
  });

  it('buildServer with vaultDbPath creates vault service but does not auto-unlock', async () => {
    const app = await buildServer({ vaultDbPath: '/tmp/test.db' });

    expect(vi.mocked(createVaultService)).toHaveBeenCalledWith();
    expect(mockVaultService.unlock).not.toHaveBeenCalled();

    await app.close();
  });

  it('buildServer with vaultDbPath and vaultPassword creates vault and unlocks it', async () => {
    const app = await buildServer({ vaultDbPath: '/tmp/test.db', vaultPassword: 'secret' });

    expect(vi.mocked(createVaultService)).toHaveBeenCalledWith();
    expect(mockVaultService.unlock).toHaveBeenCalledWith('secret');

    await app.close();
  });

  it('without vaultDbPath does not register vault routes and getCredentials returns empty object', async () => {
    const app = await buildServer();
    const deps = getChatDepsFromMock();

    expect(vi.mocked(vaultRoutes)).not.toHaveBeenCalled();
    await expect(deps.getCredentials()).resolves.toEqual({});

    await app.close();
  });

  it('with vaultDbPath registers vault routes and parses credentials safely', async () => {
    mockVaultService.getCredential.mockImplementation(async (name: string): Promise<string | null> => {
      if (name === 'github') return '{"token":"gh-token","refresh":"gh-refresh","count":5}';
      if (name === 'jira') return '{bad json';
      if (name === 'slack') return '"not-an-object"';
      return null;
    });

    const app = await buildServer({ vaultDbPath: '/tmp/test.db' });
    const deps = getChatDepsFromMock();

    expect(vi.mocked(vaultRoutes)).toHaveBeenCalledTimes(1);
    await expect(deps.getCredentials()).resolves.toEqual({
      github: {
        token: 'gh-token',
        refresh: 'gh-refresh',
      },
    });

    expect(mockVaultService.getCredential).toHaveBeenCalledWith('github');
    expect(mockVaultService.getCredential).toHaveBeenCalledWith('jira');
    expect(mockVaultService.getCredential).toHaveBeenCalledWith('slack');

    await app.close();
  });

  it('buildServer applies custom rate limit values in chat dependency config', async () => {
    const app = await buildServer({ rateLimitMax: 7, rateLimitWindow: '9 seconds' });
    const deps = getChatDepsFromMock();

    expect(deps.rateLimitConfig).toEqual({
      rateLimit: {
        max: 7,
        timeWindow: '9 seconds',
      },
    });

    await app.close();
  });

  it('registers dashboard_mcp manifest when mcp-client feature is enabled and tools are discovered', async () => {
    vi.mocked(isEnabled).mockImplementation((flag: string) => flag === 'mcp-client');
    vi.mocked(buildDashboardMcpConnectorManifest).mockResolvedValueOnce({
      name: 'dashboard_mcp',
      version: '1.0.0',
      displayName: 'Dashboard MCP',
      description: 'Dashboard tools',
      icon: 'dashboard',
      credentialSchema: { safeParse: () => ({ success: true }) } as never,
      tools: [
        {
          name: 'runs.list_recent',
          description: 'List recent',
          inputSchema: { parse: () => ({}) } as never,
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
      ],
    });

    const app = await buildServer();
    const deps = getChatDepsFromMock();
    const manifests = deps.registry.listManifests();

    expect(manifests.some((manifest) => manifest.name === 'dashboard_mcp')).toBe(true);
    expect(buildDashboardMcpConnectorManifest).toHaveBeenCalledTimes(1);
    expect(getDashboardMcpContractValidationState).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('continues startup when mcp connector registration fails', async () => {
    vi.mocked(isEnabled).mockImplementation((flag: string) => flag === 'mcp-client');
    vi.mocked(buildDashboardMcpConnectorManifest).mockRejectedValueOnce(new Error('mcp down'));

    const app = await buildServer();
    expect(app).toBeDefined();
    expect(buildDashboardMcpConnectorManifest).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
