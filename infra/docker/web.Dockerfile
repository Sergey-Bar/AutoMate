FROM node:24.21.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @automate/shared-contracts build \
  && pnpm --filter @automate/realtime build \
  && pnpm --filter @automate/ui build \
  && pnpm --filter @automate/unified-web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
