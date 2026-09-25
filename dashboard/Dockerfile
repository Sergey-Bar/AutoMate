# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# Install all deps, compile TypeScript, build client SPA
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# node-gyp requirements for compiling native modules (node-pty)
RUN apk add --no-cache python3 make g++

# Enable pnpm v10 via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
# Copy workspace config and all package.json files first (layer cache)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/client/package.json ./apps/client/
COPY packages/shared/package.json ./packages/shared/
COPY packages/reporter/package.json ./packages/reporter/
COPY packages/cli/package.json ./packages/cli/
RUN pnpm install --frozen-lockfile

# ── Copy source ───────────────────────────────────────────────────────────────
COPY tsconfig.base.json ./
COPY apps/server ./apps/server
COPY apps/client ./apps/client
COPY packages/shared ./packages/shared
COPY packages/reporter ./packages/reporter

# ── Build ─────────────────────────────────────────────────────────────────────
# Build reporter first — server imports from '@automate/reporter' (workspace dep with dist/ exports)
RUN pnpm --filter @automate/reporter build

# Build server TypeScript → apps/server/dist/
RUN pnpm --filter @automate/dashboard-server build

# Build client SPA → apps/client/dist/
RUN pnpm --filter @automate/dashboard-client build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production
# Minimal runtime — production deps only, no devDeps, no source files
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

# node-pty is in optionalDependencies — skipped when build tools are absent.
# To enable the terminal runner, add: python3 make g++ and set FEATURE_TERMINAL_RUNNER=true

# dumb-init: ensures SIGTERM propagates correctly to Node.js (PID 1 safety)
RUN apk add --no-cache dumb-init

# OCI metadata for GitHub Container Registry
LABEL org.opencontainers.image.source="https://github.com/automate-hq/automate"
LABEL org.opencontainers.image.description="Self-hosted Playwright QA Dashboard"
LABEL org.opencontainers.image.licenses="MIT"

# Disable io_uring in libuv — avoids compatibility issues on some Alpine kernels
ENV UV_USE_IO_URING=0

# Enable pnpm v10 via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

ENV NODE_ENV=production

WORKDIR /app

# ── Production-only install ───────────────────────────────────────────────────
# All workspace package.json files must be present for pnpm to resolve the graph
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/client/package.json ./apps/client/
COPY packages/shared/package.json ./packages/shared/
COPY packages/reporter/package.json ./packages/reporter/
COPY packages/cli/package.json ./packages/cli/
# Install production deps for server only.
# --ignore-scripts: prevents root "prepare" from running husky (devDependency, not installed)
#                   and prevents node-pty (optional) from failing on missing build tools.
# Then rebuild better-sqlite3 which is the only native dep needed at runtime.
RUN pnpm install --filter @automate/dashboard-server --prod --frozen-lockfile --ignore-scripts && \
    pnpm rebuild better-sqlite3

# ── Copy built artifacts ──────────────────────────────────────────────────────
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/client/dist ./apps/client/dist

# ── Non-root user ─────────────────────────────────────────────────────────────
# Run as a dedicated non-root user for security hardening
RUN addgroup -S appgrp && adduser -S appuser -G appgrp

# ── Runtime configuration ─────────────────────────────────────────────────────
# Pre-create data directories — docker-compose will mount volumes here
# Ensure both directories are owned by the non-root user
RUN mkdir -p /app/apps/server/data /app/apps/server/test-results && \
    chown -R appuser:appgrp /app/apps/server/data /app/apps/server/test-results && \
    chown -R appuser:appgrp /app/node_modules /app/apps /app/packages

# WORKDIR must be /app/apps/server so that:
#   path.resolve(cwd(), '../client/dist') → /app/apps/client/dist  ✓
#   path.join(cwd(), 'data')              → /app/apps/server/data  ✓
#   path.resolve(cwd(), 'test-results')   → /app/apps/server/test-results  ✓
WORKDIR /app/apps/server

# Switch to non-root user before running the application
USER appuser

EXPOSE 4000
EXPOSE 4001

# dumb-init as PID 1 ensures SIGTERM reaches Node.js for graceful shutdown
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
