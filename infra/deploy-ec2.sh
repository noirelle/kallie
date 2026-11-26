#!/usr/bin/env bash
set -euo pipefail

# Kallie EC2 Bootstrap & Deploy Script (Ubuntu / Debian)
# Runs preflight checks before building and smoke tests after starting containers.
# Usage: bash infra/deploy-ec2.sh

APP_DIR="${APP_DIR:-/opt/kallie}"
REPO_URL="${REPO_URL:-https://github.com/noirelle/kallie.git}"
BRANCH="${BRANCH:-main}"

echo "==> [1/6] Checking 2GB swap (important for t3.micro 1GB RAM) & Docker..."
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Swap:/ {print $2}')" -lt 1024 ]; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "Swap enabled: $(free -h | awk '/^Swap:/ {print $2}')"
fi

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

echo "==> [2/6] Syncing repository in ${APP_DIR}..."
if [ ! -d "${APP_DIR}/.git" ]; then
  sudo mkdir -p "${APP_DIR}"
  sudo chown -R "$USER:$USER" "${APP_DIR}"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  cd "${APP_DIR}"
  git fetch origin "${BRANCH}"
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
fi

cd "${APP_DIR}"

echo "==> [3/6] Verifying required env files..."
for env_file in ".env" "services/api/.env" "services/agent/.env" "apps/web/.env.local"; do
  if [ ! -f "${env_file}" ]; then
    echo "ERROR: Missing ${APP_DIR}/${env_file}. Upload it before deploying."
    exit 1
  fi
done

echo "==> [4/6] Running pre-deploy infra checks..."
docker compose config -q
if command -v node >/dev/null 2>&1; then
  node --test infra/test/preflight.test.mjs
fi

echo "==> [5/6] Pulling prebuilt GHCR images and starting containers..."
docker compose pull
docker compose up -d --remove-orphans

echo "==> [6/6] Running post-deploy smoke tests..."
for i in $(seq 1 20); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; then
    bash infra/test/smoke-deploy.sh
    exit 0
  fi
  sleep 2
done

echo "ERROR: Kallie API failed to become healthy within timeout."
docker compose logs --tail=50 api
exit 1
