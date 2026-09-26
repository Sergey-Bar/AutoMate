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
# Unprivileged nginx: the stock image runs as root and writes to
# /var/cache/nginx, /var/run and the pid file. Running as `nginx` with the
# listen port moved to 8080 means the process needs no capabilities at all.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d \
  && sed -i 's|pid /var/run/nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
# 8080, not 80: binding a port below 1024 is the only reason the stock image runs
# as root, and dropping to `nginx` removes the reason entirely.
EXPOSE 8080
USER nginx
