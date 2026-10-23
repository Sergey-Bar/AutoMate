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


FROM node:24.22.1-bookworm-slim AS k6
# k6, the load generator the runner's `k6` capability runs (`apps/runner/src/k6-execution.ts`).
# Fetched and checked in a stage of its own so the download never reaches the runtime image:
# only the one binary is copied across. An exact release, and a SHA-256 per architecture taken
# from the release's `k6-v${K6_VERSION}-checksums.txt` - a mismatch fails the build. Raising the
# version means replacing both digests; there is no "latest".
ARG TARGETARCH
ARG K6_VERSION=2.3.0
ARG K6_SHA256_AMD64=39c3117b6af817592dcd0ce4242105c0a7af10948c2a425306f0be8f7a8a8ab1
ARG K6_SHA256_ARM64=5ca3433e8201da72a284aaa241a1bb5fb47f4abb4e384d39410ddd8062f49b90
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) expected="${K6_SHA256_AMD64}" ;; \
    arm64) expected="${K6_SHA256_ARM64}" ;; \
    *) echo "no pinned k6 build for ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  archive="k6-v${K6_VERSION}-linux-${TARGETARCH}"; \
  node -e "fetch(process.argv[1]).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then((b) => require('fs').writeFileSync('/tmp/k6.tar.gz', Buffer.from(b)))" \
    "https://github.com/grafana/k6/releases/download/v${K6_VERSION}/${archive}.tar.gz"; \
  echo "${expected}  /tmp/k6.tar.gz" | sha256sum -c -; \
  tar -xzf /tmp/k6.tar.gz -C /usr/local/bin --strip-components=1 "${archive}/k6"; \
  /usr/local/bin/k6 version


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
COPY --from=k6 /usr/local/bin/k6 /usr/local/bin/k6
# The browsers and their system libraries, from the deployed Playwright so the two versions
# cannot disagree. Installed as root (`--with-deps` uses apt), then handed to `node`.
RUN node node_modules/@playwright/test/cli.js install --with-deps chromium firefox webkit \
  && mkdir -p /var/lib/automate/artifacts \
  && chown -R node:node /var/lib/automate /ms-playwright \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# This image carries Playwright's browsers and k6, so it advertises both; a runner started
# anywhere else keeps the config default and never claims a job whose tool it lacks.
ENV RUNNER_CAPABILITIES=playwright,chromium,k6
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3002/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
