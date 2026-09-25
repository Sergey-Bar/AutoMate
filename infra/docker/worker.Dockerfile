FROM node:24.21.0-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @automate/config build \
  && pnpm --filter @automate/db build \
  && pnpm --filter @automate/worker build
ENV NODE_ENV=production
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/worker/dist/main.js"]
