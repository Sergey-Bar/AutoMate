#!/bin/sh
# Automate — start, stop and update a local install.
#
#   ./start.sh                     start (first run creates .env with random secrets)
#   ./start.sh stop                stop the containers; data is kept
#   ./start.sh status              show the containers
#   ./start.sh logs                follow the logs
#   ./start.sh update [--version X]  move to the latest (or a given) release; data is kept
#   ./start.sh uninstall [--purge] remove the containers; --purge also deletes all data
#
# Settings, read from the environment or from .env:
#   AUTOMATE_PORT   the port to open (default 8080)
#   AUTOMATE_BIND   the address to listen on (default 127.0.0.1, this machine only)
set -eu

cd "$(dirname "$0")"

DOCKER="${AUTOMATE_DOCKER:-docker}"
PROJECT="${AUTOMATE_PROJECT:-automate}"
RELEASES_URL="${AUTOMATE_RELEASES_URL:-https://api.github.com/repos/Sergey-Bar/AutoMate/releases/latest}"
READY_TIMEOUT="${AUTOMATE_READY_TIMEOUT:-180}"

say() { printf '%s\n' "$*"; }
fail() { printf 'automate: %s\n' "$*" >&2; exit 1; }

usage() {
  say "Usage: ./start.sh [stop|status|logs|update [--version X]|uninstall [--purge]]"
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
  "$DOCKER" compose -p "$PROJECT" --env-file .env -f compose.yml "$@"
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

warn_if_exposed() {
  bind="$(setting AUTOMATE_BIND 127.0.0.1)"
  case "$bind" in
    127.*|localhost|::1) ;;
    *)
      say ""
      say "WARNING: AUTOMATE_BIND=$bind makes Automate reachable from other machines."
      say "WARNING: The install has no login, so anyone who can reach this port can use it."
      say "WARNING: Unset AUTOMATE_BIND to keep it on this machine only."
      say ""
      ;;
  esac
}

start() {
  require_docker
  ensure_env
  warn_if_exposed
  port="$(setting AUTOMATE_PORT 8080)"
  base="http://localhost:$port"
  say "Downloading the Automate images (the first run takes a few minutes)..."
  # Images already here keep working offline; a tag that is missing still fails in 'up'.
  compose pull --ignore-pull-failures
  compose up -d
  wait_ready "http://127.0.0.1:$port"
  say ""
  say "Automate is running at $base"
  say "Sign in with this key: $(setting AUTOMATE_INSTALLATION_KEY '')"
  say "(it is also in .env as AUTOMATE_INSTALLATION_KEY)"
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
  start) start ;;
  stop) require_docker; compose stop ;;
  status) require_docker; compose ps ;;
  logs) require_docker; compose logs --tail 200 -f ;;
  update) update "$@" ;;
  uninstall) uninstall "$@" ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
