# apps/web — Multi-stage Dockerfile
# Build context: repo root (docker-compose.unified.yml sets context: .)
#
# Stage 1: builder — installs deps and runs vite build
# Stage 2: runtime — nginx:alpine serves the static dist/

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the manifests for packages that apps/web depends on
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared-contracts/package.json ./packages/shared-contracts/package.json
COPY packages/realtime/package.json ./packages/realtime/package.json
COPY packages/ui/package.json ./packages/ui/package.json

# Install all dependencies (dev included — needed for vite build)
RUN pnpm install --frozen-lockfile --filter @automate/unified-web...

# Copy source for apps/web and its workspace deps
COPY apps/web/ ./apps/web/
COPY packages/shared-contracts/ ./packages/shared-contracts/
COPY packages/realtime/ ./packages/realtime/
COPY packages/ui/ ./packages/ui/

# Build workspace package dependencies and static assets → dist/
RUN pnpm --filter @automate/shared-contracts run build \
  && pnpm --filter @automate/realtime run build \
  && pnpm --filter @automate/unified-web run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy compiled static assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy a minimal nginx config that handles SPA routing
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
