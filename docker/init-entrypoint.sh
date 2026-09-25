#!/bin/sh
set -e

DASHBOARD_URL="${DASHBOARD_INTERNAL_URL:-http://dashboard:4000}"
INIT_FLAG="/data/.initialized"

echo "================================================"
echo "  Automate Platform - First Boot Check"
echo "================================================"

# Wait for Dashboard to be healthy
echo "Waiting for Dashboard to be ready..."
for i in $(seq 1 30); do
  if wget -q -O /dev/null "$DASHBOARD_URL/health/live" 2>/dev/null; then
    echo "Dashboard is ready."
    break
  fi
  if [ "$i" = "30" ]; then
    echo "ERROR: Dashboard did not become ready in 30s"
    exit 1
  fi
  sleep 1
done

# Wait for Automate to be healthy
AUTOMATE_URL="${AUTOMATE_INTERNAL_URL:-http://automate:3000}"
echo "Waiting for Automate to be ready..."
for i in $(seq 1 30); do
  if wget -q -O /dev/null "$AUTOMATE_URL/health" 2>/dev/null; then
    echo "Automate is ready."
    break
  fi
  if [ "$i" = "30" ]; then
    echo "ERROR: Automate did not become ready in 30s"
    exit 1
  fi
  sleep 1
done

# Check if already initialized
if [ -f "$INIT_FLAG" ]; then
  echo ""
  echo "System already initialized. Skipping bootstrap."
  echo "Visit http://localhost to access Automate."
  echo "================================================"
  exit 0
fi

# Try to bootstrap (generate first API key)
echo ""
echo "First boot detected. Generating initial API key..."
RESPONSE=$(wget -q -O - --post-data='{}' \
  --header='Content-Type: application/json' \
  "$DASHBOARD_URL/api/auth/bootstrap" 2>&1) || true

# Parse response
if echo "$RESPONSE" | grep -q '"apiKey"'; then
  API_KEY=$(echo "$RESPONSE" | sed 's/.*"apiKey":"\([^"]*\)".*/\1/')

  # Mark as initialized
  touch "$INIT_FLAG"

  echo ""
  echo "================================================"
  echo "  Automate Platform Initialized!"
  echo "================================================"
  echo ""
  echo "  Your API Key: $API_KEY"
  echo ""
  echo "  Save this key! You'll need it to log in."
  echo ""
  echo "  Access the platform at: http://localhost"
  echo ""
  echo "  Add to your playwright.config.ts:"
  echo "    reporter: [['automate', {"
  echo "      serverUrl: 'http://localhost:4001',"
  echo "      apiKey: '$API_KEY'"
  echo "    }]]"
  echo ""
  echo "================================================"
elif echo "$RESPONSE" | grep -q '"already initialized"' || echo "$RESPONSE" | grep -q '409'; then
  touch "$INIT_FLAG"
  echo "System was already initialized (409). Skipping."
  echo "Visit http://localhost to access Automate."
else
  echo "WARNING: Bootstrap failed. Response: $RESPONSE"
  echo "You can manually set up via the onboarding wizard at http://localhost"
  echo "Or try: curl -X POST http://localhost/api/auth/bootstrap"
fi

echo "================================================"
