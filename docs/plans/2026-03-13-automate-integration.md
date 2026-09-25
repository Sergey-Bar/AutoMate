# Automate Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire Automate components together so user can type a message, get an LLM response with optional tool use.

**Architecture:** Frontend `useAutomateChat()` → POST `/api/chat` → `streamText()` with Ollama → `toUIMessageStreamResponse()` → SSE back to frontend. Connectors registered at startup, converted to AI SDK `tool()` format, executed via `ConnectorRegistry.dispatch()`.

**Tech Stack:** Fastify 5.x, Vercel AI SDK 6.x (`ai`, `@ai-sdk/react`), `ollama-ai-provider-v2`, Zod v4, TypeScript 5.9

---

## Task 1: Create Tools Adapter Module

**Files:**
- Create: `apps/server/src/connectors/tools-adapter.ts`
- Create: `apps/server/src/connectors/tools-adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/server/src/connectors/tools-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { adaptConnectorTools } from './tools-adapter.js';
import { z } from 'zod/v4';
import type { ConnectorManifest } from '@automate/connector-sdk';

describe('adaptConnectorTools', () => {
  it('converts connector manifest tools to AI SDK tool format', async () => {
    const mockHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'done' }],
    });

    const manifest: ConnectorManifest = {
      name: 'test',
      version: '1.0.0',
      displayName: 'Test',
      description: 'Test connector',
      icon: 'test',
      credentialSchema: z.object({}),
      tools: [
        {
          name: 'do_thing',
          description: 'Does a thing',
          inputSchema: z.object({ value: z.string() }),
          handler: mockHandler,
        },
      ],
    };

    const tools = adaptConnectorTools([manifest]);

    expect(tools).toHaveProperty('test.do_thing');
    expect(tools['test.do_thing'].description).toBe('Does a thing');

    // Execute the tool
    const result = await tools['test.do_thing'].execute({ value: 'hello' });
    expect(result).toBe('done');
    expect(mockHandler).toHaveBeenCalledWith(
      { value: 'hello' },
      expect.objectContaining({ credentials: {}, abortSignal: expect.any(AbortSignal) })
    );
  });

  it('handles tool execution errors', async () => {
    const errorHandler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'error occurred' }],
      isError: true,
    });

    const manifest: ConnectorManifest = {
      name: 'error-test',
      version: '1.0.0',
      displayName: 'Error Test',
      description: 'Error test connector',
      icon: 'error',
      credentialSchema: z.object({}),
      tools: [
        {
          name: 'fail',
          description: 'Always fails',
          inputSchema: z.object({}),
          handler: errorHandler,
        },
      ],
    };

    const tools = adaptConnectorTools([manifest]);
    const result = await tools['error-test.fail'].execute({});
    
    expect(result).toBe('Error: error occurred');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test -- --run tools-adapter`
Expected: FAIL with "Cannot find module './tools-adapter.js'"

**Step 3: Write minimal implementation**

```typescript
// apps/server/src/connectors/tools-adapter.ts
import { tool } from 'ai';
import type { ConnectorManifest, ToolContext } from '@automate/connector-sdk';

type AIToolSet = Record<string, ReturnType<typeof tool>>;

export function adaptConnectorTools(
  manifests: ConnectorManifest[],
  getContext: () => ToolContext = () => ({
    credentials: {},
    abortSignal: new AbortController().signal,
  })
): AIToolSet {
  const tools: AIToolSet = {};

  for (const manifest of manifests) {
    for (const t of manifest.tools) {
      const toolName = `${manifest.name}.${t.name}`;
      tools[toolName] = tool({
        description: t.description,
        parameters: t.inputSchema,
        execute: async (input) => {
          const result = await t.handler(input, getContext());
          const text = result.content.map((c) => c.text).join('\n');
          return result.isError ? `Error: ${text}` : text;
        },
      });
    }
  }

  return tools;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test -- --run tools-adapter`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/connectors/tools-adapter.ts apps/server/src/connectors/tools-adapter.test.ts
git commit -m "feat(server): add tools adapter to convert connector tools to AI SDK format"
```

---

## Task 2: Update Planner to Accept Messages Array

**Files:**
- Modify: `apps/server/src/agent/planner.ts`
- Modify: `apps/server/src/agent/planner.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to apps/server/src/agent/planner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { planWithMessages, type ChatMessage } from './planner.js';

vi.mock('ai', () => ({
  streamText: vi.fn(() => ({
    textStream: (async function* () { yield 'test'; })(),
    toUIMessageStreamResponse: () => new Response('test'),
  })),
}));

vi.mock('ollama-ai-provider-v2', () => ({
  ollama: vi.fn(() => 'mock-model'),
}));

describe('planWithMessages', () => {
  it('accepts messages array and returns streamText result', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    const tools = {};
    
    const result = planWithMessages(messages, 'system prompt', tools);
    
    expect(result).toHaveProperty('toUIMessageStreamResponse');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test -- --run planner`
Expected: FAIL with "planWithMessages is not exported"

**Step 3: Write implementation**

```typescript
// apps/server/src/agent/planner.ts - replace entire file
import { streamText, type ToolSet } from 'ai';
import { ollama } from 'ollama-ai-provider-v2';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface PlannerInput {
  model: ReturnType<typeof ollama>;
  system: string;
  prompt: string;
  tools: ToolSet;
}

export function buildPlannerInput(
  userPrompt: string,
  flowPrompt: string,
  tools: ToolSet
): PlannerInput {
  return {
    model: ollama('llama3.1'),
    system: `You are Automate orchestration planner. ${flowPrompt}`,
    prompt: userPrompt,
    tools,
  };
}

export function plan(userPrompt: string, flowPrompt: string, tools: ToolSet) {
  const input = buildPlannerInput(userPrompt, flowPrompt, tools);
  return streamText({
    model: input.model,
    system: input.system,
    prompt: input.prompt,
    tools: input.tools,
  });
}

export function planWithMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  tools: ToolSet
) {
  return streamText({
    model: ollama('llama3.1'),
    system: systemPrompt,
    messages,
    tools,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test -- --run planner`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/planner.ts apps/server/src/agent/planner.test.ts
git commit -m "feat(server): add planWithMessages to accept chat messages array"
```

---

## Task 3: Wire Chat Route to Real LLM Streaming

**Files:**
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/routes/chat.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/server/src/routes/chat.test.ts - replace existing
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { chatRoutes } from './chat.js';

// Mock the planner
vi.mock('../agent/planner.js', () => ({
  planWithMessages: vi.fn(() => ({
    toUIMessageStreamResponse: () => new Response('data: {"type":"text-delta","text":"Hello"}\n\n'),
  })),
}));

// Mock tools adapter
vi.mock('../connectors/tools-adapter.js', () => ({
  adaptConnectorTools: vi.fn(() => ({})),
}));

describe('chatRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(chatRoutes);
    await app.ready();
  });

  it('POST /api/chat streams LLM response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
  });

  it('returns 400 for missing messages', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test -- --run chat`
Expected: FAIL (current implementation doesn't parse messages or call planner)

**Step 3: Write implementation**

```typescript
// apps/server/src/routes/chat.ts - replace entire file
import type { FastifyInstance } from 'fastify';
import { planWithMessages, type ChatMessage } from '../agent/planner.js';
import { adaptConnectorTools } from '../connectors/tools-adapter.js';
import { githubManifest } from '@automate/connector-github';
import { jiraManifest } from '@automate/connector-jira';
import { slackManifest } from '@automate/connector-slack';

interface ChatRequestBody {
  messages: ChatMessage[];
}

const SYSTEM_PROMPT = `You are Automate, an AI assistant for QA automation. You can help with:
- Creating GitHub issues and PR comments
- Managing Jira tickets
- Sending Slack notifications
- Analyzing test results

When using tools, explain what you're doing and provide the results.`;

// Build tools from connector manifests
const connectorTools = adaptConnectorTools([githubManifest, jiraManifest, slackManifest]);

export async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: ChatRequestBody }>('/api/chat', async (request, reply) => {
    const { messages } = request.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }

    const result = planWithMessages(messages, SYSTEM_PROMPT, connectorTools);

    // Get the Response object from AI SDK
    const response = result.toUIMessageStreamResponse();

    // Set headers from the Response
    reply.raw.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': response.headers.get('cache-control') ?? 'no-cache',
      'Connection': 'keep-alive',
      'X-Vercel-AI-UI-Message-Stream': response.headers.get('x-vercel-ai-ui-message-stream') ?? 'v1',
    });

    // Pipe the response body to the raw response
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    reply.raw.end();
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test -- --run chat`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/chat.ts apps/server/src/routes/chat.test.ts
git commit -m "feat(server): wire chat route to real LLM streaming via planner"
```

---

## Task 4: Export Connector Manifests Properly

**Files:**
- Modify: `packages/connectors/github/src/index.ts`
- Modify: `packages/connectors/jira/src/index.ts`
- Modify: `packages/connectors/slack/src/index.ts`

**Step 1: Verify current exports**

Run: `grep -n "export" packages/connectors/*/src/index.ts`

**Step 2: Ensure manifests are exported with correct names**

Check each connector exports its manifest. The GitHub connector already exports `githubManifest`. Verify Jira and Slack follow same pattern.

```typescript
// packages/connectors/jira/src/index.ts - verify export
export const jiraManifest: ConnectorManifest = { ... };
export * from './service.js';

// packages/connectors/slack/src/index.ts - verify export  
export const slackManifest: ConnectorManifest = { ... };
export * from './service.js';
```

**Step 3: Build to verify no errors**

Run: `pnpm build`
Expected: All packages build successfully

**Step 4: Commit (if changes needed)**

```bash
git add packages/connectors/*/src/index.ts
git commit -m "fix(connectors): ensure manifests are properly exported"
```

---

## Task 5: Update Frontend Chat Integration

**Files:**
- Modify: `apps/web/src/components/chat/chat-shell.tsx`
- Modify: `apps/web/src/hooks/use-automate-chat.ts`
- Modify: `apps/web/src/pages/chat.tsx` (if exists)

**Step 1: Update useAutomateChat to use correct message format**

```typescript
// apps/web/src/hooks/use-automate-chat.ts
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export const chatApiPath = '/api/chat';

export function useAutomateChat() {
  const transport = new DefaultChatTransport({ api: chatApiPath });
  const chat = useChat({ transport });
  
  return {
    messages: chat.messages,
    input: chat.input,
    handleInputChange: chat.handleInputChange,
    handleSubmit: chat.handleSubmit,
    isLoading: chat.status === 'streaming',
    error: chat.error,
  };
}
```

**Step 2: Update ChatShell to use useAutomateChat return values**

```typescript
// apps/web/src/components/chat/chat-shell.tsx
import { Conversation, Message, PromptInput } from '@/components/ai-elements/index.js';
import { useAutomateChat } from '@/hooks/use-automate-chat.js';

export function ChatShell() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useAutomateChat();

  return (
    <Conversation>
      {messages.map((m) => (
        <Message key={m.id} role={m.role as 'user' | 'assistant'}>
          {m.parts?.map((part, i) => 
            part.type === 'text' ? <span key={i}>{part.text}</span> : null
          )}
        </Message>
      ))}
      {isLoading && <Message role="assistant">Thinking...</Message>}
      <form onSubmit={handleSubmit}>
        <PromptInput 
          placeholder="Ask Automate" 
          value={input}
          onChange={handleInputChange}
        />
      </form>
    </Conversation>
  );
}
```

**Step 3: Run frontend tests**

Run: `pnpm --filter @automate/web test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/hooks/use-automate-chat.ts apps/web/src/components/chat/chat-shell.tsx
git commit -m "feat(web): update chat components to use proper AI SDK message format"
```

---

## Task 6: Add Integration Test

**Files:**
- Create: `apps/server/src/integration.test.ts`

**Step 1: Write integration test**

```typescript
// apps/server/src/integration.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildServer } from './index.js';

// Mock Ollama to avoid actual LLM calls in tests
vi.mock('ollama-ai-provider-v2', () => ({
  ollama: vi.fn(() => ({
    // Return a mock model that the AI SDK can use
  })),
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toUIMessageStreamResponse: () => new Response(
        'data: {"type":"text-delta","text":"Hello from Automate!"}\n\ndata: [DONE]\n\n',
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'X-Vercel-AI-UI-Message-Stream': 'v1',
          },
        }
      ),
    })),
  };
});

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
    expect(response.json()).toEqual({ status: 'ok' });
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
```

**Step 2: Run integration test**

Run: `pnpm --filter @automate/server test -- --run integration`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/server/src/integration.test.ts
git commit -m "test(server): add integration tests for chat endpoint"
```

---

## Task 7: Final Verification

**Step 1: Run full test suite**

Run: `pnpm -r test`
Expected: All tests pass (215+ tests)

**Step 2: Run build**

Run: `pnpm build`
Expected: Exit code 0

**Step 3: Run LSP diagnostics on changed files**

Check for type errors in:
- `apps/server/src/connectors/tools-adapter.ts`
- `apps/server/src/agent/planner.ts`
- `apps/server/src/routes/chat.ts`

**Step 4: Manual E2E verification (optional)**

```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Start server
cd apps/server && node dist/index.js

# Terminal 3: Test with curl
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Automate integration - chat endpoint wired to Ollama LLM"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Tools adapter | `tools-adapter.ts`, `tools-adapter.test.ts` |
| 2 | Planner messages | `planner.ts`, `planner.test.ts` |
| 3 | Chat route | `chat.ts`, `chat.test.ts` |
| 4 | Connector exports | `*/index.ts` (verify) |
| 5 | Frontend chat | `use-automate-chat.ts`, `chat-shell.tsx` |
| 6 | Integration test | `integration.test.ts` |
| 7 | Final verification | N/A |

**Total tasks:** 7
**Estimated time:** 45-60 minutes
