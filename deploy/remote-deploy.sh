#!/usr/bin/env bash
# Runs on the droplet, called by the Deploy workflow. Pulls the new images, migrates, restarts,
# checks health, and rolls back to the previous tag if the new version doesn't come up.
set -euo pipefail
cd /opt/logger
: "${TAG:?}" "${IMAGE_PREFIX:?}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
PREV_TAG="$(cat .deployed_tag 2>/dev/null || true)"

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
fi

up() {
  export TAG="$1" IMAGE_PREFIX
  $COMPOSE pull --quiet
  $COMPOSE up -d db
  $COMPOSE run --rm migrate
  $COMPOSE up -d --remove-orphans api worker web caddy
}
healthy() {
  for _ in $(seq 1 30); do
    if $COMPOSE exec -T api wget -qO- http://localhost:4000/api/health >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

echo "Deploying $IMAGE_PREFIX/logger-*:$TAG (previous: ${PREV_TAG:-none})"
if up "$TAG" && healthy; then
  echo "$TAG" > .deployed_tag
  docker image prune -af --filter "until=168h" >/dev/null || true
  echo "Deployed $TAG"
  status=0
else
  echo "New version failed its health check."
  if [[ -n "$PREV_TAG" ]]; then
    echo "Rolling back to $PREV_TAG"
    up "$PREV_TAG" && healthy && echo "Rolled back to $PREV_TAG"
  fi
  status=1
fi
docker logout ghcr.io >/dev/null 2>&1 || true
exit $status
