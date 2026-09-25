# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy only package manifests first for optimal layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/connector-sdk/package.json ./packages/connector-sdk/
COPY packages/connectors/github/package.json ./packages/connectors/github/
COPY packages/connectors/jira/package.json ./packages/connectors/jira/
COPY packages/connectors/slack/package.json ./packages/connectors/slack/
COPY packages/connectors/sql-browser/package.json ./packages/connectors/sql-browser/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# Now copy source (this layer invalidates on code changes, but deps are cached)
COPY apps ./apps
COPY packages ./packages

RUN pnpm build

# ── Stage 3: Production image ────────────────────────────────────────────────
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

# Copy package manifests and install production deps only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/connector-sdk/package.json ./packages/connector-sdk/
COPY packages/connectors/github/package.json ./packages/connectors/github/
COPY packages/connectors/jira/package.json ./packages/connectors/jira/
COPY packages/connectors/slack/package.json ./packages/connectors/slack/
COPY packages/connectors/sql-browser/package.json ./packages/connectors/sql-browser/

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/connector-sdk/dist ./packages/connector-sdk/dist
COPY --from=build /app/packages/connectors/github/dist ./packages/connectors/github/dist
COPY --from=build /app/packages/connectors/jira/dist ./packages/connectors/jira/dist
COPY --from=build /app/packages/connectors/slack/dist ./packages/connectors/slack/dist
COPY --from=build /app/packages/connectors/sql-browser/dist ./packages/connectors/sql-browser/dist

RUN mkdir -p data && chown -R appuser:appgroup /app

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
