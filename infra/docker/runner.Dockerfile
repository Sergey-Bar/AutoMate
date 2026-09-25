FROM node:22.19.0-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @automate/shared-contracts build \
  && pnpm --filter @automate/runner-sdk build \
  && pnpm --filter @automate/runner build
USER node
ENTRYPOINT ["node", "apps/runner/dist/main.js"]
