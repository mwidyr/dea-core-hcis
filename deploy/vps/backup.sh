#!/usr/bin/env bash
# Backup database + file unggahan ke /var/backups/hcis (simpan 14 hari).
#   Manual: sudo ./deploy/vps/backup.sh        Cron (root): 0 2 * * * /var/www/dea-core-hcis/deploy/vps/backup.sh
set -euo pipefail
DEST=/var/backups/hcis
STAMP=$(date +%Y%m%d-%H%M)
sudo mkdir -p "$DEST"
sudo -u postgres pg_dump dea_hcis | gzip | sudo tee "$DEST/hcis-$STAMP.sql.gz" >/dev/null
sudo tar -C /var/lib/hcis -czf "$DEST/hcis-$STAMP.uploads.tgz" uploads 2>/dev/null || true
sudo find "$DEST" -name 'hcis-*' -mtime +14 -delete
echo "backup selesai: $DEST/hcis-$STAMP.*"
