#!/bin/sh
# HTTPS for a LAN install, switched on by the presence of a certificate.
#
# The official nginx image runs every script in /docker-entrypoint.d/ before nginx starts.
# The container's root filesystem is read-only, so this writes its two includes into the
# /tmp tmpfs, where infra/nginx/edge.conf reads them:
#
#   /tmp/automate/tls-server.conf     the 8443 server, proxying exactly as the 8080 one
#   /tmp/automate/http-redirect.conf  plain HTTP -> HTTPS, except the container healthcheck
#
# With no certificate mounted neither file exists, edge.conf's includes match nothing, and
# the edge is the plain-HTTP proxy it always was. `start lan-cert` creates the certificate.
set -eu

CERT_DIR="${AUTOMATE_CERT_DIR:-/etc/automate/certs}"
OUT=/tmp/automate
HTTPS_PORT="${AUTOMATE_HTTPS_PORT:-8443}"

mkdir -p "$OUT"
rm -f "$OUT/tls-server.conf" "$OUT/http-redirect.conf"

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
  cat >"$OUT/http-redirect.conf" <<EOF
if (\$uri != /edge-health) {
  return 308 https://\$host:${HTTPS_PORT}\$request_uri;
}
EOF
  cat >"$OUT/tls-server.conf" <<EOF
server {
  listen 8443 ssl;
  http2 on;
  server_name _;
  server_tokens off;

  ssl_certificate ${CERT_DIR}/server.crt;
  ssl_certificate_key ${CERT_DIR}/server.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:automate_tls:1m;
  ssl_session_timeout 1h;

  # One year, this host only. Not preload: a LAN name is not a public domain.
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Content-Security-Policy "frame-ancestors 'none'" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header X-Frame-Options "DENY" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

  client_max_body_size 96m;

  location /api/ {
    proxy_pass http://automate_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }

  location /scim/v2/ {
    proxy_pass http://automate_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host \$http_host;
  }

  location / {
    proxy_pass http://automate_web;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host \$http_host;
  }
}
EOF
  echo "automate-edge: HTTPS on 8443 (published as ${HTTPS_PORT}); plain HTTP redirects to it"
else
  echo "automate-edge: no LAN certificate in ${CERT_DIR}; serving plain HTTP only"
fi
