# Automate Architecture Decisions & Recon Corrections

**Date:** 2026-03-12
**Context:** Oracle agent unavailable (3 timeouts). Decisions made based on Phase 1 recon findings, MCP SDK docs (Context7), Zod v4 docs, and GitHub source analysis.

---

## 7 Architectural Decisions

### Decision 1: Zod v3/v4 Strategy → **Use Zod v4 everywhere**

**Research findings:**
- Zod v4 ships with the `zod` npm package. You get both: `import { z } from 'zod'` (v3 compat) and `import { z } from 'zod/v4'` (v4 native).
- MCP SDK (`@modelcontextprotocol/server`) uses `import * as z from 'zod/v4'` internally.
- MCP SDK lists `zod` (not `zod@4`) as a peer dependency — it expects the unified package.
- Zod v4 has a community codemod `zod-v3-to-v4` for migration.
- Base API (`z.object()`, `z.string()`, `z.number()`, etc.) is identical between v3 and v4.

**Decision:** Install `zod` (latest, which is v4.x). Use `import { z } from 'zod'` in shared/server/frontend code (v3-compat API). Use `import { z } from 'zod/v4'` only in connector-sdk and connectors where MCP SDK requires it. Since it's ONE package with dual entry points, no version conflict.

**Rationale:** Single dependency, no conflicts, Dashboard patterns work unchanged via v3-compat import, MCP SDK gets native v4 via `zod/v4` import.

---

### Decision 2: In-process vs stdio MCP → **In-process by default, stdio for external/sandboxed**

**Research findings:**
- MCP SDK provides `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/core`.
- Pattern: `const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()` → connect client to one, server to the other. Zero child processes.
- SDK also provides `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node` for remote servers.
- Stdio transport is specifically for "local process-spawned integrations".

**Decision:** Use `InMemoryTransport` for all built-in connectors (github, jira, slack, etc.). They run in the same Node.js process as the Fastify server. Reserve `StdioServerTransport` for user-installed external connectors that need process isolation.

**Rationale:** 12 child processes = ~600MB RAM overhead on desktop. In-process connectors use ~0 extra memory. InMemoryTransport is officially supported and used extensively in MCP SDK tests. We get hot-loading by creating new InMemoryTransport pairs. Process isolation only needed for untrusted third-party connectors.

**Impact on architecture:**
- `ConnectorRegistry` needs two modes: `in-process` (InMemoryTransport) and `external` (StdioServerTransport)
- `BaseConnector` stays the same — it just receives a different transport
- Built-in connectors register tools and connect via InMemoryTransport
- ConnectorRegistry holds a `Client` per connector, wrapping the clientTransport side

---

### Decision 3: Tool namespacing with AI SDK → **Registry flattens with dot-notation, Executor routes**

**Decision:** ConnectorRegistry builds the AI SDK `tools` object by iterating all loaded connectors and creating entries like:
```typescript
tools = {
  'github.create_issue': tool({ 
    description: '...', 
    inputSchema: z.object({...}),
    execute: async (args) => registry.dispatch('github.create_issue', args) 
  }),
  'jira.search_issues': tool({ ... }),
  ...
}
```

The `dispatch()` method splits on the first dot to find the connector name, then calls `client.callTool()` on the appropriate MCP client (InMemoryTransport or Stdio).

**Rationale:** AI SDK expects flat tool names. Dot notation is the simplest way to namespace without collisions. The LLM sees descriptive tool names like `github.create_issue` which naturally group by connector. The Executor/dispatch layer handles routing transparently.

---

### Decision 4: Vault session lifecycle → **Unlock on app start, lock on quit, optional inactivity timeout**

**Decision:**
- Vault prompt appears on first app launch (create master password) and on each subsequent app start (enter master password)
- Derived key held in memory for the duration of the app session (process lifetime)
- Optional inactivity timeout (default: disabled for desktop, enabled for Docker: 30min)
- Tauri's `tauri-plugin-store` or OS keychain can optionally cache the master password for convenience (user opt-in)
- In Docker mode: vault password via environment variable (`VAULT_PASSWORD`) or prompt on first API call

**Rationale:** Desktop users expect to enter a password once when opening the app, not repeatedly. The vault is local-only — the threat model is someone accessing the filesystem, not a remote attacker. Inactivity lock adds UX friction with minimal security benefit for desktop. Docker deployments need env-var support for automation.

---

### Decision 5: EventHub / WebSocket → **Single `@fastify/websocket` only**

**Decision:** Use `@fastify/websocket` for all WebSocket needs. No separate ws server.

Automate WebSocket events:
- Connector health status changes
- Background task progress (flow execution steps)
- System notifications (model download progress, etc.)
- Agent streaming events (beyond SSE — e.g., tool execution progress)

**Rationale:** Dashboard's dual WS was needed because external test reporters connected on a separate port. Automate has no external reporters — only browser clients. One WebSocket endpoint via Fastify plugin is simpler, fewer ports, easier Tauri bundling.

**Pattern:**
```typescript
// apps/server/src/services/event-hub.ts
export class EventHub {
  private clients: Set<WebSocket> = new Set();
  
  addClient(ws: WebSocket): void;
  removeClient(ws: WebSocket): void;
  broadcast(event: { type: string; payload: unknown }): void;
  broadcastTo(type: string, event: { type: string; payload: unknown }): void;
}
```

---

### Decision 6: AI SDK + MCP bridge → **MCP Client wrapping via InMemoryTransport**

**Decision:** For each connector, the ConnectorRegistry creates:
1. An `InMemoryTransport` pair: `[clientTransport, serverTransport]`
2. A `Client` (from `@modelcontextprotocol/client`) connected to `clientTransport`
3. The connector's `McpServer` connected to `serverTransport`
4. AI SDK tool handlers that call `client.callTool({ name, arguments })` and return the result

```typescript
// Simplified bridge pattern
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

// Server side (connector)
const mcpServer = new McpServer({ name: 'github', version: '1.0.0' });
mcpServer.registerTool('create_issue', { inputSchema }, handler);
await mcpServer.connect(serverTransport);

// Client side (registry)
const client = new Client({ name: 'automate-agent', version: '1.0.0' });
await client.connect(clientTransport);

// AI SDK tool definition
const aiTool = tool({
  description: 'Create a GitHub issue',
  inputSchema: z.object({ title: z.string(), body: z.string() }),
  execute: async (args) => {
    const result = await client.callTool({ name: 'create_issue', arguments: args });
    return result;
  }
});
```

**Rationale:** This is exactly how the MCP SDK's own tests work. `InMemoryTransport` provides synchronous-feeling async communication. The `Client.callTool()` method returns a Promise with the result, which is exactly what AI SDK tool handlers expect. No stdio parsing, no child process management, no JSON-RPC serialization overhead (InMemoryTransport passes objects directly).

---

### Decision 7: Database migration strategy → **Bundled migrations for production, push for dev**

**Decision:**
- **Development:** `drizzle-kit push` on startup (fast iteration, no migration files)
- **Production (Tauri/Docker):** `drizzle-kit generate` during build → SQL migration files bundled with the app → `migrate()` on startup
- **Auto-update:** Each app version includes its migration files. On startup, `migrate()` applies any pending migrations.
- Migration files stored in `apps/server/drizzle/` (standard Drizzle convention)

```typescript
// apps/server/src/db/client.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

if (process.env.NODE_ENV === 'production') {
  migrate(db, { migrationsFolder: './drizzle' });
} else {
  // In dev, use drizzle-kit push via CLI
}
```

**Rationale:** `push` is destructive (can drop columns) — unacceptable for user data in production. Generated migrations are safe, auditable, and versioned. Drizzle's migrator tracks applied migrations in a `__drizzle_migrations` table. Desktop apps need reliable schema evolution across versions.

---

## Comprehensive Recon Corrections (MUST apply to architecture doc + plan)

### Package Name Corrections
| Wrong (in docs/plan) | Correct | Notes |
|---|---|---|
| `@ai-sdk/ollama` | `ollama-ai-provider-v2` | Community package. Import: `import { ollama } from 'ollama-ai-provider-v2'` |
| `@modelcontextprotocol/typescript-sdk` | `@modelcontextprotocol/server` + `@modelcontextprotocol/client` + `@modelcontextprotocol/core` | v2 split into multiple packages |
| `@vercel/ai-elements` | N/A (local components) | Install via `pnpm dlx ai-elements@latest`, copies to `@/components/ai-elements/` |
| `ollama-js` | N/A | Not used. The AI SDK provider is `ollama-ai-provider-v2` |

### API Corrections
| Wrong (in docs/plan) | Correct |
|---|---|
| `useChat({ api: '/api/chat' })` | `useChat({ transport: new DefaultChatTransport({ api: '/api/chat' }) })` |
| `<Loader />` | `<Shimmer />` |
| `tool({ parameters: z.object({...}) })` | `tool({ inputSchema: z.object({...}) })` |
| `server.tool(name, schema, handler)` | `server.registerTool(name, { inputSchema, title, description }, handler)` |
| `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js` | `StdioServerTransport` from `@modelcontextprotocol/server` |

### Version Corrections
| Wrong (in plan) | Correct |
|---|---|
| TypeScript `^5.8.2` | TypeScript `~5.9` (match Dashboard) |
| Vitest `3.x` | Vitest `4.x` (match Dashboard) |
| Zod v3 only | Zod v4 (single package, dual import paths) |

### New Packages to Add
| Package | Purpose | Import Path |
|---|---|---|
| `@modelcontextprotocol/client` | MCP Client for connecting to connector servers | `import { Client } from '@modelcontextprotocol/client'` |
| `@modelcontextprotocol/core` | Core types + InMemoryTransport | `import { InMemoryTransport } from '@modelcontextprotocol/core'` |
| `@modelcontextprotocol/node` | Node-specific transports (NodeStreamableHTTPServerTransport) | Only if needed for remote connectors |

### Architecture Changes
1. **ConnectorRegistry**: Support both InMemoryTransport (built-in) and StdioServerTransport (external)
2. **No child processes for built-in connectors**: Use InMemoryTransport.createLinkedPair()
3. **MCP Client per connector**: Registry holds Client instances, not direct process handles
4. **EventHub**: Single @fastify/websocket, no separate ws server
5. **Vault**: Unlock on app start, optional timeout, env var for Docker
6. **Migrations**: Bundled SQL files for production, push for dev

### Tailwind 4 Config
- No `tailwind.config.js` file
- CSS-first config via `@theme` directive in `apps/web/src/index.css`
- PostCSS config: `postcss.config.mjs` with `@tailwindcss/postcss` plugin
- No `@tailwindcss/vite` needed — PostCSS handles it
