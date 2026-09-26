# AGENTS.md — QA Monorepo

> Guidelines for AI coding agents operating in this repository.

## Repository Overview

This is a **pnpm workspace monorepo** containing the unified Automate platform.

| Directory  | Product     | Stack                                           |
| ---------- | ----------- | ----------------------------------------------- |
| `apps/api` | Unified API | Hono v4, Effect, Drizzle ORM, PostgreSQL 16     |
| `apps/web` | Unified Web | React 19, Vite, TanStack Router, Tailwind CSS 4 |

The platform uses **pnpm 10+**, **Node.js 24+**, **TypeScript 5.9**, and **Vitest 4** for unit tests.

---

## Build / Lint / Test Commands

Turborepo orchestrates all tasks. Run from the root:

```bash
pnpm install              # Install all workspace deps
pnpm build                # Build all packages (turbo)
pnpm dev                  # Dev servers: API :3000, Web :5173
pnpm lint                 # ESLint across all packages
pnpm typecheck            # tsc --noEmit across all packages
pnpm test                 # Vitest run across all packages
pnpm verify               # Full gate: build + test + typecheck + lint
pnpm unify:preflight      # Pre-unification safety check
```

**Single package:**

```bash
pnpm --filter @automate/api test          # API tests only
pnpm --filter @automate/unified-web test  # Web client tests only
pnpm --filter @automate/shared-contracts test # Contracts tests only
pnpm --filter @automate/api dev           # API dev only
pnpm --filter @automate/unified-web dev   # Web dev only
```

**Single test file (Vitest):**

```bash
pnpm --filter @automate/api exec vitest run src/routes/conversations.test.ts
pnpm --filter @automate/api exec vitest run src/routes/chat.test.ts -t "specific test name"
```

**E2E tests (Playwright):**

```bash
npx playwright test                          # All e2e tests
npx playwright test e2e/some-file.spec.ts    # Single e2e file
```

**Database operations:**

```bash
pnpm --filter @automate/db run db:push       # Push schema to PostgreSQL
pnpm --filter @automate/db run db:generate   # Generate migrations
pnpm --filter @automate/db run db:studio     # Drizzle Studio
```

---

## Project Structure

```
apps/
  api/               Hono v4 API + Effect services (:3000)
  web/               React 19 + TanStack Router + Tailwind CSS 4 (:5173)
  runner/            Independent runner and execution boundary
  runner/           Rootless execution boundary
packages/
  auth/              Installation sessions and credentials
  automation/        AI gateway ports and streaming adapters
  db/                Drizzle schema and migrations (PostgreSQL)
  orchestration/     Job state machines and schedules
  realtime/          Versioned replay and SSE boundaries
  reporting/         Evidence, KPI, and quality-gate policies
  reporter/          Producer adapters
  shared-contracts/  Type-safe API contracts and Zod schemas
  ui/                Shared Tailwind 4 component library
tools/
  migrate-cli/       Migration utilities
e2e/                 Playwright end-to-end tests
```

---

## Code Style Guidelines

### TypeScript

- **Strict mode everywhere.** The project uses `"strict": true` in tsconfig.
- **Target ES2022**, module resolution `Bundler`, ESM (`"type": "module"` in all package.json).
- **NEVER** use `any`, `@ts-ignore`, or `@ts-expect-error`. ESLint enforces `@typescript-eslint/no-explicit-any`.
- Unused variables must be prefixed with `_` (e.g., `_req`, `_unused`). Enforced by ESLint.
- Use `prefer-const` — enforced as `"error"`.
- Use `.js` extensions in relative imports (ESM requirement): `import { foo } from './bar.js'`.

### Imports

- `import type { ... }` for type-only imports.
- Node built-ins: no prefix needed (target ES2022).
- Client path alias: `@/` maps to `src/` in web client.
- Workspace deps: `"workspace:*"` references in package.json.

### Naming Conventions

- **Files**: `kebab-case.ts` for services, routes, utilities. `PascalCase.tsx` for React components.
- **Variables/functions**: `camelCase`.
- **Types/Interfaces**: `PascalCase` (e.g., `FeatureFlagName`, `HubEvent`).
- **Zod schemas**: `PascalCase` with `Schema` suffix (e.g., `RunSchema`, `StartRunBody`).
- **Constants**: `UPPER_SNAKE_CASE` for true constants (e.g., `FLAG_DEFAULTS`, `PASS`).
- **Test files**: colocated with source as `*.test.ts` / `*.test.tsx`.

### Server Patterns (Hono / Effect)

- Use Effect for dependency injection and error handling in services.
- Request validation via Zod schemas defined in `shared-contracts`.
- Return structured JSON responses with appropriate HTTP status codes.

### Client Patterns (React 19)

- **State management**: Zustand stores in `store/` directory.
- **Data fetching**: TanStack Query (`useQuery`) in custom hooks in `hooks/`.
- **Routing**: TanStack Router with file-based routes in `routes/`.
- **Validation**: Zod schemas parse API responses on the client side.
- **UI components**: Tailwind CSS 4 + `packages/ui` library.
- **Icons**: `lucide-react`.

### Testing

- **Framework**: Vitest 4 with `globals: true`.
- **Coverage Thresholds**: Enforced per package in `vitest.config.ts`.
  - `@automate/api`: 93% Statements
  - `@automate/unified-web`: 91% Statements
  - `@automate/shared-contracts`: 100% All metrics
- **Coverage Ratcheting**: Use `pnpm coverage:ratchet` to prevent threshold regressions.
- **Mandatory Rules**:
  - Add or adjust tests for every behavior change.
  - Never delete or skip failing tests.
  - No `.skip` or `.only` in committed code.

### Security

- Never commit tokens/credentials. Use `.env` locally.
- Do not log sensitive data.
- Vault: AES-256-GCM encryption with PBKDF2 key derivation.

### Git / PR Workflow

- Branch from `main`. Small, focused PRs.
- All CI gates must pass before merge: `lint`, `typecheck`, `test`, `build`.
