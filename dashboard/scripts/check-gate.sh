#!/usr/bin/env bash
# check-gate.sh — Portable Automate quality gate checker.
#
# Works with any CI system that has bash and curl available.
#
# Usage:
#   bash scripts/check-gate.sh --url <dashboard-url> --run-id <run-id> [options]
#
# Options:
#   --url <url>          Dashboard base URL (e.g. http://localhost:4000)
#   --run-id <id>        Test run ID to check
#   --api-key <key>      Dashboard API key (omit if GATE_PUBLIC=true on server)
#   --wait               Block until the run completes (default: check current status)
#   --timeout <seconds>  Max seconds to wait when --wait is used (default: 300)
#   --quiet              Suppress output, only return exit code
#
# Exit codes:
#   0  Quality gate PASSED
#   1  Quality gate FAILED (or timed out)
#   2  Usage error / unexpected API response
#
# Examples:
#   # Check a completed run (no wait):
#   bash scripts/check-gate.sh --url http://localhost:4000 --run-id abc123 --api-key mysecret
#
#   # Wait for a running test to complete, then check gate:
#   bash scripts/check-gate.sh --url http://localhost:4000 --run-id abc123 --api-key mysecret --wait --timeout 600
#
#   # Check most recent run on main branch (no run ID needed):
#   bash scripts/check-gate.sh --url http://localhost:4000 --api-key mysecret --branch main

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
URL=""
RUN_ID=""
API_KEY="${AUTOMATE_DASHBOARD_API_KEY:-}"
WAIT=false
TIMEOUT=300
QUIET=false
BRANCH=""
WORKSPACE=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)       URL="$2";       shift 2 ;;
    --run-id)    RUN_ID="$2";    shift 2 ;;
    --api-key)   API_KEY="$2";   shift 2 ;;
    --wait)      WAIT=true;      shift   ;;
    --timeout)   TIMEOUT="$2";   shift 2 ;;
    --quiet)     QUIET=true;     shift   ;;
    --branch)    BRANCH="$2";    shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────
if [[ -z "$URL" ]]; then
  echo "Error: --url is required." >&2
  exit 2
fi

# Remove trailing slash from URL
URL="${URL%/}"

# ── Helper: print message unless --quiet ──────────────────────────────────────
log() {
  if [[ "$QUIET" != "true" ]]; then
    echo "$@"
  fi
}

# ── Helper: build Authorization header ───────────────────────────────────────
auth_header() {
  if [[ -n "$API_KEY" ]]; then
    echo "Authorization: Bearer $API_KEY"
  else
    echo ""
  fi
}

# ── Helper: curl with auth ────────────────────────────────────────────────────
api_get() {
  local endpoint="$1"
  local header
  header=$(auth_header)
  if [[ -n "$header" ]]; then
    curl -sf -H "$header" "${URL}${endpoint}"
  else
    curl -sf "${URL}${endpoint}"
  fi
}

api_post() {
  local endpoint="$1"
  local header
  header=$(auth_header)
  if [[ -n "$header" ]]; then
    curl -sf -X POST -H "$header" "${URL}${endpoint}"
  else
    curl -sf -X POST "${URL}${endpoint}"
  fi
}

# ── Main logic ────────────────────────────────────────────────────────────────

# If no run ID given, use /api/ci/gate/latest with optional filters
if [[ -z "$RUN_ID" ]]; then
  QUERY=""
  if [[ -n "$BRANCH" ]]; then
    QUERY="?branch=${BRANCH}"
  fi
  if [[ -n "$WORKSPACE" ]]; then
    SEP="?"
    if [[ -n "$QUERY" ]]; then SEP="&"; fi
    QUERY="${QUERY}${SEP}workspace=${WORKSPACE}"
  fi

  log "Checking latest run gate status${QUERY:+ (${QUERY})}..."
  RESPONSE=$(api_get "/api/ci/gate/latest${QUERY}" 2>&1) || {
    echo "Error: Failed to fetch latest gate status from ${URL}" >&2
    exit 2
  }
else
  # Use wait endpoint or direct endpoint
  if [[ "$WAIT" == "true" ]]; then
    log "Waiting up to ${TIMEOUT}s for run ${RUN_ID} to complete..."
    RESPONSE=$(api_post "/api/ci/gate/wait/${RUN_ID}?timeout=${TIMEOUT}" 2>&1) || {
      HTTP_CODE=$(api_post "/api/ci/gate/wait/${RUN_ID}?timeout=${TIMEOUT}" -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
      if [[ "$HTTP_CODE" == "408" ]]; then
        echo "Error: Timed out waiting for run ${RUN_ID} to complete (${TIMEOUT}s)." >&2
        exit 1
      fi
      echo "Error: Failed to reach Dashboard at ${URL}" >&2
      exit 2
    }
  else
    log "Checking gate status for run ${RUN_ID}..."
    RESPONSE=$(api_get "/api/ci/gate/${RUN_ID}" 2>&1) || {
      echo "Error: Run '${RUN_ID}' not found or Dashboard unreachable at ${URL}" >&2
      exit 2
    }
  fi
fi

# ── Parse response ────────────────────────────────────────────────────────────
# Use python3/python if available for JSON parsing, otherwise grep
parse_json_field() {
  local json="$1"
  local field="$2"
  if command -v python3 &>/dev/null; then
    echo "$json" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('${field}', ''))"
  elif command -v python &>/dev/null; then
    echo "$json" | python -c "import sys, json; d = json.load(sys.stdin); print(d.get('${field}', ''))"
  else
    # Fallback: naive grep (works for simple string/number values)
    echo "$json" | grep -oP "\"${field}\":\\s*\\K[^,}]+" | tr -d '"' | tr -d ' '
  fi
}

EXIT_CODE=$(parse_json_field "$RESPONSE" "exitCode")
GATE_STATUS=$(parse_json_field "$RESPONSE" "gateStatus")
PASS_RATE=$(parse_json_field "$RESPONSE" "passRate")
THRESHOLD=$(parse_json_field "$RESPONSE" "threshold")
FAILED=$(parse_json_field "$RESPONSE" "failedTests")
TOTAL=$(parse_json_field "$RESPONSE" "totalTests")
RUN_ID_OUT=$(parse_json_field "$RESPONSE" "runId")

# ── Report ────────────────────────────────────────────────────────────────────
if [[ "$QUIET" != "true" ]]; then
  echo "──────────────────────────────────────────"
  echo "  Automate — Quality Gate Result"
  echo "──────────────────────────────────────────"
  echo "  Run ID      : ${RUN_ID_OUT}"
  echo "  Status      : ${GATE_STATUS}"
  echo "  Pass rate   : ${PASS_RATE}%  (threshold: ${THRESHOLD}%)"
  echo "  Tests       : ${TOTAL} total, ${FAILED} failed"
  echo "──────────────────────────────────────────"
  if [[ "$EXIT_CODE" == "0" ]]; then
    echo "  ✅ Gate PASSED"
  else
    echo "  ❌ Gate FAILED"
  fi
  echo "──────────────────────────────────────────"
fi

exit "${EXIT_CODE:-1}"
