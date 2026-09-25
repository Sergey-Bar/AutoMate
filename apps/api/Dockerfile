# apps/api — Multi-stage Dockerfile
# Build context: repo root (docker-compose.unified.yml sets context: .)
#
# Stage 1: builder — installs deps and compiles TypeScript
# Stage 2: runtime — minimal image running compiled JS only

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace manifests (pnpm needs all package.json files to resolve the workspace)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the manifests for packages that apps/api depends on
# (pnpm requires them to resolve workspace: references)
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared-contracts/package.json ./packages/shared-contracts/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/realtime/package.json ./packages/realtime/package.json

# Install production dependencies for apps/api and its workspace deps
RUN pnpm install --frozen-lockfile --filter @automate/api...

# Copy source for apps/api and its workspace deps
COPY apps/api/ ./apps/api/
COPY packages/shared-contracts/ ./packages/shared-contracts/
COPY packages/auth/ ./packages/auth/
COPY packages/db/ ./packages/db/
COPY packages/realtime/ ./packages/realtime/

# Compile workspace packages → dist/
RUN pnpm --filter @automate/auth run build \
  && pnpm --filter @automate/db run build \
  && pnpm --filter @automate/realtime run build \
  && pnpm --filter @automate/shared-contracts run build \
  && pnpm --filter @automate/api run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace manifests needed to install production deps only
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared-contracts/package.json ./packages/shared-contracts/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/realtime/package.json ./packages/realtime/package.json

# Production-only install (no devDependencies)
RUN pnpm install --frozen-lockfile --filter @automate/api... --prod

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/realtime/dist ./packages/realtime/dist
COPY --from=builder /app/packages/shared-contracts/dist ./packages/shared-contracts/dist

# Run as non-root user for security
USER node

WORKDIR /app/apps/api

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
