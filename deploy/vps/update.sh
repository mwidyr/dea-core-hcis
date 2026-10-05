#!/usr/bin/env bash
# Rilis baru di VPS (gaya ayt-sales: tanpa Docker).  Jalankan sebagai user biasa yang punya sudo:  ./deploy/vps/update.sh
set -euo pipefail
APP=/var/www/dea-core-hcis
cd "$APP"
./deploy/vps/backup.sh                      # jaring pengaman sebelum update
git pull --ff-only

echo "== build backend"
( cd backend && /usr/local/go/bin/go build -o hcis-backend.new ./cmd/server && mv hcis-backend.new hcis-backend )
sudo chown hcis:hcis backend/hcis-backend
sudo systemctl restart hcis-backend

echo "== build frontend"
( cd frontend && npm ci && npm run build )
sudo systemctl reload nginx

sleep 3
curl -fsS http://127.0.0.1:8080/api/health && echo " <- backend OK"
sudo systemctl --no-pager --lines=5 status hcis-backend | head -8
