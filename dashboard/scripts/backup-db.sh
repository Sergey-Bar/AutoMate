#!/bin/bash
# SQLite backup script for Automate
set -euo pipefail

DB_PATH="${DATA_DIR:-./data}/automate.db"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/automate-${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found at $DB_PATH"
  exit 1
fi

sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"
echo "Backup created: $BACKUP_FILE"

# Keep only last 7 backups
ls -t "${BACKUP_DIR}/automate-*.db" 2>/dev/null | tail -n +8 | xargs -r rm --
echo "Cleanup complete"
