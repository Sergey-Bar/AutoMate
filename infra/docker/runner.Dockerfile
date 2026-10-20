FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# pnpm is not named here: Corepack reads `packageManager` from package.json, so the image uses the
# same pnpm the repository does. A pin written in this file went stale (it said 10.30.2 while the
# repository moved to 11) and was a second place to keep in step.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@automate/runner..." build \
  && pnpm --filter @automate/runner exec playwright install --with-deps chromium firefox webkit \
  && mkdir -p /var/lib/automate/artifacts \
  && chown -R node:node /app /var/lib/automate /ms-playwright
ENV NODE_ENV=production
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3002/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/runner/dist/main.js"]
