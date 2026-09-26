FROM node:24.21.0-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @automate/db build
# Read-only work, but the migration needs the drizzle directory to be readable
# and the tsc build cache to be writable during `pnpm install` above.
RUN chown -R node:node /app
USER node
ENTRYPOINT ["node", "packages/db/dist/migrate.js"]
