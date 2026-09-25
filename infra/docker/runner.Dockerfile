FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @automate/config build \
  && pnpm --filter @automate/shared-contracts build \
  && pnpm --filter @automate/runner-sdk build \
  && pnpm --filter @automate/runner build \
  && pnpm --filter @automate/runner exec playwright install --with-deps chromium firefox webkit \
  && mkdir -p /var/lib/automate/artifacts \
  && chown -R node:node /app /var/lib/automate /ms-playwright
ENV NODE_ENV=production
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3002/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/runner/dist/main.js"]
