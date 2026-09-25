FROM node:22.19.0-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @automate/shared-contracts build \
  && pnpm --filter @automate/config build \
  && pnpm --filter @automate/auth build \
  && pnpm --filter @automate/db build \
  && pnpm --filter @automate/reporting build \
  && pnpm --filter @automate/realtime build \
  && pnpm --filter @automate/migrate-cli build
USER node
ENTRYPOINT ["node", "tools/migrate-cli/dist/index.js"]
