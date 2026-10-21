#!/usr/bin/env bash
# Starts Tradelog locally with Docker: Postgres, API, sync worker and web on http://localhost:8080
#   ./scripts/local-up.sh          start (first run asks for the Google OAuth client ID and secret)
#   ./scripts/local-up.sh --demo   also load a month of sample trades to click around with
#   ./scripts/local-up.sh --reset  stop and wipe the local database
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Desktop (with Compose) is required: https://www.docker.com/products/docker-desktop/"; exit 1
fi

if [[ "${1:-}" == "--reset" ]]; then
  docker compose down -v; echo "Stopped and wiped the local database."; exit 0
fi

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
setvar() { # setvar KEY VALUE  (replace the line in .env)
  local k="$1" v="$2"
  if grep -q "^$k=" .env; then sed -i.bak "s|^$k=.*|$k=$v|" .env && rm -f .env.bak; else echo "$k=$v" >> .env; fi
}
getvar() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  setvar SESSION_SECRET "$(rand 48)"
  setvar POSTGRES_PASSWORD "$(rand 24)"
  echo "Created .env with generated secrets."
fi

if [[ -z "$(getvar GOOGLE_CLIENT_ID)" || -z "$(getvar GOOGLE_CLIENT_SECRET)" ]]; then
  echo
  echo "Google sign-in needs an OAuth client (README > First-time setup > Google sign-in)."
  echo "Authorized redirect URI to register: http://localhost:8080/auth/google/callback"
  read -rp "Google OAuth client ID: " cid
  read -rp "Google OAuth client secret: " csec
  setvar GOOGLE_CLIENT_ID "$cid"
  setvar GOOGLE_CLIENT_SECRET "$csec"
fi

echo "Building and starting Tradelog (the first build takes a few minutes)..."
docker compose up -d --build

printf "Waiting for the API"
for _ in $(seq 1 90); do
  if curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then ok=1; break; fi
  printf "."; sleep 2
done
echo
if [[ -z "${ok:-}" ]]; then echo "Tradelog didn't come up. See: docker compose logs api"; exit 1; fi

if [[ "${1:-}" == "--demo" ]]; then
  docker compose exec -T api npx tsx scripts/seed-demo.ts ../../packages/core/test/fixtures/sample-month.xml
  echo "Loaded sample trades (Sep 21 to Oct 20, 2026). Wipe them before real use: ./scripts/local-up.sh --reset"
fi

echo
echo "Tradelog is ready: http://localhost:8080"
echo "Sign in with santosh.krishna0909@gmail.com or mailanilkumar@gmail.com."
echo "Logs: docker compose logs -f api worker    Stop: docker compose down"
