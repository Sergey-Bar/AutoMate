FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
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
# `openssl` is the certificate CLI `start lan-cert` runs in this image; nginx itself links
# libssl and needs nothing more.
RUN apk add --no-cache openssl \
  && chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d \
  && sed -i -E 's|^pid[[:space:]]+[^;]+;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && grep -q '^pid /tmp/nginx.pid;' /etc/nginx/nginx.conf
COPY infra/nginx/edge.conf /etc/nginx/conf.d/default.conf
# HTTPS when a LAN certificate is mounted (see the script), and the CLI that issues one.
COPY infra/nginx/40-automate-tls.sh /docker-entrypoint.d/40-automate-tls.sh
COPY infra/nginx/automate-lan-cert.sh /usr/local/bin/automate-lan-cert
RUN chmod 0755 /docker-entrypoint.d/40-automate-tls.sh /usr/local/bin/automate-lan-cert
EXPOSE 8080 8443
USER nginx
