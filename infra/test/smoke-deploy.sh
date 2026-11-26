#!/usr/bin/env bash
set -euo pipefail

# Post-deploy / pre-cutover smoke tests for Kallie Docker stack on EC2
# Usage: bash infra/test/smoke-deploy.sh

echo "==> [Smoke 1/4] Validating Docker Compose config..."
docker compose config -q

echo "==> [Smoke 2/4] Verifying all containers are running..."
for svc in api agent web caddy; do
  status=$(docker compose ps --status running --services | grep -x "${svc}" || true)
  if [ "${status}" != "${svc}" ]; then
    echo "FAIL: Service '${svc}' is not running."
    docker compose ps
    docker compose logs --tail=40 "${svc}"
    exit 1
  fi
done
echo "PASS: All 4 containers (api, agent, web, caddy) are running."

echo "==> [Smoke 3/4] Checking internal API /health and Web HTTP 200..."
docker compose exec -T api node -e "
  fetch('http://127.0.0.1:3001/health')
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok || data.status !== 'ok') {
        console.error('Bad health response:', r.status, data);
        process.exit(1);
      }
      console.log('PASS: API /health ->', JSON.stringify(data));
    })
    .catch((err) => { console.error(err); process.exit(1); });
"

docker compose exec -T web node -e "
  fetch('http://127.0.0.1:3000')
    .then((r) => {
      if (!r.ok) {
        console.error('Web returned HTTP', r.status);
        process.exit(1);
      }
      console.log('PASS: Web HTTP', r.status);
    })
    .catch((err) => { console.error(err); process.exit(1); });
"

echo "==> [Smoke 4/4] Checking public HTTPS endpoints (if DNS configured)..."
if [ -f ".env" ]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
  if [ -n "${API_DOMAIN:-}" ] && [ "${API_DOMAIN}" != "api.yourdomain.com" ]; then
    if curl -fsS --max-time 10 "https://${API_DOMAIN}/health" >/dev/null; then
      echo "PASS: https://${API_DOMAIN}/health reachable over HTTPS."
    else
      echo "WARN: https://${API_DOMAIN}/health not reachable yet (DNS/SSL may still be propagating)."
    fi
  fi
fi

echo "==> All required smoke tests passed."
