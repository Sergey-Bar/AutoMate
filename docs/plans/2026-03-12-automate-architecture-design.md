# Automate Architecture Design

**Date:** 2026-03-12
**Status:** Approved (with corrections — see `2026-03-12-architecture-decisions.md`)
**Goal:** AI-native, locally-hosted QA orchestration platform — a single natural-language chat interface that chains tools together (GitHub, Playwright, Jira, Slack, Jenkins, etc.) using a local LLM via Ollama and MCP tool layer.

---

## 1. Tech Stack

| Layer | Technology | Source |
|---|---|---|
| Runtime | Node.js + TypeScript (ESM) | — |
| Frontend | React 19 + Vite | Dashboard pattern |
| Chat UI | AI Elements (shadcn-style, local components) | OSS: installed via `pnpm dlx ai-elements@latest` |
| State | Zustand | Dashboard pattern |
| Routing | TanStack Router | Dashboard pattern |
| Styling | Tailwind CSS 4 + shadcn/ui | Dashboard pattern |
| Backend | Fastify | Dashboard (exact match) |
| Database | Drizzle ORM + better-sqlite3 | Dashboard (exact match) |
| Real-time | `@fastify/websocket` + Vercel AI SDK SSE streaming | Dashboard ws pattern (simplified) |
| AI/LLM | Vercel AI SDK (`ai` + `@ai-sdk/react`) | OSS |
| LLM Provider | `ollama-ai-provider-v2` | OSS (community Vercel AI SDK provider) |
| Connectors | `@modelcontextprotocol/server` + `@modelcontextprotocol/client` + `@modelcontextprotocol/core` | OSS (official MCP v2) |
| Desktop | Tauri v2 | New |
| Monorepo | Turborepo + pnpm workspaces | New |
| Validation | Zod v4 (dual import: `zod` for v3-compat, `zod/v4` for MCP) | Dashboard (upgraded) |

---

## 2. Monorepo Structure

```
automate/
├── apps/
│   ├── web/                        # React + Vite + AI Elements frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── chat/           # Conversation, Message, PromptInput wrappers
│   │   │   │   ├── tools/          # Tool visualization (ToolHeader/ToolInput/ToolOutput)
│   │   │   │   ├── flows/          # Flow template selector & editor
│   │   │   │   ├── sql-browser/    # NL→SQL query interface
│   │   │   │   ├── settings/       # Connector config, model config, vault UI
│   │   │   │   └── ui/             # shadcn/ui primitives
│   │   │   ├── hooks/              # useChat, useConnectorStatus, etc.
│   │   │   ├── stores/             # Zustand stores
│   │   │   ├── routes/             # TanStack Router file-based routes
│   │   │   └── lib/                # Utilities, API client
│   │   └── index.html
│   │
│   ├── server/                     # Fastify Agent Core
│   │   ├── src/
│   │   │   ├── agent/              # Agent core: planner, executor, memory
│   │   │   ├── connectors/         # MCP connector manager & registry
│   │   │   ├── db/                 # Drizzle schema + client
│   │   │   ├── routes/             # Fastify route modules
│   │   │   ├── services/           # Business logic (reused from Dashboard)
│   │   │   └── vault/              # Encrypted credential store
│   │   └── package.json
│   │
│   └── desktop/                    # Tauri v2 shell
│       ├── src-tauri/
│       │   ├── src/main.rs
│       │   └── tauri.conf.json
│       └── package.json
│
├── packages/
│   ├── shared/                     # Shared types, Zod schemas, constants
│   │   └── src/index.ts
│   │
│   ├── connector-sdk/              # MCP connector SDK (npm-publishable)
│   │   └── src/
│   │       ├── base-connector.ts   # Abstract base class wrapping McpServer
│   │       ├── types.ts            # ConnectorManifest, ToolSchema, etc.
│   │       └── index.ts
│   │
│   └── connectors/                 # Built-in MCP connectors
│       ├── github/
│       ├── playwright/
│       ├── jira/
│       ├── slack/
│       ├── jenkins/
│       ├── api-client/             # Generic REST/GraphQL
│       ├── sql-browser/            # Text-to-SQL
│       ├── file-system/
│       ├── docker/
│       ├── teams/
│       ├── email/
│       └── webhook/
│
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.json
└── package.json
```

---

## 3. Agent Core Architecture

The Agent Core is the brain of Automate. It receives natural language input, plans a sequence of tool calls, executes them via MCP connectors, and streams results back to the user.

### 3.1 Pipeline

```
User Prompt
    │
    ▼
┌─────────────┐
│  Planner     │  LLM decides what tools to call and in what order.
│  (Vercel AI  │  Uses system prompt with available tool schemas.
│   SDK)       │  Supports multi-step tool calls (agentic loop).
└──────┬──────┘
       │  tool_call parts
       ▼
┌─────────────┐
│  Executor    │  Dispatches tool calls to MCP connectors.
│              │  Validates inputs against Zod schemas.
│              │  Handles retries, timeouts, error recovery.
└──────┬──────┘
       │  tool results
       ▼
┌─────────────┐
│  Memory      │  Persists conversation, tool results, attachments.
│  (SQLite)    │  Provides context window for follow-up queries.
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Streamer    │  SSE stream to frontend via Vercel AI SDK.
│              │  Streams text, tool-invocation, tool-result parts.
└─────────────┘
```

### 3.2 Planner

- Uses `ai` SDK's `streamText()` with `tools` parameter
- Each MCP connector registers its tools as AI SDK tool definitions
- System prompt includes: available tools, their schemas, user context, conversation history
- Multi-step: LLM can chain tool calls (tool result feeds back into LLM for next step)
- Flow templates pre-populate system prompt with domain-specific instructions

### 3.3 Executor

- Receives `tool-call` parts from the AI SDK stream
- Looks up the target connector in the ConnectorRegistry
- Validates tool input against the connector's Zod schema
- Dispatches via MCP stdio transport to the connector process
- Collects `tool-result` and feeds back into the AI SDK stream
- Timeout: configurable per-connector (default 30s)
- Error handling: returns structured error to LLM for self-correction

### 3.4 Memory

Conversation and tool execution history persisted to SQLite:

```
conversations
  ├── id (TEXT PK)
  ├── title (TEXT)
  ├── created_at (TEXT)
  └── updated_at (TEXT)

messages
  ├── id (TEXT PK)
  ├── conversation_id (TEXT FK → conversations.id)
  ├── role (TEXT: user | assistant | system | tool)
  ├── content (TEXT)  — text content or JSON for tool parts
  ├── tool_call_id (TEXT)  — links tool-result to tool-call
  ├── tool_name (TEXT)
  ├── created_at (TEXT)
  └── metadata (TEXT)  — JSON: tokens, model, latency, etc.

attachments
  ├── id (TEXT PK)
  ├── message_id (TEXT FK → messages.id)
  ├── name (TEXT)
  ├── content_type (TEXT)
  ├── path (TEXT)  — local file path
  └── size_bytes (INTEGER)
```

### 3.5 Streamer

- Uses Vercel AI SDK's `streamText()` → returns `ReadableStream`
- Frontend consumes via `useChat()` hook from `@ai-sdk/react`
- Stream parts: `text-delta`, `tool-call`, `tool-call-streaming-start`, `tool-result`, `finish`
- AI Elements `<Message>` component renders each part type automatically
- AI Elements `<Tool>` component shows tool invocation → loading → result states

---

## 4. MCP Connector Architecture

Each connector is a standalone MCP server that exposes tools via the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Built-in connectors run in-process via `InMemoryTransport`; external connectors use `StdioServerTransport`.

### 4.1 Connector SDK (`packages/connector-sdk`)

```typescript
// packages/connector-sdk/src/base-connector.ts
import { McpServer } from '@modelcontextprotocol/server';
import { InMemoryTransport } from '@modelcontextprotocol/core';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

export interface ConnectorManifest {
  name: string;           // e.g. "github"
  version: string;        // semver
  displayName: string;    // e.g. "GitHub"
  description: string;
  icon: string;           // icon identifier
  credentialSchema: z.ZodObject<any>;  // Zod schema for required credentials
  tools: ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  handler: (input: any, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  credentials: Record<string, string>;
  logger: Logger;
  abortSignal: AbortSignal;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

export abstract class BaseConnector {
  abstract manifest: ConnectorManifest;

  async start(): Promise<void> {
    const server = new McpServer({
      name: this.manifest.name,
      version: this.manifest.version,
    });

    for (const tool of this.manifest.tools) {
      server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (input) => {
        return tool.handler(input, this.createContext());
      });
    }

    // Built-in: use InMemoryTransport (in-process, no child process)
    // External: use StdioServerTransport (child process isolation)
    const transport = this.createTransport();
    await server.connect(transport);
  }

  protected abstract createContext(): ToolContext;

  /** Override for external connectors to use StdioServerTransport */
  protected createTransport(): Transport {
    // Default: caller provides transport (InMemoryTransport from registry)
    throw new Error('Transport must be provided by ConnectorRegistry');
  }
}
```

### 4.2 Connector Registry & Hot-Loading (FR-011)

The server manages connectors via `InMemoryTransport` (built-in) or child processes (external):

```typescript
// apps/server/src/connectors/registry.ts
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/core';

interface ConnectorEntry {
  client: Client;
  serverTransport: InMemoryTransport; // or StdioServerTransport for external
  tools: Map<string, ToolDefinition>;
}

export class ConnectorRegistry {
  private connectors: Map<string, ConnectorEntry> = new Map();

  /** Load a connector from its package directory */
  async load(name: string, packagePath: string): Promise<void>;

  /** Unload and stop a connector */
  async unload(name: string): Promise<void>;

  /** Hot-reload: unload + load without server restart */
  async reload(name: string): Promise<void>;

  /** Get all registered tool schemas (for AI SDK tools param) */
  getToolSchemas(): Record<string, ToolSchema>;

  /** Dispatch a tool call to the appropriate connector */
  async dispatch(toolName: string, input: unknown): Promise<ToolResult>;
}
```

- Built-in connectors run in-process via `InMemoryTransport.createLinkedPair()` — zero child processes
- External/third-party connectors run as child processes via `StdioServerTransport` for isolation
- Hot-loading: create new InMemoryTransport pair, connect, swap old entry, disconnect old
- Tool namespacing: `{connector}.{tool}` (e.g. `github.create_issue`, `jira.search_tickets`)
- AI SDK bridge: `registry.getAITools()` returns `Record<string, Tool>` for `streamText({ tools })`

### 4.3 Built-in Connectors (12)

| Connector | Dashboard Reuse | Tools |
|---|---|---|
| **github** | Drop-in: `github.ts` (221 lines) | create_issue, create_pr, list_prs, get_pr_checks, post_comment, create_commit_status |
| **playwright** | Pattern: `runner.ts` + `config-parser.ts` | run_tests, list_tests, get_config, run_codegen |
| **jira** | Drop-in: `jira.ts` (98 lines) | create_issue, search_issues, update_issue, add_comment |
| **slack** | Drop-in: `slack.ts` (79 lines) | send_message, post_summary, list_channels |
| **jenkins** | New | trigger_build, get_build_status, list_jobs, get_console_output |
| **api-client** | New | http_request (GET/POST/PUT/DELETE/PATCH with headers, body, auth) |
| **sql-browser** | Drop-in: `nl-query.ts` (396 lines) | query_natural_language, execute_sql (read-only), get_schema |
| **file-system** | New | read_file, write_file, list_directory, search_files |
| **docker** | New | list_containers, start_container, stop_container, get_logs, exec_command |
| **teams** | Drop-in: `teams.ts` (90 lines) | send_message, post_summary |
| **email** | Drop-in: `email.ts` (115 lines) | send_email, send_report |
| **webhook** | Drop-in: `webhooks.ts` (82 lines) | dispatch_webhook, list_webhooks |

---

## 5. Data Model (Drizzle + SQLite)

### 5.1 Core Tables

Building on the Dashboard's proven Drizzle + better-sqlite3 + WAL pattern:

```typescript
// apps/server/src/db/client.ts — same pattern as Dashboard
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
export const db = drizzle(sqlite, { schema });
```

### 5.2 Automate Schema (new tables)

```typescript
// Conversations
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  flowTemplateId: text('flow_template_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Messages (user, assistant, system, tool-call, tool-result)
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  toolName: text('tool_name'),
  metadata: text('metadata'),  // JSON: tokens, model, latency, cost
  createdAt: text('created_at').notNull(),
});

// Message attachments (screenshots, reports, logs)
export const messageAttachments = sqliteTable('message_attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes'),
});

// Connector configurations
export const connectorConfigs = sqliteTable('connector_configs', {
  id: text('id').primaryKey(),
  connectorName: text('connector_name').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).default(false),
  credentialRef: text('credential_ref'),  // reference to vault entry
  settings: text('settings'),  // JSON: connector-specific non-secret config
  updatedAt: text('updated_at').notNull(),
});

// Flow templates (predefined multi-step workflows)
export const flowTemplates = sqliteTable('flow_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  steps: text('steps'),  // JSON: ordered tool call hints
  category: text('category'),  // e.g. "regression", "smoke", "release"
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Agent execution log (audit trail)
export const executionLog = sqliteTable('execution_log', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .references(() => conversations.id),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(),   // JSON
  output: text('output'),           // JSON
  status: text('status', { enum: ['running', 'success', 'error', 'timeout'] }).notNull(),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});

// Model configuration
export const modelConfig = sqliteTable('model_config', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider').notNull().default('ollama'),
  model: text('model').notNull().default('llama3.1'),
  endpoint: text('endpoint').notNull().default('http://localhost:11434'),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  systemPrompt: text('system_prompt'),
  updatedAt: text('updated_at').notNull(),
});
```

---

## 6. Frontend Architecture

### 6.1 Route Structure

```
/                       → Chat (main view)
/chat/:conversationId   → Specific conversation
/flows                  → Flow template browser
/flows/:flowId          → Flow template editor
/sql                    → Text-to-SQL browser
/api-client             → REST/GraphQL API client
/settings               → Settings hub
/settings/connectors    → Connector management
/settings/model         → LLM model configuration
/settings/vault         → Credential vault
```

### 6.2 Chat UI (AI Elements)

The chat interface is built on AI Elements — shadcn-style components installed locally via `pnpm dlx ai-elements@latest` into `@/components/ai-elements/`:

```tsx
// Simplified structure
<Conversation>
  {messages.map(msg => (
    <Message key={msg.id} role={msg.role}>
      {msg.parts.map(part => {
        if (part.type === 'text') return <Markdown>{part.text}</Markdown>;
        if (part.type === 'tool-invocation') return (
          <Tool>
            <ToolHeader name={part.toolName} />
            {part.state === 'partial-call' && <ToolInput>{part.args}</ToolInput>}
            {part.state === 'call' && <Shimmer />}
            {part.state === 'result' && <ToolOutput>{part.result}</ToolOutput>}
          </Tool>
        );
      })}
    </Message>
  ))}
  <PromptInput onSubmit={handleSubmit} />
</Conversation>
```

Data flow:
- `useChat({ transport: new DefaultChatTransport({ api: '/api/chat' }) })` from `@ai-sdk/react` connects to Fastify SSE endpoint
- Automatic streaming: text deltas render incrementally, tool states transition live
- Conversation sidebar: list of past conversations with search
- Flow template selector: dropdown above prompt input to activate a flow

### 6.3 State Management (Zustand)

```typescript
// Core stores
useConversationStore    // active conversation, message list, streaming state
useConnectorStore       // connector status, enabled/disabled, health
useSettingsStore        // model config, theme, preferences
useFlowStore            // flow templates, active flow
```

### 6.4 Additional Views

**Text-to-SQL Browser** (reused from Dashboard `nl-query.ts`):
- Natural language input → SQL preview → results table
- Schema explorer sidebar
- Query history

**API Client**:
- Method selector (GET/POST/PUT/DELETE/PATCH)
- URL, headers, body editors
- Response viewer with syntax highlighting
- History and saved requests

---

## 7. Security Design

### 7.1 Credential Vault (NFR-011, FR-013)

All connector credentials stored encrypted — never in plaintext:

```
Architecture:
┌─────────────────────────────────────┐
│  Vault (apps/server/src/vault/)     │
│                                     │
│  ┌──────────┐  ┌────────────────┐   │
│  │ Master   │  │ AES-256-GCM    │   │
│  │ Password │→ │ PBKDF2 Key     │   │
│  │ (user)   │  │ Derivation     │   │
│  └──────────┘  └───────┬────────┘   │
│                        │             │
│              ┌─────────▼──────────┐  │
│              │ Encrypted Store    │  │
│              │ (vault.db)         │  │
│              │ key: connector_id  │  │
│              │ value: encrypted   │  │
│              │ iv: per-entry      │  │
│              │ tag: auth tag      │  │
│              └────────────────────┘  │
└─────────────────────────────────────┘
```

- AES-256-GCM encryption with per-entry IV
- Master key derived via PBKDF2 (100k iterations, SHA-256) from user-provided password
- Vault unlocked per-session (derived key held in memory only)
- OS keychain integration (optional, via Tauri keychain plugin) for master password storage
- Vault file: separate SQLite database (`vault.db`) — not in main DB

### 7.2 Local-Only Execution (NFR-010, NFR-013)

- All LLM inference via local Ollama — no external API calls for prompts or tool outputs
- Connectors communicate with external services (GitHub, Jira, etc.) using user-provided credentials
- No telemetry, no analytics, no phone-home
- Air-gapped mode: all npm dependencies bundled, Ollama models pre-downloaded, Tauri binary self-contained

### 7.3 SQL Safety (from Dashboard nl-query.ts)

- Forbidden keyword regex: `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX`
- Read-only execution via `better-sqlite3` read-only connection
- Result set capped at MAX_ROWS (50)
- Query timeout: 5000ms
- Schema-aware prompting: LLM only sees allowed table/column metadata

---

## 8. Real-time & Streaming

### 8.1 LLM Streaming (SSE)

```
Frontend (useChat)  ←── SSE ───  Fastify (/api/chat)
                                    │
                                    ▼
                               Vercel AI SDK
                               streamText()
                                    │
                                    ▼
                               Ollama (local)
```

- Vercel AI SDK `streamText()` returns a `ReadableStream` of AI stream parts
- Fastify pipes this stream as SSE to the frontend
- `useChat()` hook on frontend automatically parses stream parts
- Parts: `text-delta`, `tool-call-streaming-start`, `tool-call`, `tool-result`, `finish`

### 8.2 Event Broadcasting (WebSocket)

For non-LLM real-time events (connector status changes, background task completion, etc.):

```
Frontend (ws)  ←── WebSocket ───  Fastify (ws plugin)
                                       │
                                       ▼
                                  EventHub (adapted from
                                  Dashboard reporter-bridge.ts)
```

Pattern adapted from Dashboard's `ReporterBridge`:
- `EventHub` class manages WebSocket clients
- Broadcasts typed events: `{ type: string, payload: Record<string, unknown> }`
- Client filtering: subscribe to specific event types
- Used for: connector health pings, background task progress, system notifications

---

## 9. Dashboard Code Reuse Map

### 9.1 Drop-in (copy & adapt imports)

| Dashboard File | Automate Destination | Changes Needed |
|---|---|---|
| `services/integrations/github.ts` | `packages/connectors/github/` | Wrap as MCP tool handlers |
| `services/integrations/jira.ts` | `packages/connectors/jira/` | Wrap as MCP tool handlers |
| `services/integrations/slack.ts` | `packages/connectors/slack/` | Wrap as MCP tool handlers |
| `services/integrations/teams.ts` | `packages/connectors/teams/` | Wrap as MCP tool handlers |
| `services/integrations/email.ts` | `packages/connectors/email/` | Wrap as MCP tool handlers |
| `services/integrations/webhooks.ts` | `packages/connectors/webhook/` | Wrap as MCP tool handlers |
| `services/nl-query.ts` | `packages/connectors/sql-browser/` | Wrap as MCP tools, use Vercel AI SDK instead of raw fetch |
| `services/html-report.ts` | `apps/server/src/services/` | Direct reuse |
| `services/pdf-report.ts` | `apps/server/src/services/` | Direct reuse |
| `services/fingerprint.ts` | `apps/server/src/services/` | Direct reuse |
| `services/error-clustering.ts` | `apps/server/src/services/` | Direct reuse |
| `services/stability-grades.ts` | `apps/server/src/services/` | Direct reuse |
| `packages/shared/src/index.ts` | `packages/shared/src/` | Extend with Automate schemas |

### 9.2 Pattern Reuse (adapt architecture)

| Dashboard File | Automate Pattern | Adaptation |
|---|---|---|
| `services/ai-explain.ts` | AI provider abstraction | Replace raw fetch with Vercel AI SDK |
| `services/reporter-bridge.ts` | EventHub (WS broadcast) | Generalize for agent events instead of test events |
| `services/runner.ts` | Process spawning | Adapt for MCP connector child processes |
| `services/scheduler.ts` | Cron scheduling | Reuse for scheduled flow template execution |
| `services/ci-poller.ts` | GitHub Actions polling | Integrate into GitHub connector |
| `services/config-parser.ts` | Playwright config parsing | Move into Playwright connector |
| `db/schema.ts` | Drizzle schema patterns | Use same conventions for Automate tables |
| `db/client.ts` | SQLite + WAL + Drizzle init | Direct pattern reuse |

### 9.3 Build Infrastructure Reuse

| Dashboard File | Automate Usage |
|---|---|
| `tsconfig.base.json` | Copy and extend |
| `pnpm-workspace.yaml` | Copy and update package paths |
| `.eslintrc.json` | Copy as-is |
| `Dockerfile` | Adapt for Automate |
| `docker-compose.yml` | Adapt for Automate + Ollama |

---

## 10. Flow Templates

Flow templates are predefined multi-step workflows that guide the agent. They pre-populate the system prompt with domain-specific instructions and tool ordering hints.

### 10.1 Built-in Templates (from PRD FR-005)

| Template | Steps | Connectors Used |
|---|---|---|
| **Regression Gate** | Run tests → analyze failures → create Jira tickets → post Slack summary | playwright, jira, slack |
| **PR Review** | Get PR diff → run affected tests → post results as PR comment | github, playwright |
| **Flaky Test Triage** | Query flaky tests → cluster by error → auto-quarantine → notify | sql-browser, jira, slack |
| **Release Readiness** | Check all PR statuses → run full suite → generate report → email stakeholders | github, playwright, email |
| **Smoke Test** | Run smoke tag tests → post results to Slack | playwright, slack |
| **Bug Investigation** | Search Jira → find related test failures → analyze error patterns | jira, sql-browser |

### 10.2 Template Schema

```typescript
interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;     // Injected into LLM system prompt
  steps: FlowStep[];        // Ordered hints (LLM may deviate)
  category: string;
  requiredConnectors: string[];
}

interface FlowStep {
  description: string;      // Human-readable step description
  toolHint: string;         // Suggested tool: "playwright.run_tests"
  inputHint?: Record<string, unknown>;  // Suggested inputs
}
```

---

## 11. Deployment Modes

### 11.1 Desktop (Primary — Tauri)

```
┌─────────────────────────────────────┐
│  Tauri v2 App                       │
│  ┌──────────────────────────────┐   │
│  │  WebView (apps/web)          │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │  Sidecar: Fastify Server     │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │  Sidecar: Ollama             │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

- Tauri bundles the Vite frontend as WebView
- Fastify server runs as Tauri sidecar (Node.js process)
- Ollama managed externally (user installs separately) or bundled as sidecar
- OS keychain access via Tauri's keychain plugin

### 11.2 Docker (Team/CI)

```yaml
# docker-compose.yml
services:
  automate:
    build: .
    ports: ["3000:3000"]
    volumes:
      - ./data:/app/data        # SQLite + vault
      - ./connectors:/app/connectors  # Custom connectors
    environment:
      - OLLAMA_HOST=http://ollama:11434
  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]
    volumes:
      - ollama-data:/root/.ollama
```

### 11.3 Air-Gapped (NFR-013)

- All npm deps bundled in Docker image or Tauri binary
- Ollama models pre-downloaded and included in deployment
- No network calls except to configured connectors (GitHub, Jira, etc.)
- Connector URLs configurable for on-premise instances

---

## 12. Key Design Decisions

| Decision | Rationale |
|---|---|
| **Fastify over Express** | Dashboard already uses Fastify — zero adaptation needed for reused code |
| **Drizzle over Prisma** | Dashboard uses Drizzle — all schema patterns, migrations, queries reusable as-is |
| **Vercel AI SDK over raw Ollama** | Provides streaming, tool calling, multi-step agent loop, React hooks — the entire agent plumbing |
| **AI Elements over custom chat UI** | Pre-built shadcn/ui components for every chat primitive — eliminates weeks of custom UI work |
| **MCP over custom tool protocol** | Industry standard, official TypeScript SDK, existing OSS connectors, community ecosystem |
| **SQLite over PostgreSQL** | Single-file deployment, WAL mode handles concurrent reads, Dashboard proves it works at scale |
| **Separate vault.db** | Security isolation — main DB can be backed up/shared without exposing credentials |
| **Connector child processes** | Hot-loading (FR-011), fault isolation, security sandboxing per connector |
| **Turborepo** | Caching, parallel builds, dependency graph — needed as we scale to 12+ connector packages |
| **TanStack Router** | Type-safe routing matching the rest of the type-safe stack (Drizzle, Zod, AI SDK) |

---

## 13. Non-Functional Requirements Mapping

| NFR | Implementation |
|---|---|
| **NFR-001**: < 2s response to first token | Ollama model warm, Fastify cold start < 500ms, SSE streaming |
| **NFR-002**: Handle 50+ concurrent conversations | SQLite WAL + Fastify async, each conversation independent |
| **NFR-005**: < 500ms tool dispatch latency | MCP stdio transport, persistent connector processes |
| **NFR-010**: All inference local | Ollama only, no external LLM API calls |
| **NFR-011**: Encrypted credential storage | AES-256-GCM vault with PBKDF2 key derivation |
| **NFR-013**: Air-gapped deployment | Bundled deps, pre-downloaded models, self-contained binary |
| **NFR-014**: < 5min connector development | `connector-sdk` + `BaseConnector` abstract class + Zod schemas |
