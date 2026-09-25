<p align="center">
  <h1 align="center">Automate</h1>
  <p align="center">AI-native QA orchestration platform. Chat with an AI assistant that connects to GitHub, Jira, and Slack to automate your QA workflows.</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 22+" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Ollama-000000?style=flat-square&logo=ollama&logoColor=white" alt="Ollama" />
  <img src="https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm" />
</p>

<p align="center">
  <!-- screenshot -->
</p>

---

## Why Automate?

Most QA tooling is either a SaaS product that ships your data to someone else's servers, or a pile of disconnected scripts with no memory. Automate is neither.

| | |
|---|---|
| **On-premise** | Runs entirely on your machine. No data leaves your network. |
| **AI-powered** | Conversational QA via Ollama and llama3.1. Ask questions, create issues, summarize test runs. |
| **Integrated** | GitHub, Jira, and Slack connectors ship out of the box. |
| **Encrypted** | AES-256-GCM vault with PBKDF2 key derivation protects every stored credential. |
| **Extensible** | The connector SDK lets you build custom integrations with full type safety. |

---

## Quick Start

**Prerequisites:** [Node.js 22+](https://nodejs.org), [pnpm 9+](https://pnpm.io), [Ollama](https://ollama.com/download)

**1. Install Ollama and pull the model**

```bash
ollama pull llama3.1
```

**2. Install dependencies and build**

```bash
pnpm install
pnpm build
```

**3. Start the server**

```bash
pnpm --filter @automate/server dev
```

The API starts on `http://localhost:3000`. Verify with `GET /health`.

**4. Start the frontend**

```bash
pnpm --filter @automate/web dev
```

The UI starts on `http://localhost:5173` and proxies API calls to port 3000.

---

## Docker

The fastest way to get started:

```bash
docker compose up
```

This brings up Automate on port 3000 and an Ollama sidecar on port 11434. Pull the model once the containers are running:

```bash
docker compose exec ollama ollama pull llama3.1
```

---

## Features

| Feature | Description |
|---|---|
| AI Chat Interface | Conversational QA via Ollama/llama3.1 with streaming responses |
| GitHub Connector | Create issues, comment on PRs via Octokit |
| Jira Connector | Create issues, run JQL searches via REST API v3 |
| Slack Connector | Post QA summaries via Incoming Webhooks |
| SQL Browser | Query the database directly with safety guards |
| Encrypted Vault | AES-256-GCM credential storage with PBKDF2 key derivation |
| Conversation Persistence | SQLite WAL mode via Drizzle ORM |
| Execution Logging | Full audit trail for every tool call |
| Real-time Events | WebSocket broadcasting for tool execution status |
| Settings UI | Model config, vault management, connector toggles |
| Dark / Light Theme | Automatic theme support |

<p align="center">
  <!-- screenshot: automate-chat.png -->
</p>

<p align="center">
  <!-- screenshot: automate-settings.png -->
</p>

---

## Architecture

Automate is a Turborepo monorepo with pnpm workspaces.

```
apps/
  server/          Fastify 5 + AI orchestrator + WebSocket
  web/             React 19 + TanStack Router + Tailwind CSS 4
  desktop/         Tauri (future)

packages/
  shared/          Shared Zod schemas
  connector-sdk/   Connector type system (Zod v4 + MCP SDK)
  connectors/
    github/        Octokit-based GitHub integration
    jira/          Jira REST API v3 integration
    slack/         Slack Incoming Webhooks
    sql-browser/   SQLite query with safety validation
```

The server and web app are independently deployable. The AI orchestrator runs inside the server process and communicates with Ollama over HTTP. Connectors are loaded at startup and exposed as tools through the Vercel AI SDK.

---

## Connector Setup

Credentials are stored in the encrypted vault and never written to disk in plain text.

1. Go to **Settings > Vault** and unlock with your password
2. Go to **Settings > Connectors**
3. Add credentials for each connector:
   - **GitHub** — personal access token with `repo` scope
   - **Jira** — JSON object with `baseUrl`, `email`, `apiToken`
   - **Slack** — incoming webhook URL

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama base URL |
| `AUTOMATE_MODEL` | `llama3.1` | LLM model name |
| `AUTOMATE_ENDPOINT` | `http://localhost:11434` | Model endpoint |
| `AUTOMATE_TEMPERATURE` | `0.7` | Generation temperature |
| `AUTOMATE_MAX_TOKENS` | `4096` | Max output tokens |
| `VAULT_DB_PATH` | `.automate-vault.db` | Path to the vault database |
| `VAULT_PASSWORD` | — | Auto-unlock the vault on startup |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit window duration |

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check with DB and Ollama status |
| `POST` | `/api/chat` | AI chat with streaming |
| `POST` | `/api/conversations` | Create a new conversation |
| `GET` | `/api/conversations` | List all conversations |
| `GET` | `/api/conversations/:id` | Get a conversation with messages |
| `GET` | `/api/conversations/:id/messages` | List messages in a conversation |
| `DELETE` | `/api/conversations/:id` | Delete a conversation |
| `GET` | `/api/connectors` | List connector configs |
| `PUT` | `/api/connectors/:name` | Update a connector config |
| `GET` | `/api/model-config` | Get current model configuration |
| `PUT` | `/api/model-config` | Update model configuration |
| `POST` | `/api/vault/unlock` | Unlock the vault |
| `POST` | `/api/vault/lock` | Lock the vault |
| `POST` | `/api/vault/credentials` | Set a connector credential |
| `WS` | `/ws` | Real-time tool execution events |

---

## Development

```bash
# Run everything in parallel (server + web dev servers)
pnpm dev

# Run all tests (544 tests across 185 test files)
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build all packages
pnpm build

# Full verification (build + test + typecheck + lint)
pnpm verify
```

Server test coverage: **97.17% statements**.

---

## Building Connectors

The `connector-sdk` package exports a typed interface for building custom connectors. Any connector that implements the interface is automatically discovered and exposed as an AI tool at startup. See [`packages/connector-sdk`](./packages/connector-sdk) for the type definitions and a minimal example.

---

## License

Private — Automate internal use.
