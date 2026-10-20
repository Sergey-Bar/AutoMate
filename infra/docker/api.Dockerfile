FROM node:24.21.0-alpine AS build
WORKDIR /app
# pnpm is not named here: Corepack reads `packageManager` from package.json, so the image uses the
# same pnpm the repository does. A pin written in this file went stale (it said 10.30.2 while the
# repository moved to 11) and was a second place to keep in step.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# `<package>...` builds the package and everything it depends on, in dependency order, so the
# list cannot fall behind the code. A hand-written list did: it omitted @automate/projects and the
# image never built.
RUN pnpm --filter "@automate/api..." build


FROM node:24.21.0-alpine AS runtime
WORKDIR /app
# pnpm is not named here: Corepack reads `packageManager` from package.json, so the image uses the
# same pnpm the repository does. A pin written in this file went stale (it said 10.30.2 while the
# repository moved to 11) and was a second place to keep in step.
RUN corepack enable
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
# `--import` preloads the Sentry SDK ahead of the module graph. Node re-runs
# `--require` preloads on its module loader thread, so the SDK would never reach
# the application; `--import` is the only form v11 supports.
CMD ["node", "--import", "./apps/api/dist/instrument.js", "apps/api/dist/index.js"]
