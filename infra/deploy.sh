#!/usr/bin/env bash
# Run this on the VM after `git pull` to (re)deploy.
# Usage: cd ~/taskflow/infra && ./deploy.sh

set -euo pipefail

if [ ! -f .env.prod ]; then
  echo "ERROR: .env.prod not found in $(pwd). Copy .env.prod.example and fill in values." >&2
  exit 1
fi

echo "==> pulling latest code"
git -C .. pull --ff-only

echo "==> building images"
docker compose --env-file .env.prod -f docker-compose.prod.yml build

echo "==> starting / restarting stack"
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --remove-orphans

echo "==> waiting for health"
sleep 8
docker compose --env-file .env.prod -f docker-compose.prod.yml ps

echo "==> recent logs"
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail=20
