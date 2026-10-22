FROM nginx:1.27-alpine
ARG AUTOMATE_VERSION=dev
ARG AUTOMATE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/AutoMate" \
  org.opencontainers.image.title="automate-edge" \
  org.opencontainers.image.version="${AUTOMATE_VERSION}" \
  org.opencontainers.image.revision="${AUTOMATE_REVISION}"
# Unprivileged, on 8080, for the same reasons as web.Dockerfile: the stock image
# runs as root only because it binds 80, and the only capability it needs
# afterwards is none.
# The pid line is matched by shape and then checked: nginx 1.27 writes `/run/nginx.pid`, the
# old literal `/var/run/nginx.pid` matched nothing, and a read-only container then failed to
# start (ledger MNT-23). `grep -q` fails the build if the rewrite ever stops matching.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d \
  && sed -i -E 's|^pid[[:space:]]+[^;]+;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && grep -q '^pid /tmp/nginx.pid;' /etc/nginx/nginx.conf
COPY infra/nginx/edge.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER nginx
