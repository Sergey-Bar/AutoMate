FROM node:24.21.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @automate/shared-contracts build \
  && pnpm --filter @automate/config build \
  && pnpm --filter @automate/auth build \
  && pnpm --filter @automate/automation build \
  && pnpm --filter @automate/orchestration build \
  && pnpm --filter @automate/db build \
  && pnpm --filter @automate/reporting build \
  && pnpm --filter @automate/reporter build \
  && pnpm --filter @automate/realtime build \
  && pnpm --filter @automate/api build

FROM node:24.21.0-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY --from=build /app ./
COPY --from=build /app/packages/db/drizzle /app/packages/db/drizzle
ENV NODE_ENV=production
ENV HOST=0.0.0.0
# `COPY --from=build /app ./` lands root-owned, and the runtime user is `node`
# (uid 1000), so the mounted artifact volume was unwritable and *every* artifact
# write failed at runtime. `runner.Dockerfile` already did this chown, which is
# what proves the omission was an oversight rather than a decision.
RUN mkdir -p /var/lib/automate/artifacts \
  && chown -R node:node /app /var/lib/automate
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
