#!/usr/bin/env bash
# Daily backup of the database and uploaded files. Run from the project folder (see docs/DEPLOY.md → Backup).
#   ./deploy/backup.sh            → writes ./backups/hcis-YYYYmmdd-HHMM.{sql.gz,uploads.tgz}, keeps the last 14 days
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.prod; set +a
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p backups
$DC exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "backups/hcis-$STAMP.sql.gz"
$DC exec -T backend tar -C /data -czf - uploads > "backups/hcis-$STAMP.uploads.tgz"
find backups -name 'hcis-*' -mtime +14 -delete
echo "backup selesai: backups/hcis-$STAMP.*"
