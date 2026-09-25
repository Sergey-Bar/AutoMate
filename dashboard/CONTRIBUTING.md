# Contributing to Automate

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **Docker** (optional, for container testing)

## Development Setup

```bash
# Clone the repo
git clone https://github.com/automate-hq/automate.git
cd automate

# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env

# Push the database schema
pnpm --filter @automate/dashboard-server run db:push

# (Optional) Seed sample data
pnpm seed:perf

# Start dev servers (client :5173, server :4000)
pnpm dev
```

## Project Structure

```
automate/
├── apps/
│   ├── server/       # Fastify 5 + Drizzle ORM + SQLite
│   └── client/       # React 19 + Vite 7 + TanStack Router
├── packages/
│   ├── shared/       # Zod schemas shared between client & server
│   ├── reporter/     # Playwright WebSocket test reporter
│   └── cli/          # @automate/cli init command
├── docs-site/        # Starlight documentation site
└── docs/             # Internal docs and assets
```

## Code Conventions

- **TypeScript** everywhere — no `any`, no `@ts-ignore`, no `@ts-expect-error`
- **Formatting**: ESLint + Prettier (runs automatically via lint-staged on commit)
- **Server routes**: Fastify route plugins in `apps/server/src/routes/`
- **Client state**: Zustand stores in `apps/client/src/store/`
- **Validation**: Zod schemas in `packages/shared/` — reuse across client and server
- **Feature flags**: New experimental features must be gated via `feature-flags.ts`

## Testing

All changes must pass the existing test suite:

```bash
# Server tests (vitest)
pnpm --filter @automate/dashboard-server test

# Client tests (vitest)
pnpm --filter @automate/dashboard-client test

# Type checking (all packages)
pnpm typecheck

# Lint
pnpm lint
```

- Add tests for new features or bug fixes
- Don't delete or skip failing tests to make CI pass
- Run the full suite locally before opening a PR

## Pull Request Process

1. **Fork & branch** — create a feature branch from `main`
2. **Small, focused PRs** — one logical change per PR
3. **Describe your changes** — fill out the PR template
4. **Pass CI** — all tests, typecheck, and lint must be green
5. **Review** — PRs require at least one approval before merge

## Reporting Issues

- Use the **Bug Report** template for bugs
- Use the **Feature Request** template for enhancements
- Search existing issues before creating duplicates
- Include reproduction steps, environment details, and screenshots where helpful

## License

By contributing, you agree that your contributions will be licensed under the project's license.
