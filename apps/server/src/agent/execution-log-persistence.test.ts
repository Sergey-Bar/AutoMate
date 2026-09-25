import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { createDrizzleMemory } from './memory-drizzle.js';
import { createMemoryRepository } from './memory.js';
import type { ExecutionLogRow } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Mock AI SDK and Ollama provider so orchestrator tests don't hit real APIs
// ---------------------------------------------------------------------------

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toDataStreamResponse: () => new Response('data: done\n\n'),
    })),
  };
});

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: vi.fn(() => vi.fn(() => ({}))),
  ollama: vi.fn(() => ({})),
}));

import { streamText } from 'ai';
import { createOrchestrator } from './orchestrator-loop.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

function buildMockDrizzleDb() {
  const tables: Record<string, AnyRow[]> = {
    conversations: [],
    messages: [],
    execution_log: [],
  };

  function tableName(table: Parameters<typeof getTableName>[0]): string {
    return getTableName(table);
  }

  return {
    _tables: tables,

    insert(table: Parameters<typeof getTableName>[0]) {
      const name = tableName(table);
      return {
        values(vals: AnyRow) {
          if (!tables[name]) tables[name] = [];
          tables[name].push({ ...vals });
          return Promise.resolve([]);
        },
      };
    },

    select() {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const name = tableName(table);
          const store = tables[name] ?? [];

          function makeChain(rows: AnyRow[]) {
            return {
              where(_cond: unknown) { return makeChain(rows); },
              orderBy(..._args: unknown[]) { return makeChain(rows); },
              limit(n: number) {
                const limited = rows.slice(0, n);
                return {
                  offset(o: number) { return Promise.resolve(rows.slice(o, o + n)); },
                  then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
                    return Promise.resolve(limited).then(resolve, reject);
                  },
                };
              },
              offset(o: number) {
                return {
                  then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
                    return Promise.resolve(rows.slice(o)).then(resolve, reject);
                  },
                };
              },
              then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
                return Promise.resolve(rows).then(resolve, reject);
              },
            };
          }

          return makeChain(store);
        },
      };
    },

    delete(table: Parameters<typeof getTableName>[0]) {
      const name = tableName(table);
      return {
        where(_cond: unknown) {
          tables[name] = [];
          return Promise.resolve([]);
        },
      };
    },

    execute: vi.fn().mockResolvedValue([]),
  };
}

function makeRow(overrides: Partial<ExecutionLogRow> = {}): ExecutionLogRow {
  return {
    id: crypto.randomUUID(),
    conversationId: null,
    toolName: 'github__create_issue',
    input: JSON.stringify({ title: 'bug' }),
    output: 'issue created',
    status: 'success',
    durationMs: 42,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRegistry() {
  return {
    listManifests: () => [
      {
        name: 'github',
        tools: [
          {
            name: 'create_issue',
            description: 'Create issue',
            inputSchema: {} as Record<string, unknown>,
            handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
          },
        ],
      },
    ],
    dispatch: vi.fn(async () => ({ content: [{ text: 'issue created' }] })),
  };
}

function getLastStreamCallTools() {
  const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;
  const calls = mockStreamText.mock.calls;
  const lastCall = calls[calls.length - 1][0] as {
    tools: Record<string, { execute?: (input: unknown) => Promise<unknown> }>;
  };
  return lastCall.tools;
}

// ---------------------------------------------------------------------------
// In-memory repository: no-op implementation
// ---------------------------------------------------------------------------

describe('createMemoryRepository.insertExecutionLog', () => {
  it('is a no-op and resolves without error', async () => {
    const repo = createMemoryRepository();
    const row = makeRow();
    await expect(repo.insertExecutionLog(row)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Direct DrizzleMemoryRepository persistence tests
// ---------------------------------------------------------------------------

describe('DrizzleMemoryRepository.insertExecutionLog', () => {
  let repo: ReturnType<typeof createDrizzleMemory>;
  let mockDb: ReturnType<typeof buildMockDrizzleDb>;

  beforeEach(() => {
    mockDb = buildMockDrizzleDb();
    repo = createDrizzleMemory(mockDb as unknown as Parameters<typeof createDrizzleMemory>[0]);
  });

  it('persists a success log row to the execution_log table', async () => {
    const row = makeRow({ toolName: 'github__create_issue', status: 'success', durationMs: 42, errorMessage: null });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe('github__create_issue');
    expect(rows[0].status).toBe('success');
    expect(rows[0].durationMs).toBe(42);
    expect(rows[0].errorMessage).toBeNull();
    expect(rows[0].id).toBe(row.id);
    expect(rows[0].createdAt).toBe(row.createdAt);
  });

  it('persists an error log row with error message', async () => {
    const row = makeRow({ toolName: 'jira__create_issue', output: null, status: 'error', durationMs: 15, errorMessage: 'Network timeout' });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe('jira__create_issue');
    expect(rows[0].status).toBe('error');
    expect(rows[0].errorMessage).toBe('Network timeout');
    expect(rows[0].output).toBeNull();
  });

  it('persists multiple log rows independently', async () => {
    await repo.insertExecutionLog(makeRow({ id: crypto.randomUUID(), toolName: 'github__create_issue' }));
    await repo.insertExecutionLog(makeRow({ id: crypto.randomUUID(), toolName: 'jira__search', output: 'results' }));
    await repo.insertExecutionLog(makeRow({ id: crypto.randomUUID(), toolName: 'slack__post', status: 'error', output: null, errorMessage: 'Forbidden' }));

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(3);
  });

  it('stores input as-is (already serialised)', async () => {
    const serialisedInput = JSON.stringify({ repo: 'my-repo', title: 'Test issue' });
    const row = makeRow({ input: serialisedInput });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows[0].input).toBe(serialisedInput);
  });

  it('stores serialised output string', async () => {
    const serialisedOutput = JSON.stringify({ id: 42, url: 'https://github.com/issues/42' });
    const row = makeRow({ output: serialisedOutput });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows[0].output).toBe(serialisedOutput);
  });

  it('stores null output when tool returned null', async () => {
    const row = makeRow({ output: null });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows[0].output).toBeNull();
  });

  it('stores conversationId when the conversation exists', async () => {
    await repo.saveConversation({ id: 'conv-abc', title: 'Test conversation' });
    const row = makeRow({ conversationId: 'conv-abc' });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows[0].conversationId).toBe('conv-abc');
  });

  it('stores null conversationId for orphaned logs', async () => {
    const row = makeRow({ conversationId: null });

    await repo.insertExecutionLog(row);

    const rows = mockDb._tables['execution_log'];
    expect(rows[0].conversationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orchestrator integration tests
// ---------------------------------------------------------------------------

describe('orchestrator persists execution_log rows via repo option', () => {
  let repo: ReturnType<typeof createDrizzleMemory>;
  let mockDb: ReturnType<typeof buildMockDrizzleDb>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb = buildMockDrizzleDb();
    repo = createDrizzleMemory(mockDb as unknown as Parameters<typeof createDrizzleMemory>[0]);
    // Pre-create sentinel conversation so FK is satisfied when conversationId = ''
    await repo.saveConversation({ id: '', title: null });
  });

  it('inserts a row into execution_log when repo is provided in StreamOptions', async () => {
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    orch.stream(
      [{ role: 'user', content: 'Create an issue' }],
      'You are Automate.',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { conversationId: '', repo },
    );

    const tools = getLastStreamCallTools();
    await tools.github__create_issue.execute?.({ title: 'test issue' });

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe('github__create_issue');
    expect(rows[0].status).toBe('success');
  });

  it('does not insert a row when repo is absent from StreamOptions', async () => {
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    orch.stream(
      [{ role: 'user', content: 'Create an issue' }],
      'You are Automate.',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { conversationId: '', onToolExecute: vi.fn() },
    );

    const tools = getLastStreamCallTools();
    await tools.github__create_issue.execute?.({ title: 'test issue' });

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(0);
  });

  it('persists conversationId from StreamOptions into the log row', async () => {
    await repo.saveConversation({ id: 'conv-999', title: 'Test' });

    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    orch.stream(
      [{ role: 'user', content: 'Create an issue' }],
      'You are Automate.',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { conversationId: 'conv-999', repo },
    );

    const tools = getLastStreamCallTools();
    await tools.github__create_issue.execute?.({ title: 'linked issue' });

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationId).toBe('conv-999');
  });

  it('still calls onToolExecute callback alongside repo persistence', async () => {
    const onToolExecute = vi.fn();
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    orch.stream(
      [{ role: 'user', content: 'Create an issue' }],
      'You are Automate.',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { conversationId: '', repo, onToolExecute },
    );

    const tools = getLastStreamCallTools();
    await tools.github__create_issue.execute?.({ title: 'test' });

    expect(onToolExecute).toHaveBeenCalledOnce();
    expect(onToolExecute).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'github__create_issue', status: 'success' }),
    );

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(1);
  });

  it('wraps tools when only repo is provided (no callbacks)', async () => {
    const mockRegistry = makeRegistry();
    const orch = createOrchestrator(mockRegistry as unknown as Parameters<typeof createOrchestrator>[0]);

    orch.stream(
      [{ role: 'user', content: 'Create an issue' }],
      'You are Automate.',
      { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' },
      { github: { token: 'gh-token' } },
      { repo },
    );

    const tools = getLastStreamCallTools();
    const result = await tools.github__create_issue.execute?.({ title: 'silent persist' });

    expect(result).toBe('issue created');

    const rows = mockDb._tables['execution_log'];
    expect(rows).toHaveLength(1);
  });
});
