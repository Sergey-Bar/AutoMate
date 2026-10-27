#!/bin/sh
# Automate — start, stop and update a local install.
#
#   ./start.sh                     start (first run creates .env with random secrets)
#   ./start.sh --profile NAME      start, recording the deployment profile in .env
#   ./start.sh --remote cloudflare start, and reach it from anywhere through Cloudflare Tunnel
#   ./start.sh stop                stop the containers; data is kept
#   ./start.sh status              show the containers
#   ./start.sh logs                follow the logs
#   ./start.sh update [--version X]  move to the latest (or a given) release; data is kept
#   ./start.sh uninstall [--purge] remove the containers; --purge also deletes all data
#   ./start.sh backup              write the database, artifacts and secrets to backups/
#   ./start.sh restore FOLDER      check a backup, then replace this install's data with it
#
# Settings, read from the environment or from .env:
#   AUTOMATE_PROFILE   solo (default: this machine, no login), startup, team or enterprise
#   AUTOMATE_PORT      the port to open (default 8080)
#   AUTOMATE_BIND      the address to listen on (default 127.0.0.1, this machine only)
#   AUTOMATE_LAN_MODE  1 to serve other machines on your network, with sign-in required
set -eu

cd "$(dirname "$0")"

DOCKER="${AUTOMATE_DOCKER:-docker}"
PROJECT="${AUTOMATE_PROJECT:-automate}"
RELEASES_URL="${AUTOMATE_RELEASES_URL:-https://api.github.com/repos/Sergey-Bar/AutoMate/releases/latest}"
READY_TIMEOUT="${AUTOMATE_READY_TIMEOUT:-180}"

say() { printf '%s\n' "$*"; }
fail() { printf 'automate: %s\n' "$*" >&2; exit 1; }

usage() {
  say "Usage: ./start.sh [--profile solo|startup|team|enterprise] [--remote cloudflare] | stop|status|logs|update [--version X]|uninstall [--purge]|lan-cert|backup|restore FOLDER"
}

# Docker, running, with Compose v2 — each missing piece named, with what to do about it.
require_docker() {
  command -v "$DOCKER" >/dev/null 2>&1 \
    || fail "Docker is not installed. Install Docker Desktop (or Docker Engine) from https://docs.docker.com/get-docker/ and run this again."
  "$DOCKER" info >/dev/null 2>&1 \
    || fail "Docker is not running. Start Docker Desktop (or the Docker service) and run this again."
  "$DOCKER" compose version >/dev/null 2>&1 \
    || fail "Docker Compose v2 is required ('docker compose'). Update Docker Desktop, or install the compose plugin."
}

# 48 hex characters: over the 32-character floor every secret has.
secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

access_key() {
  printf 'AK%s' "$(secret | cut -c1-18 | tr 'a-f' 'A-F')"
}

# Written once. A second run never overwrites it: the secrets sign sessions and encrypt
# the vault, so new values would lock the install out of its own data.
ensure_env() {
  [ -f .env ] && return 0
  umask 077
  {
    say "# Created by start.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep it: the secrets below"
    say "# sign sessions and encrypt stored credentials."
    say "POSTGRES_PASSWORD=$(secret)"
    say "COOKIE_SECRET=$(secret)"
    say "VAULT_SECRET=$(secret)"
    say "AUTOMATE_API_KEY=$(secret)"
    say "AUTOMATE_INSTALLATION_KEY=$(secret)"
    say "REPORTER_SECRET=$(secret)"
    say "RUNNER_REGISTRATION_SECRET=$(secret)"
    say "OBJECT_STORE_BUCKET=automate-artifacts"
    say "OBJECT_STORE_REGION=us-east-1"
    say "OBJECT_STORE_ACCESS_KEY_ID=$(access_key)"
    say "OBJECT_STORE_SECRET_ACCESS_KEY=$(secret)"
  } > .env
  say "Created .env with new random secrets."
}

# A value from the environment first, then .env, then the default.
setting() {
  name="$1"
  default="$2"
  value="$(printenv "$name" 2>/dev/null || true)"
  if [ -z "$value" ] && [ -f .env ]; then
    value="$(sed -n "s/^$name=//p" .env | tail -n 1)"
  fi
  printf '%s' "${value:-$default}"
}

compose() {
  # The tunnel's profile, when this install is remote, so start/stop/status include it.
  if [ "$(setting AUTOMATE_REMOTE '')" = cloudflare ]; then
    "$DOCKER" compose -p "$PROJECT" --env-file .env -f compose.yml --profile cloudflare "$@"
  else
    "$DOCKER" compose -p "$PROJECT" --env-file .env -f compose.yml "$@"
  fi
}

# Sets NAME=VALUE in .env, replacing the line that is there. Written without sed so a value
# carrying `/`, `&` or `=` — a tunnel token does — is kept exactly.
set_env_value() {
  grep -v "^$1=" .env > .env.tmp || true
  printf '%s=%s\n' "$1" "$2" >> .env.tmp
  mv .env.tmp .env
}

# `--remote cloudflare`: the three values a tunnel needs, from the environment or .env, kept
# in .env so the next plain start still has them. The token is never printed.
set_remote() {
  [ "$1" = cloudflare ] || fail "--remote takes one value: cloudflare."
  missing=""
  for name in TUNNEL_TOKEN CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD; do
    [ -n "$(setting "$name" '')" ] || missing="$missing $name"
  done
  [ -z "$missing" ] || fail "--remote cloudflare needs${missing}. Create a tunnel and an Access application in the Cloudflare Zero Trust dashboard, then set them (see the remote access guide)."
  for name in TUNNEL_TOKEN CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD; do
    value="$(setting "$name" '')"
    grep -q "^$name=" .env && [ "$(sed -n "s/^$name=//p" .env | tail -n 1)" = "$value" ] \
      || set_env_value "$name" "$value"
  done
  set_env_value AUTOMATE_REMOTE cloudflare
}

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null "$1" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "$1" 2>/dev/null
  else
    return 2
  fi
}

wait_ready() {
  url="$1/api/v1/ready"
  say "Waiting for Automate to be ready (up to ${READY_TIMEOUT}s)..."
  elapsed=0
  while [ "$elapsed" -lt "$READY_TIMEOUT" ]; do
    if http_ok "$url"; then return 0; fi
    [ $? -eq 2 ] && { say "Neither curl nor wget is installed, so readiness cannot be checked."; return 0; }
    sleep 2
    elapsed=$((elapsed + 2))
  done
  fail "Automate did not become ready in ${READY_TIMEOUT}s. Run './start.sh logs' to see why."
}

open_browser() {
  [ "${AUTOMATE_NO_BROWSER:-}" = "1" ] && return 0
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  fi
}

is_loopback() {
  case "$1" in
    127.*|localhost|::1|'[::1]') return 0 ;;
    *) return 1 ;;
  esac
}

lan_mode() {
  case "$(setting AUTOMATE_LAN_MODE '')" in
    1|true|yes) return 0 ;;
    *) return 1 ;;
  esac
}

# The deployment profile (ADR-014): solo, startup, team or enterprise. Empty is unset, which
# the API reads as solo, or as startup when LAN mode is on.
profile() {
  setting AUTOMATE_PROFILE ''
}

check_profile_name() {
  case "$1" in
    ''|solo|startup|team|enterprise) return 0 ;;
    *) fail "AUTOMATE_PROFILE=$1 is not a profile. Use solo, startup, team or enterprise." ;;
  esac
}

# What to do next, per profile. Printed after a start so the first run ends with an action.
next_step() {
  case "$1" in
    startup) say "Next step: sign in with the key below, then pair devices or issue access tokens on the Access page." ;;
    team|enterprise) say "Next step: sign in with the key below, then open Map > Deployment to see what this profile turns on." ;;
    *) say "Next step: open a project, or send test results from CI with the automate CLI." ;;
  esac
}

# Writes AUTOMATE_PROFILE into .env, replacing the line that is there. Nothing else in .env
# is touched: the secrets in it sign sessions and encrypt the vault.
set_profile() {
  check_profile_name "$1"
  [ -n "$1" ] || fail "--profile needs a value: solo, startup, team or enterprise."
  if grep -q '^AUTOMATE_PROFILE=' .env; then
    sed "s/^AUTOMATE_PROFILE=.*/AUTOMATE_PROFILE=$1/" .env > .env.tmp && mv .env.tmp .env
  else
    printf 'AUTOMATE_PROFILE=%s\n' "$1" >> .env
  fi
}

# A reachable install with no login is refused, not warned about. The API refuses the same
# bind at startup (apps/api/src/startup-policy.ts); saying it here means the operator reads
# it at the prompt, before anything is downloaded.
check_exposure() {
  bind="$(setting AUTOMATE_BIND 127.0.0.1)"
  chosen="$(profile)"
  check_profile_name "$chosen"
  if [ "$chosen" = solo ] && lan_mode; then
    fail "AUTOMATE_PROFILE=solo keeps Automate on this machine, and AUTOMATE_LAN_MODE is on. Set AUTOMATE_PROFILE=startup to serve other people with sign-in."
  fi
  is_loopback "$bind" && return 0
  if [ "$chosen" = solo ]; then
    fail "AUTOMATE_PROFILE=solo keeps Automate on this machine, and AUTOMATE_BIND=$bind would make it reachable. Set AUTOMATE_PROFILE=startup to serve other people with sign-in, or unset AUTOMATE_BIND."
  fi
  if ! lan_mode && [ -z "$chosen" ]; then
    fail "AUTOMATE_BIND=$bind would make Automate reachable from other machines with no login. Set AUTOMATE_LAN_MODE=1 (or AUTOMATE_PROFILE=startup) to serve your network with sign-in and device pairing, or unset AUTOMATE_BIND to keep it on this machine."
  fi
  port="$(setting AUTOMATE_PORT 8080)"
  say ""
  if lan_mode; then
    say "LAN mode: other machines on your network can reach Automate on port $port, after signing in."
  else
    say "Profile $chosen: other machines can reach Automate on port $port, after signing in."
  fi
  say "If they cannot connect, allow the port through this machine's firewall (not done for you):"
  say "  ufw:       sudo ufw allow $port/tcp"
  say "  firewalld: sudo firewall-cmd --add-port=$port/tcp --permanent && sudo firewall-cmd --reload"
  say "  macOS:     System Settings > Network > Firewall > allow incoming connections for Docker"
  say ""
}

start() {
  require_docker
  ensure_env
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) set_profile "${2:-}"; shift 2 || shift ;;
      --profile=*) set_profile "${1#--profile=}"; shift ;;
      --remote) remote_wanted="${2:-}"; shift 2 || shift ;;
      --remote=*) remote_wanted="${1#--remote=}"; shift ;;
      *) usage; exit 2 ;;
    esac
  done
  # After the profile, so `--profile solo --remote cloudflare` is refused by name below.
  if [ -n "${remote_wanted:-}" ]; then
    [ "$(profile)" = solo ] && fail "AUTOMATE_PROFILE=solo keeps Automate on this machine, and --remote cloudflare publishes it through a tunnel. Use --profile startup (or larger)."
    set_remote "$remote_wanted"
  fi
  check_exposure
  port="$(setting AUTOMATE_PORT 8080)"
  base="http://localhost:$port"
  say "Downloading the Automate images (the first run takes a few minutes)..."
  # Images already here keep working offline; a tag that is missing still fails in 'up'.
  compose pull --ignore-pull-failures
  compose up -d
  wait_ready "http://127.0.0.1:$port"
  chosen="$(profile)"
  say ""
  say "Automate is running at $base"
  say "Profile: ${chosen:-solo}"
  if [ "$(setting AUTOMATE_REMOTE '')" = cloudflare ]; then
    say "Remote: through Cloudflare Tunnel, at the public hostname you gave the tunnel. Cloudflare Access decides who reaches it."
  fi
  say "Sign in with this key: $(setting AUTOMATE_INSTALLATION_KEY '')"
  say "(it is also in .env as AUTOMATE_INSTALLATION_KEY)"
  next_step "$chosen"
  open_browser "$base"
}

latest_version() {
  if command -v curl >/dev/null 2>&1; then body="$(curl -fsSL "$RELEASES_URL")"
  elif command -v wget >/dev/null 2>&1; then body="$(wget -q -O - "$RELEASES_URL")"
  else fail "curl or wget is needed to find the latest release. Use: ./start.sh update --version X"
  fi
  printf '%s' "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1
}

set_version() {
  if grep -q '^AUTOMATE_VERSION=' .env; then
    sed "s/^AUTOMATE_VERSION=.*/AUTOMATE_VERSION=$1/" .env > .env.tmp && mv .env.tmp .env
  else
    printf 'AUTOMATE_VERSION=%s\n' "$1" >> .env
  fi
}

update() {
  version=""
  if [ "${1:-}" = "--version" ]; then version="${2:-}"; fi
  [ -n "$version" ] || version="$(latest_version)"
  [ -n "$version" ] || fail "Could not read the latest release version. Use: ./start.sh update --version X"
  require_docker
  ensure_env
  set_version "$version"
  say "Updating to Automate $version. Your data is kept; migrations run on start."
  start
}

# Every name and address this machine answers to on the network, comma-separated, for the
# certificate's subjectAltName. AUTOMATE_TLS_NAMES adds more (a DNS name your router hands
# out, a second interface).
lan_names() {
  host="$(hostname 2>/dev/null || printf 'automate')"
  ips="$( { hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true; } | tr ' \n' ',,')"
  printf '%s' "automate.local,$host,$host.local,localhost,127.0.0.1,$ips,$(setting AUTOMATE_TLS_NAMES '')" \
    | tr -s ',' | sed 's/^,//; s/,$//'
}

lan_cert() {
  require_docker
  ensure_env
  mkdir -p certs
  names="$(lan_names)"
  say "Issuing a LAN certificate for: $names"
  compose run --rm --no-deps --user 0 --entrypoint automate-lan-cert edge "$names"
  say ""
  say "Done. Trust certs/ca.crt once on each device that opens Automate, then restart:"
  say "  ./start.sh stop && ./start.sh"
  say "How to trust it on Windows, macOS, Linux, iPhone and Android: docs on LAN mode."
}

# A file's sha256, lowercase hex. sha256sum on Linux and Git for Windows, shasum on macOS.
# Read from stdin: given a name with a backslash in it, sha256sum escapes the name and
# prefixes the digest with one.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1" | cut -d' ' -f1
  else shasum -a 256 < "$1" | cut -d' ' -f1
  fi
}

# A string's sha256. Used for the vault key, so a backup can say which key it needs
# without holding the key in its manifest.
sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | cut -d' ' -f1
  else printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  fi
}

# How many migrations the database has applied: the schema a backup was taken at.
migration_count() {
  compose exec -T postgres psql -U automate -d automate -tAc \
    'SELECT count(*) FROM drizzle.__drizzle_migrations' 2>/dev/null | tr -d '[:space:]'
}

# Whether dotted version $1 is newer than $2. A pre-release suffix is ignored.
version_newer() {
  awk -v a="${1%%-*}" -v b="${2%%-*}" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, "."); k = n > m ? n : m
    for (i = 1; i <= k; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 1
  }'
}

manifest_value() {
  sed -n "s/^$2=//p" "$1/manifest.env" | tail -n 1
}

# The database, the stored artifacts and .env, each with a digest, into backups/. The
# database is dumped consistently by pg_dump; artifact bytes are written once and never
# changed, so a copy taken while the install runs is whole for every finished upload.
backup() {
  [ -f .env ] || fail "There is nothing to back up yet: no .env here. Run ./start.sh first."
  require_docker
  count="$(migration_count)"
  case "$count" in
    ''|*[!0-9]*) fail "Could not read the database's migrations. Is Automate running? (./start.sh status)" ;;
  esac
  umask 077
  folder="backups/automate-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$folder"
  say "Backing up the database..."
  compose exec -T postgres pg_dump -U automate -d automate -Fc -f /tmp/automate-backup.dump
  compose cp postgres:/tmp/automate-backup.dump "$folder/database.dump"
  compose exec -T postgres rm -f /tmp/automate-backup.dump
  say "Backing up stored artifacts..."
  compose exec -T objectstore tar -C /data -cf /tmp/automate-objects.tar .
  compose cp objectstore:/tmp/automate-objects.tar "$folder/objects.tar"
  compose exec -T objectstore rm -f /tmp/automate-objects.tar
  cp .env "$folder/env"
  for part in database.dump objects.tar env; do
    printf '%s  %s\n' "$(sha256_of "$folder/$part")" "$part"
  done > "$folder/SHA256SUMS"
  {
    say "format=1"
    say "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    say "version=$(setting AUTOMATE_VERSION '')"
    say "migrations=$count"
    say "vault=$(sha256_text "$(setting VAULT_SECRET '')")"
  } > "$folder/manifest.env"
  say "Backup written to $folder"
  say "It holds your secrets (the env file): store it like a password, and off this machine."
}

# Checks everything before it changes anything: every digest, the vault key, the release
# and the schema. Then the install stops, the data is replaced, and it starts again.
restore() {
  folder="${1:-}"
  { [ -n "$folder" ] && [ -f "$folder/manifest.env" ] && [ -f "$folder/SHA256SUMS" ]; } \
    || fail "There is no backup at '$folder'. Pass the folder './start.sh backup' wrote, like backups/automate-20261027T120000Z."
  [ -f .env ] || fail "Restore into an install: copy $folder/env to .env, then run this again."
  [ "$(manifest_value "$folder" format)" = 1 ] \
    || fail "$folder was written by a newer start script. Update first: ./start.sh update"
  for part in database.dump objects.tar env; do
    expected="$(sed -n "s/^\([0-9a-f]*\)  $part\$/\1/p" "$folder/SHA256SUMS")"
    [ -f "$folder/$part" ] || fail "$folder/$part is missing. Nothing was restored."
    [ -n "$expected" ] && [ "$(sha256_of "$folder/$part")" = "$expected" ] \
      || fail "$folder/$part does not match its digest in SHA256SUMS: the backup is damaged. Nothing was restored."
  done
  [ "$(manifest_value "$folder" vault)" = "$(sha256_text "$(setting VAULT_SECRET '')")" ] \
    || fail "This backup was made with a different VAULT_SECRET, so the credentials stored in it could not be read. Keep a copy of .env, copy $folder/env over it, then run the restore again."
  taken="$(manifest_value "$folder" version)"
  current="$(setting AUTOMATE_VERSION '')"
  if [ -n "$taken" ] && [ -n "$current" ] && version_newer "$taken" "$current"; then
    fail "This backup is from Automate $taken, which is newer than this install ($current). Update first: ./start.sh update --version $taken"
  fi
  require_docker
  wanted="$(manifest_value "$folder" migrations)"
  have="$(migration_count)"
  case "$wanted" in ''|*[!0-9]*) fail "$folder/manifest.env records no migration count. Nothing was restored." ;; esac
  case "$have" in
    ''|*[!0-9]*) fail "Could not read this install's migrations. Start Automate first (./start.sh), then restore." ;;
  esac
  [ "$wanted" -le "$have" ] \
    || fail "This backup has $wanted migrations and this install has $have: its schema is newer. Update first: ./start.sh update"
  say "Restoring $folder. Automate stops while it runs."
  compose stop api worker runner web edge objectstore
  compose cp "$folder/database.dump" postgres:/tmp/automate-restore.dump
  # One transaction: a restore that fails part-way leaves the database as it was.
  compose exec -T postgres pg_restore -U automate -d automate --clean --if-exists --no-owner \
    --single-transaction /tmp/automate-restore.dump
  compose exec -T postgres rm -f /tmp/automate-restore.dump
  compose run --rm --no-deps -T -v "$(cd "$folder" && pwd):/backup:ro" --entrypoint sh objectstore \
    -c 'find /data -mindepth 1 -delete && tar -C /data -xf /backup/objects.tar'
  compose up -d
  port="$(setting AUTOMATE_PORT 8080)"
  wait_ready "http://127.0.0.1:$port"
  say "Restored $folder. Migrations newer than the backup ran on start."
}

uninstall() {
  require_docker
  [ -f .env ] || : > .env
  if [ "${1:-}" = "--purge" ]; then
    compose down -v --remove-orphans
    rm -f .env
    say "Automate is removed, with all of its data."
  else
    compose down --remove-orphans
    say "Automate is removed. Your data and .env are kept; run ./start.sh to start again."
  fi
}

command="${1:-start}"
[ $# -gt 0 ] && shift
case "$command" in
  start) start "$@" ;;
  --profile|--profile=*|--remote|--remote=*) start "$command" "$@" ;;
  stop) require_docker; compose stop ;;
  status) require_docker; compose ps ;;
  logs) require_docker; compose logs --tail 200 -f ;;
  update) update "$@" ;;
  uninstall) uninstall "$@" ;;
  lan-cert) lan_cert ;;
  backup) backup ;;
  restore) restore "$@" ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
