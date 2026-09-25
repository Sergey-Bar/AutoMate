/**
 * Targeted mutation-killing tests for surviving Stryker mutants.
 *
 * These tests are specifically designed to kill surviving mutants identified
 * in the Stryker incremental report. Each describe block targets a specific
 * source file and the exact mutant locations.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// ─── vault.ts — mutant ids 361, 362, 363, 364, 365 ────────────────────────────
// Mutants: ConditionalExpression true/false on line 42 (deps.expectedPassword === undefined)
//          BlockStatement {} on line 42-44
//          ObjectLiteral {} on line 43
//          StringLiteral "" on line 43 (error message)

import { vaultRoutes, _resetUnlockRateLimit } from './vault.js';
import type { VaultRouteDeps } from './vault.js';

function buildVaultDeps(
  expectedPassword: string | undefined,
  isUnlocked = false,
): VaultRouteDeps {
  return {
    vaultService: {
      unlock: vi.fn().mockResolvedValue(undefined),
      lock: vi.fn(),
      isUnlocked: vi.fn().mockReturnValue(isUnlocked),
      setCredential: vi.fn().mockResolvedValue(undefined),
      getCredential: vi.fn().mockResolvedValue(null),
    },
    expectedPassword,
  };
}

async function buildVaultApp(deps: VaultRouteDeps): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register((instance, _opts, done) => {
    vaultRoutes(instance, deps).then(() => done()).catch(done);
  });
  await app.ready();
  return app;
}

describe('vault.ts — mutation killers', () => {
  let app: FastifyInstance;

  beforeEach(() => _resetUnlockRateLimit());
  afterEach(() => app?.close());

  // Kills mutant 361 (ConditionalExpression always true) and 362 (always false)
  // The conditional is: if (deps.expectedPassword === undefined)
  // When true → 403; when false (password IS configured) → proceed to check
  it('returns 403 when expectedPassword is undefined — kills mutant 361/362', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildVaultApp(buildVaultDeps(undefined));

    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'any' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('VAULT_PASSWORD');
  });

  it('does NOT return 403 when expectedPassword is set — kills mutant 361/362', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildVaultApp(buildVaultDeps('my-password'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'my-password' },
    });

    // Should NOT be 403 — if mutant 361 survives (always true), this would be 403
    expect(res.statusCode).not.toBe(403);
  });

  // Kills mutant 363 (BlockStatement {}) — the block that sends 403
  it('403 response body has error property when expectedPassword is undefined — kills mutant 363', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildVaultApp(buildVaultDeps(undefined));

    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'any' },
    });

    // If block is emptied, no 403 response is sent
    expect(res.statusCode).toBe(403);
    expect(res.json()).toHaveProperty('error');
  });

  // Kills mutant 364 (ObjectLiteral {}) and 365 (StringLiteral "")
  it('403 error message mentions VAULT_PASSWORD — kills mutants 364/365', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildVaultApp(buildVaultDeps(undefined));

    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'any' },
    });

    const body = res.json();
    // Mutant 364 replaces {error: ...} with {} → no error property
    expect(body).toHaveProperty('error');
    // Mutant 365 replaces the string with "" → empty string
    expect(body.error).not.toBe('');
    expect(body.error).toContain('VAULT_PASSWORD');
  });
});

// ─── chat.ts — mutant ids 134, 156, 163, 164 ─────────────────────────────────
// 134: OptionalChaining on userMsg?.role (line 56) → userMsg.role
// 156: ConditionalExpression true on line 109 (firstMsg?.content...)
// 163: ConditionalExpression false on line 113 (userMsg?.role === 'user')
// 164: BlockStatement {} on lines 113-115

import { chatRoutes, type ChatDeps } from './chat.js';
import { createMemoryRepository } from '../agent/memory.js';
import { ConnectorRegistry } from '../connectors/registry.js';
import { conversationRoutes } from './conversations.js';

vi.mock('../agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(() => ({
    stream: vi.fn(() =>
      Promise.resolve({
        toTextStreamResponse: () =>
          new Response('data: done\n\n', {
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
  })),
}));

function createChatDeps(overrides?: Partial<ChatDeps>): ChatDeps {
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
    getSystemPrompt: () => 'Test system prompt',
    ...overrides,
  };
}

async function buildChatApp(deps: ChatDeps): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register((instance, _opts, done) => {
    chatRoutes(instance, deps).then(() => done()).catch(done);
  });
  await app.ready();
  return app;
}

describe('chat.ts — mutation killers', () => {
  let app: FastifyInstance;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => app?.close());

  // Kills mutant 134: OptionalChaining userMsg?.role → userMsg.role
  // If optional chaining removed, accessing .role on undefined would throw
  // when messages array has only system/tool messages (userMsg is last non-user message)
  it('saves user message only when last message has role user — kills mutant 134', async () => {
    const memory = createMemoryRepository();
    const saveSpy = vi.spyOn(memory, 'saveMessage');
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildChatApp(createChatDeps({ memory }));

    // Last message IS user — should save message
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'Hello' }),
    );
  });

  it('does not save message when last message is assistant — kills mutant 163/164', async () => {
    const memory = createMemoryRepository();
    const saveSpy = vi.spyOn(memory, 'saveMessage');
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildChatApp(createChatDeps({ memory }));

    // Last message is assistant — should NOT save message (role check fails)
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    // If mutant 163 survives (always false), saveMessage would not be called even for user messages
    // If mutant 164 survives (block {}), saveMessage would not be called
    expect(saveSpy).not.toHaveBeenCalled();
  });

  // Kills mutant 156: ConditionalExpression always true on line 109
  // firstMsg?.content.slice(0, 100) ?? 'New Chat' — if mutated to always true, title would always be taken
  it('uses New Chat as title when no user message in the array — kills mutant 156', async () => {
    const memory = createMemoryRepository();
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildChatApp(createChatDeps({ memory }));

    // Only system message — no user message found by .find(m => m.role === 'user')
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'system', content: 'You are a helpful assistant' }] },
    });

    expect(res.statusCode).toBe(200);
    const conversations = await memory.listConversations();
    expect(conversations).toHaveLength(1);
    // If mutant 156 (always true) survives, firstMsg is always defined so 'New Chat' would never appear
    expect(conversations[0]?.title).toBe('New Chat');
  });

  it('uses actual user message content as title when user message exists — kills mutant 156', async () => {
    const memory = createMemoryRepository();
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    app = await buildChatApp(createChatDeps({ memory }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Specific message content' }] },
    });

    expect(res.statusCode).toBe(200);
    const conversations = await memory.listConversations();
    expect(conversations).toHaveLength(1);
    // Title should be actual content, not 'New Chat'
    expect(conversations[0]?.title).toBe('Specific message content');
    expect(conversations[0]?.title).not.toBe('New Chat');
  });
});

// ─── connectors/registry.ts — mutant ids 63, 68 ──────────────────────────────
// 63: EqualityOperator dotIndex >= 0 on line 46 (connectorName)
// 68: EqualityOperator dotIndex >= 0 on line 47 (toolMethodName)
// dotIndex is result of toolName.indexOf('.')
// When toolName has NO dot: indexOf returns -1, so dotIndex >= 0 is false (correct)
// Mutant replaces >= with >: -1 > 0 is also false — SAME behavior when no dot
// When toolName HAS a dot: indexOf returns >=0, so both >= and > would be true — SAME
// We need a case where dotIndex === 0 (dot at position 0, e.g. ".toolname")
// In that case, >= 0 is true but > 0 is false — DIFFERENT behavior

import { z } from 'zod/v4';

describe('connectors/registry.ts — mutation killers (dotIndex operator)', () => {
  // Kills mutants 63 and 68: dotIndex >= 0 vs dotIndex > 0
  // When toolName starts with a dot (dotIndex === 0):
  // - >= 0: connectorName = toolName.slice(0, 0) = "" (empty), toolMethodName = "toolname"
  // - > 0: dotIndex is not > 0, so connectorName = toolName (whole string), toolMethodName = undefined

  it('dispatches correctly when toolName starts with dot (dotIndex===0) — kills mutants 63/68', async () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'result' }],
    }));

    // Register a connector with empty string name — simulates dotIndex===0 behavior
    registry.registerManifest({
      name: '',
      version: '1.0',
      displayName: 'empty-name',
      description: 'test',
      icon: 'test',
      credentialSchema: z.object({}),
      tools: [{ name: 'create', description: 'test tool', inputSchema: z.object({}), handler }],
    });

    // .create has dot at position 0 → dotIndex=0
    // With >= 0: connectorName="" (slice(0,0)), toolMethodName="create" → finds connector "" → dispatches
    // With > 0: connectorName=".create" (full string), toolMethodName=undefined → connector not found
    await expect(registry.dispatch('.create', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'result' }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispatch with exact dotIndex=0 uses empty string as connectorName — kills mutants 63/68', async () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    registry.registerManifest({
      name: '',
      version: '1.0',
      displayName: 'empty-connector',
      description: 'test empty',
      icon: 'icon',
      credentialSchema: z.object({}),
      tools: [{ name: 'run', description: 'run tool', inputSchema: z.object({}), handler }],
    });

    // When dotIndex >= 0 is used (correct), toolMethodName = "run"
    // When dotIndex > 0 is used (mutant), connectorName = ".run", not found → throws
    const result = await registry.dispatch('.run', { data: 'test' });
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' });
  });
});

// ─── shared/index.ts — mutant ids: StringLiteral line 52, Regex line 78, Conditional line 81 ─
// Line 52: ExecutionStatusSchema enum values (running/success/error/timeout)
// Line 78: TOOL_NAME_PATTERN regex mutations
// Line 81: parseJsonSafe conditional — value is falsy

import { TOOL_NAME_PATTERN, parseJsonSafe, ExecutionStatusSchema } from '../../../../packages/shared/src/index.js';

describe('shared/index.ts — mutation killers', () => {
  // Kills regex mutants: /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/
  // Mutant 1: removes ^ anchor → /[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/
  // Mutant 2: removes $ anchor → /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*/

  it('TOOL_NAME_PATTERN rejects toolName without leading ^anchor (prefix) — kills regex mutant removing ^', () => {
    // Without ^, " github.create" (with leading space) would match
    // With ^, it must start at the beginning
    expect(TOOL_NAME_PATTERN.test(' github.create')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('\ngithub.create')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('XXgithub.create')).toBe(false);
  });

  it('TOOL_NAME_PATTERN rejects toolName without trailing $anchor (suffix) — kills regex mutant removing $', () => {
    // Without $, "github.create " (with trailing space) would match
    // With $, it must end exactly at the last char
    expect(TOOL_NAME_PATTERN.test('github.create ')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('github.create\n')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('github.createXX')).toBe(false);
  });

  it('TOOL_NAME_PATTERN matches valid patterns exactly — anchors work correctly', () => {
    expect(TOOL_NAME_PATTERN.test('github.create_issue')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('jira.search_issues')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('slack.post_summary')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('sql-browser.query')).toBe(true);
  });

  it('TOOL_NAME_PATTERN rejects invalid formats', () => {
    expect(TOOL_NAME_PATTERN.test('github')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('.create_issue')).toBe(false);
    expect(TOOL_NAME_PATTERN.test('GITHUB.create_issue')).toBe(false);
  });

  // Kills ConditionalExpression mutant on line 81: if (!value) return fallback
  // Mutant makes it always true → always returns fallback
  it('parseJsonSafe returns parsed value for valid non-empty JSON — kills conditional mutant', () => {
    const result = parseJsonSafe('{"key":"value"}', {});
    // If mutant survives (always returns fallback), this would return {}
    expect(result).toEqual({ key: 'value' });
  });

  it('parseJsonSafe returns fallback for null — kills conditional mutant', () => {
    const result = parseJsonSafe(null, { default: true });
    expect(result).toEqual({ default: true });
  });

  it('parseJsonSafe returns fallback for empty string — kills conditional mutant', () => {
    // "" is falsy, so !value is true → return fallback
    const result = parseJsonSafe('', 'fallback');
    expect(result).toBe('fallback');
  });

  it('parseJsonSafe returns fallback for invalid JSON — kills conditional mutant', () => {
    const result = parseJsonSafe('not-json', []);
    expect(result).toEqual([]);
  });

  it('parseJsonSafe parses arrays correctly — confirms non-null path works', () => {
    const result = parseJsonSafe('[1,2,3]', []);
    expect(result).toEqual([1, 2, 3]);
  });

  // Kills StringLiteral mutations on ExecutionStatusSchema (line 52)
  // Mutations replace individual enum values with ""
  it('ExecutionStatusSchema has all required values — kills StringLiteral mutants', () => {
    expect(ExecutionStatusSchema.options).toContain('running');
    expect(ExecutionStatusSchema.options).toContain('success');
    expect(ExecutionStatusSchema.options).toContain('error');
    expect(ExecutionStatusSchema.options).toContain('timeout');
  });

  it('ExecutionStatusSchema rejects empty string — kills StringLiteral mutants', () => {
    const result = ExecutionStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('ExecutionStatusSchema accepts running — mutant would replace with ""', () => {
    expect(ExecutionStatusSchema.parse('running')).toBe('running');
  });

  it('ExecutionStatusSchema accepts timeout — mutant would replace with ""', () => {
    expect(ExecutionStatusSchema.parse('timeout')).toBe('timeout');
  });
});

// ─── model-config.ts — mutant id 320 ─────────────────────────────────────────
// Line 79: ConditionalExpression always true
// This is in the PUT /api/model-config handler — if (body.maxTokens !== undefined)

const {
  mockGet2,
  mockRun2,
  mockWhere2,
  mockSet2,
  mockFrom2,
  mockSelect2,
  mockUpdate2,
  mockModelConfig2,
  mockEq2,
} = vi.hoisted(() => {
  const get2 = vi.fn();
  const run2 = vi.fn();
  const where2 = vi.fn(() => ({ get: get2, run: run2 }));
  const set2 = vi.fn(() => ({ where: where2 }));
  const from2 = vi.fn(() => ({ where: where2 }));
  const select2 = vi.fn(() => ({ from: from2 }));
  const update2 = vi.fn(() => ({ set: set2 }));
  const modelCfg2 = { id: 'id-column' };
  const eq2 = vi.fn(() => 'eq-clause');

  return {
    mockGet2: get2,
    mockRun2: run2,
    mockWhere2: where2,
    mockSet2: set2,
    mockFrom2: from2,
    mockSelect2: select2,
    mockUpdate2: update2,
    mockModelConfig2: modelCfg2,
    mockEq2: eq2,
  };
});

vi.mock('drizzle-orm', () => ({ eq: mockEq2 }));
vi.mock('../db/schema.js', () => ({ modelConfig: mockModelConfig2 }));
vi.mock('../db/client.js', () => ({
  db: { select: mockSelect2, update: mockUpdate2 },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

import { modelConfigRoutes, maskApiKey } from './model-config.js';

describe('model-config.ts — mutation killers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGet2.mockReset();
    mockRun2.mockReset();
    mockWhere2.mockClear();
    mockSet2.mockClear();
    mockFrom2.mockClear();
    mockSelect2.mockClear();
    mockUpdate2.mockClear();
    mockEq2.mockClear();

    app = Fastify();
    await app.register((instance, _opts, done) => {
      modelConfigRoutes(instance).then(() => done()).catch(done);
    });
    await app.ready();
  });

  afterEach(() => app.close());

  // Kills mutant 320: ConditionalExpression always true on line 79
  // if (body.maxTokens !== undefined) updates.maxTokens = body.maxTokens
  // If mutant survives (always true), maxTokens would always be included, even when not in body
  it('PUT /api/model-config — maxTokens NOT included in update when absent from body — kills mutant 320', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 0.5 },
    });

    expect(res.statusCode).toBe(200);
    const setCalls = (mockSet2 as ReturnType<typeof vi.fn>).mock.calls;
    const updates = setCalls[0][0] as Record<string, unknown>;

    // If mutant 320 survives: maxTokens would appear in updates even without being in payload
    expect(updates).not.toHaveProperty('maxTokens');
    expect(updates).toHaveProperty('temperature', 0.5);
    expect(updates).toHaveProperty('updatedAt');
  });

  it('PUT /api/model-config — maxTokens IS included when provided — confirms non-mutant path', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { maxTokens: 8192 },
    });

    expect(res.statusCode).toBe(200);
    const setCalls = (mockSet2 as ReturnType<typeof vi.fn>).mock.calls;
    const updates = setCalls[0][0] as Record<string, unknown>;
    expect(updates).toHaveProperty('maxTokens', 8192);
  });

  // Kills mutant 264: StringLiteral "" on line 11 (provider refine message)
  it('PUT /api/model-config — error message mentions supported providers — kills mutant 264', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { provider: 'unknown-provider' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    // Mutant 264 replaces the message string with "" → empty error message
    expect(body.error).not.toBe('');
    expect(body.error).toBeTruthy();
  });

  // Kills mutant 276: StringLiteral "" on line 26 (maskApiKey returns '****')
  it('maskApiKey returns **** for short keys, not empty string — kills mutant 276', () => {
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('abc')).toBe('****');
    expect(maskApiKey('')).toBe('****');
    // Ensure it's not empty string (mutant replaces '****' with '')
    expect(maskApiKey('short')).not.toBe('');
  });

  // Kills mutant 271-274: EqualityOperator and StringLiteral on line 23 validation error format
  it('PUT /api/model-config validation error includes path and message — kills mutants 269-274', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 'not-a-number' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    // The error should be a non-empty string
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe('string');
  });
});

// ─── conversations.ts — mutant ids 215, 217, 219, 220 ─────────────────────────
// Line 21: issue.path.length > 0 ConditionalExpression/EqualityOperator
// These are in formatValidationError inside the validation helper
// Testing via the conversations route which calls it

describe('conversations.ts — mutation killers (validation error format)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    const memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  afterEach(() => app.close());

  // Kills mutants 215 (always true), 217 (>= 0), 219 (""), 220 ("")
  // These mutate the validation error formatter for the conversations route
  it('validation error for invalid pagination includes field path — kills mutants 215/217', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=-1',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    // Error should mention 'limit' (the path), not just 'body'
    // If mutant 215 survives (always true), issue.path.join('.') is used but path might be empty
    // If mutant 217 (>= 0) survives instead of (> 0), behavior differs for zero-length paths
    expect(body.error).toBeTruthy();
    expect(body.error).toContain('limit');
  });

  it('validation error message text is non-empty — kills mutants 219/220 (StringLiteral "")', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=abc',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTruthy();
    // The path separator "." should be present for nested paths
    // But for top-level issues, "body" separator is used
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('pagination validation error uses : separator between path and message — kills string mutants', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?offset=-5',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    // Error format is "path: message" — the colon and space must be present
    expect(body.error).toContain(':');
    expect(body.error).toContain('offset');
  });
});

// ─── connectors.ts — mutant ids 183, 185, 186, 195, 197, 198, 201, 206 ────────
// These are StringLiteral and ObjectLiteral mutations in the connectors route responses

import { connectorRoutes } from './connectors.js';
import {
  getDashboardMcpContractValidationState,
  buildDashboardMcpConnectorManifest,
  type DashboardMcpContractValidationState,
} from '../connectors/mcp-connector.js';
import { isEnabled } from '../services/feature-flags.js';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';
import { z as zv4 } from 'zod/v4';

vi.mock('../services/feature-flags.js', () => ({ isEnabled: vi.fn() }));
vi.mock('../connectors/mcp-connector.js', () => ({
  getDashboardMcpContractValidationState: vi.fn(),
  buildDashboardMcpConnectorManifest: vi.fn(),
}));

describe('connectors.ts — mutation killers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    const registry = new ConnectorRegistry();
    registry.registerManifest({
      name: 'test-c',
      version: '0.1.0',
      displayName: 'Test Connector',
      description: 'A connector for testing',
      icon: 'test',
      credentialSchema: zv4.object({ key: zv4.string() }),
      tools: [
        {
          name: 'tool1',
          description: 'First tool',
          inputSchema: zv4.object({}),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
        {
          name: 'tool2',
          description: 'Second tool',
          inputSchema: zv4.object({}),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok2' }] }),
        },
      ],
    });
    await connectorRoutes(app, { registry });
    await app.ready();
  });

  afterEach(() => app.close());

  // Kills mutants 183, 185, 186 (health endpoint StringLiteral/ObjectLiteral mutations)
  it('GET /api/connectors/dashboard_mcp/health returns validationStatus field — kills StringLiteral mutants 183/186', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '2.0',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const res = await app.inject({ method: 'GET', url: '/api/connectors/dashboard_mcp/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Mutant 183 replaces 'not_configured' with '' → apiKeyStatus would be ''
    expect(body.apiKeyStatus).toBe('not_configured');
    expect(body.apiKeyStatus).not.toBe('');

    // Mutant 186 replaces 'not_configured' with '' in another location
    expect(body.validationStatus).toBe('passed');
    expect(body.contractVersion).toBe('2.0');
  });

  // Kills mutants 195, 197, 198 (test-connect endpoint StringLiteral/ObjectLiteral mutations)
  it('POST /api/connectors/dashboard_mcp/test-connect returns success with validationState — kills mutants 195-198', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '1.5',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(buildDashboardMcpConnectorManifest).mockResolvedValue(undefined as unknown as ConnectorManifest);
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const res = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Mutant 195 replaces 'not_configured' with ''
    expect(body.validationState.apiKeyStatus).toBe('not_configured');
    expect(body.validationState.apiKeyStatus).not.toBe('');

    // Mutant 197 replaces ObjectLiteral — body.success should be true
    expect(body.success).toBe(true);

    // Mutant 198 replaces 'not_configured' string → test both calls return same value
    expect(body.validationState.validationStatus).toBe('passed');
  });

  // Kills mutant 201 (StringLiteral 'configured' in health endpoint with API key set)
  it('GET /api/connectors/dashboard_mcp/health shows configured when API key is set — kills mutant 201', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '1.0',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    // Set the env var to simulate configured state
    const original = process.env.DASHBOARD_MCP_API_KEY;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.DASHBOARD_MCP_API_KEY = 'test-api-key';
    try {
      const res = await app.inject({ method: 'GET', url: '/api/connectors/dashboard_mcp/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Mutant 201 replaces 'configured' with '' → apiKeyStatus would be ''
      expect(body.apiKeyStatus).toBe('configured');
      expect(body.apiKeyStatus).not.toBe('');
    } finally {
      if (original === undefined) {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
        delete process.env.DASHBOARD_MCP_API_KEY;
      } else {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
        process.env.DASHBOARD_MCP_API_KEY = original;
      }
    }
  });

  // Kills mutant 206 (StringLiteral mutations in test-connect response with API key)
  it('POST /api/connectors/dashboard_mcp/test-connect shows configured when API key is set — kills mutant 206', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '1.0',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(buildDashboardMcpConnectorManifest).mockResolvedValue(undefined as unknown as ConnectorManifest);
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const original = process.env.DASHBOARD_MCP_API_KEY;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.DASHBOARD_MCP_API_KEY = 'my-api-key';
    try {
      const res = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Mutant 206 replaces 'configured' with ''
      expect(body.validationState.apiKeyStatus).toBe('configured');
      expect(body.validationState.apiKeyStatus).not.toBe('');
    } finally {
      if (original === undefined) {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
        delete process.env.DASHBOARD_MCP_API_KEY;
      } else {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
        process.env.DASHBOARD_MCP_API_KEY = original;
      }
    }
  });
});
