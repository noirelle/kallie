#!/usr/bin/env bash
set -euo pipefail

# Kallie EC2 Bootstrap & Deploy Script (Ubuntu / Debian)
# Usage: bash infra/deploy-ec2.sh

APP_DIR="${APP_DIR:-/opt/kallie}"
REPO_URL="${REPO_URL:-https://github.com/noirelle/kallie.git}"
BRANCH="${BRANCH:-main}"

echo "==> [1/5] Checking Docker & Compose installation..."
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

echo "==> [2/5] Syncing repository in ${APP_DIR}..."
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

echo "==> [3/5] Verifying required env files..."
for env_file in ".env" "services/api/.env" "services/agent/.env" "apps/web/.env.local"; do
  if [ ! -f "${env_file}" ]; then
    echo "ERROR: Missing ${APP_DIR}/${env_file}. Upload it before deploying."
    exit 1
  fi
done

echo "==> [4/5] Building and starting containers..."
docker compose up -d --build --remove-orphans

echo "==> [5/5] Waiting for API healthcheck..."
for i in $(seq 1 20); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    echo "SUCCESS: Kallie stack is healthy and running."
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "ERROR: Kallie API failed healthcheck."
docker compose logs --tail=50 api
exit 1
