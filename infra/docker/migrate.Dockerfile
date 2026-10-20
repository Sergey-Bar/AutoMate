FROM node:24.21.0-alpine
WORKDIR /app
# pnpm is not named here: Corepack reads `packageManager` from package.json, so the image uses the
# same pnpm the repository does. A pin written in this file went stale (it said 10.30.2 while the
# repository moved to 11) and was a second place to keep in step.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@automate/db..." build
# Read-only work, but the migration needs the drizzle directory to be readable
# and the tsc build cache to be writable during `pnpm install` above.
RUN chown -R node:node /app
USER node
ENTRYPOINT ["node", "packages/db/dist/migrate.js"]
