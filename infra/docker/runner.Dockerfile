FROM node:24.22.1-bookworm-slim AS build
WORKDIR /src
# Corepack reads `packageManager` from package.json, so the image uses the repository's pnpm.
RUN corepack enable
COPY . .
# Build the runner and its workspace dependencies, then write only what it runs to /out
# (`deploy --prod`; see api.Dockerfile). `@playwright/test` is a production dependency of
# the runner, so the deployed tree carries the CLI that installs the browsers below.
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@automate/runner..." build \
  && pnpm --filter "@automate/runner" --prod deploy --legacy /out


FROM node:24.22.1-bookworm-slim AS runtime
ARG AUTOMATE_VERSION=dev
ARG AUTOMATE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/AutoMate" \
  org.opencontainers.image.title="automate-runner" \
  org.opencontainers.image.version="${AUTOMATE_VERSION}" \
  org.opencontainers.image.revision="${AUTOMATE_REVISION}"
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build --chown=node:node /out ./
# The browsers and their system libraries, from the deployed Playwright so the two versions
# cannot disagree. Installed as root (`--with-deps` uses apt), then handed to `node`.
RUN node node_modules/@playwright/test/cli.js install --with-deps chromium firefox webkit \
  && mkdir -p /var/lib/automate/artifacts \
  && chown -R node:node /var/lib/automate /ms-playwright \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3002/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
