#!/bin/bash
# SQLite VACUUM script for Automate
set -euo pipefail

MAIN_DB="${AUTOMATE_DB_PATH:-./apps/server/data/automate.db}"
VAULT_DB="${VAULT_DB_PATH:-./.automate-vault.db}"

for DB_PATH in "$MAIN_DB" "$VAULT_DB"; do
  if [ -f "$DB_PATH" ]; then
    echo "Running VACUUM on $DB_PATH..."
    sqlite3 "$DB_PATH" "VACUUM;"
    echo "VACUUM complete for $DB_PATH"
  else
    echo "Database not found at $DB_PATH — skipping"
  fi
done
