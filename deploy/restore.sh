#!/usr/bin/env bash
# Restore a backup made by backup.sh.   ./deploy/restore.sh backups/hcis-20261005-0200
# WARNING: replaces the current database and uploaded files.
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -eq 1 ] || { echo "pemakaian: $0 backups/hcis-YYYYmmdd-HHMM"; exit 1; }
BASE="$1"; [ -f "$BASE.sql.gz" ] || { echo "$BASE.sql.gz tidak ada"; exit 1; }
set -a; source .env.prod; set +a
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
read -r -p "Ini MENIMPA database & file saat ini. Ketik 'ya' untuk lanjut: " ok; [ "$ok" = "ya" ] || exit 1
$DC stop backend
$DC exec -T postgres psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" -c "CREATE DATABASE \"$DB_NAME\";"
gunzip -c "$BASE.sql.gz" | $DC exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" >/dev/null
if [ -f "$BASE.uploads.tgz" ]; then $DC run --rm --no-deps -T backend sh -c 'rm -rf /data/uploads/* ' || true; cat "$BASE.uploads.tgz" | $DC run --rm --no-deps -T backend tar -C /data -xzf - ; fi
$DC start backend
echo "restore selesai"
