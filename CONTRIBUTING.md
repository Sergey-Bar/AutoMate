# Contributing to Automate

Thanks for contributing. This guide keeps contributions consistent and review-ready.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **Ollama** (for local AI flows)

## Development Setup

```bash
# Clone and install
git clone <your-repo-url>
cd Automate
pnpm install

# Optional: copy environment variables
cp .env.example .env

# Build once
pnpm build

# Start dev servers
pnpm dev
```

Server defaults to `:3000`, web defaults to `:5173`.

## Project Structure

```text
Automate/
├── apps/
│   ├── server/     # Fastify API + AI orchestration + WebSocket
│   ├── web/        # React client
│   └── desktop/    # Tauri app (future)
├── packages/
│   ├── shared/     # Shared schemas/types
│   ├── connector-sdk/
│   └── connectors/ # github, jira, slack, sql-browser
└── docs/
```

## Code Conventions

- TypeScript strict mode only.
- No `any`, no `@ts-ignore`, no `@ts-expect-error`.
- Follow existing import style and file organization.
- Keep route/service boundaries clear (no hidden cross-layer coupling).

## Testing & Verification

Run all quality gates before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Or run the full gate:

```bash
pnpm verify
```

### Testing expectations

- Add/adjust tests for every behavior change.
- Keep tests colocated with source files when possible.
- Never delete/skip failing tests to force green results.

## Pull Request Process

1. Create a focused branch from `main`.
2. Keep PR scope small and coherent.
3. Describe:
   - what changed,
   - why it changed,
   - how you validated it.
4. Ensure CI is green before requesting review.

## Security & Secrets

- Never commit real tokens/credentials.
- Use `.env` locally and keep `.env.example` up to date.
- Do not log sensitive connector/vault data.
