#!/bin/bash
# SQLite backup script for Automate
set -euo pipefail

MAIN_DB="${AUTOMATE_DB_PATH:-./apps/server/data/automate.db}"
VAULT_DB="${VAULT_DB_PATH:-./.automate-vault.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

if [ -f "$MAIN_DB" ]; then
  sqlite3 "$MAIN_DB" ".backup '${BACKUP_DIR}/automate-${TIMESTAMP}.db'"
  echo "Main DB backed up"
fi

if [ -f "$VAULT_DB" ]; then
  sqlite3 "$VAULT_DB" ".backup '${BACKUP_DIR}/vault-${TIMESTAMP}.db'"
  echo "Vault DB backed up"
fi

# Keep last 7 backups
ls -t "${BACKUP_DIR}/automate-*.db" 2>/dev/null | tail -n +8 | xargs -r rm --
ls -t "${BACKUP_DIR}/vault-*.db" 2>/dev/null | tail -n +8 | xargs -r rm --
echo "Backup complete"
