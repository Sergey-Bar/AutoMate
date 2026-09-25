FROM node:24.21.0-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @automate/db build
USER node
ENTRYPOINT ["node", "packages/db/dist/migrate.js"]
