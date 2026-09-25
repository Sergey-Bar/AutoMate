FROM node:22.19.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @automate/shared-contracts build \
  && pnpm --filter @automate/config build \
  && pnpm --filter @automate/auth build \
  && pnpm --filter @automate/db build \
  && pnpm --filter @automate/reporting build \
  && pnpm --filter @automate/reporter build \
  && pnpm --filter @automate/realtime build \
  && pnpm --filter @automate/api build

FROM node:22.19.0-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY --from=build /app ./
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
