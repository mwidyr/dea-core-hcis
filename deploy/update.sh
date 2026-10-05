#!/usr/bin/env bash
# Pull the latest code from GitHub and redeploy (data volumes are kept).  Run on the VPS from the project folder:  ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
./deploy/backup.sh                       # safety net before every update
git pull --ff-only
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
