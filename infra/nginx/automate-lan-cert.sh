#!/bin/sh
# Issues the LAN certificate: a local certificate authority, once, and a server certificate
# signed by it for every name and address this machine answers to.
#
#   automate-lan-cert <name-or-ip>[,<name-or-ip>...]
#
# Run by `start lan-cert` inside the edge image, as root, with the host's certificate
# directory mounted at $CERT_DIR. Each device trusts ca.crt once; the server certificate can
# then be reissued (a new IP, a new hostname) without touching any device again, which is
# why an existing CA is kept unless AUTOMATE_NEW_CA=1.
set -eu

CERT_DIR="${AUTOMATE_CERT_DIR:-/etc/automate/certs}"
NAMES="${1:-}"
[ -n "$NAMES" ] || { echo "usage: automate-lan-cert <name-or-ip>[,...]" >&2; exit 2; }

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

if [ ! -f "$CERT_DIR/ca.key" ] || [ "${AUTOMATE_NEW_CA:-}" = "1" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 \
    -days 3650 -subj "/CN=Automate local CA ($(hostname))" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout ca.key -out ca.crt
  echo "Created a new local certificate authority: ca.crt (trust it once on each device)"
fi

# subjectAltName: an IP literal is IP:, everything else DNS:.
san=""
first=""
for entry in $(printf '%s' "$NAMES" | tr ',' ' '); do
  [ -n "$first" ] || first="$entry"
  case "$entry" in
    *[!0-9.]*) kind=DNS ;;
    *) kind=IP ;;
  esac
  case "$entry" in *:*) kind=IP ;; esac
  san="${san:+$san,}$kind:$entry"
done

cat >server.ext <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF

openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 \
  -subj "/CN=$first" -keyout server.key -out server.csr
# 825 days: Apple devices refuse a TLS leaf valid for longer.
openssl x509 -req -sha256 -days 825 -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -extfile server.ext -out server.crt
rm -f server.csr server.ext

# nginx runs as uid 101 in the edge image and must read the leaf key; nobody else may.
chown 101:101 server.key server.crt
chmod 640 server.key
chmod 644 server.crt ca.crt
chmod 600 "$CERT_DIR/ca.key"

echo "Issued server.crt for: $san"
