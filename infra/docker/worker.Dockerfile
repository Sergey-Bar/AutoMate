FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /src
# Corepack reads `packageManager` from package.json, so the image uses the repository's pnpm.
RUN corepack enable
COPY . .
# Build the worker and its workspace dependencies, then write only what it runs to /out
# (`deploy --prod`; see api.Dockerfile).
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@automate/worker..." build \
  && pnpm --filter "@automate/worker" --prod deploy --legacy /out


FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
ARG AUTOMATE_VERSION=dev
ARG AUTOMATE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/AutoMate" \
  org.opencontainers.image.title="automate-worker" \
  org.opencontainers.image.version="${AUTOMATE_VERSION}" \
  org.opencontainers.image.revision="${AUTOMATE_REVISION}"
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
# The artifact volume mounts here and must be writable by `node`.
RUN mkdir -p /var/lib/automate/artifacts \
  && chown -R node:node /var/lib/automate
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
