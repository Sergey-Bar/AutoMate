#!/bin/bash
# SQLite VACUUM script for Automate
set -euo pipefail

DB_PATH="${DATA_DIR:-./data}/automate.db"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found at $DB_PATH"
  exit 0
fi

echo "Running VACUUM on $DB_PATH..."
sqlite3 "$DB_PATH" "VACUUM;"
echo "VACUUM complete"
