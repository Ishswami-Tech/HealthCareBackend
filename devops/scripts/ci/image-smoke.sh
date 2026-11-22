#!/usr/bin/env bash
# Starts a built image the way production runs it and fails unless it really serves, on the
# architecture of the machine running this script (CI runs it on a native amd64 and a native
# arm64 runner, because production runs one copy on temps-worker (amd64) and two on the Oracle
# nodes (arm64)).
#
#   1. throwaway Postgres + Dragonfly on a private Docker network;
#   2. API container (APP_MODE=api, RUN_MIGRATIONS=true, so every migration and the Prisma engine
#      of this architecture run against an empty database): /infra-health 200 and /health with
#      database and cache healthy;
#   3. worker container (APP_MODE=worker) against the same database and cache: its own
#      `--healthcheck` (the Docker HEALTHCHECK production uses) passes;
#   4. both containers report the expected `uname -m`.
#
# Usage: image-smoke.sh IMAGE [EXPECTED_ARCH]   (EXPECTED_ARCH defaults to this machine's)
# Every secret here is random and thrown away with the containers.
set -euo pipefail

IMAGE="${1:?usage: image-smoke.sh IMAGE [EXPECTED_ARCH]}"
EXPECTED_ARCH="${2:-$(uname -m)}"
PG_IMAGE="${SMOKE_PG_IMAGE:-postgres:18-alpine}"
CACHE_IMAGE="${SMOKE_CACHE_IMAGE:-docker.dragonflydb.io/dragonflydb/dragonfly:v2.1.0}"
API_WAIT_SECS="${SMOKE_API_WAIT_SECS:-240}"
WORKER_WAIT_SECS="${SMOKE_WORKER_WAIT_SECS:-180}"

RUN_ID="hcb-smoke-$$"
NET="$RUN_ID"
PG="$RUN_ID-pg"
CACHE="$RUN_ID-cache"
API="$RUN_ID-api"
WORKER="$RUN_ID-worker"

log() { echo "[smoke] $*"; }
fail() {
  echo "::error::image smoke test failed: $*"
  for c in "$API" "$WORKER"; do
    if docker inspect "$c" >/dev/null 2>&1; then
      echo "----- last 120 log lines of $c -----"
      docker logs --tail 120 "$c" 2>&1 || true
    fi
  done
  exit 1
}
cleanup() {
  docker rm -f "$API" "$WORKER" "$PG" "$CACHE" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

secret() { openssl rand -hex "${1:-32}"; }

PG_PASSWORD="$(secret 16)"
DB_URL="postgresql://postgres:${PG_PASSWORD}@${PG}:5432/userdb?schema=public"

docker network create "$NET" >/dev/null
log "starting $PG_IMAGE and $CACHE_IMAGE"
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=userdb "$PG_IMAGE" >/dev/null
docker run -d --name "$CACHE" --network "$NET" "$CACHE_IMAGE" \
  --logtostderr --proactor_threads=2 >/dev/null

for _ in $(seq 1 60); do
  docker exec "$PG" pg_isready -U postgres -d userdb >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$PG" pg_isready -U postgres -d userdb >/dev/null 2>&1 || fail "Postgres did not start"

# The production config's required variables (src/config/environment/validation.ts), with
# throwaway values; integrations stay off.
ENV_FILE="$(mktemp)"
trap 'cleanup; rm -f "$ENV_FILE"' EXIT
cat >"$ENV_FILE" <<EOF
NODE_ENV=production
TZ=Asia/Kolkata
PORT=8088
HOST=0.0.0.0
BASE_URL=http://localhost:8088
API_URL=http://localhost:8088
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=${DB_URL}
DIRECT_URL=${DB_URL}
DB_POOL_SIZE=5
JWT_SECRET=$(secret 32)
JWT_REFRESH_SECRET=$(secret 32)
SESSION_SECRET=$(secret 32)
COOKIE_SECRET=$(secret 32)
COMMUNICATION_ENCRYPTION_KEY=$(secret 32)
QR_SECRET_KEY=$(secret 32)
PHI_CACHE_ENCRYPTION_KEY=$(secret 32)
CACHE_ENABLED=true
CACHE_PROVIDER=dragonfly
DRAGONFLY_ENABLED=true
DRAGONFLY_HOST=${CACHE}
DRAGONFLY_PORT=6379
S3_ENABLED=false
S3_PROVIDER=custom
S3_ENDPOINT=http://127.0.0.1:9
S3_REGION=us-east-1
S3_BUCKET=smoke
S3_ACCESS_KEY_ID=smoke
S3_SECRET_ACCESS_KEY=smoke
WHATSAPP_ENABLED=false
VIDEO_ENABLED=false
EOF

arch_of() { docker exec "$1" uname -m 2>/dev/null || echo unknown; }

log "starting the API (migrations on)"
docker run -d --name "$API" --network "$NET" --env-file "$ENV_FILE" \
  -e APP_MODE=api -e SERVICE_NAME=api -e RUN_MIGRATIONS=true "$IMAGE" >/dev/null

api_ok=0
for _ in $(seq 1 $((API_WAIT_SECS / 5))); do
  [[ "$(docker inspect -f '{{.State.Running}}' "$API" 2>/dev/null)" == "true" ]] || fail "API container exited"
  if docker exec "$API" wget -q -O /dev/null "http://localhost:8088/infra-health" 2>/dev/null; then
    api_ok=1
    break
  fi
  sleep 5
done
[[ $api_ok == 1 ]] || fail "API /infra-health did not answer 200 within ${API_WAIT_SECS}s"

api_arch="$(arch_of "$API")"
[[ "$api_arch" == "$EXPECTED_ARCH" ]] || fail "API runs on $api_arch, expected $EXPECTED_ARCH"

# /health: database and cache must be healthy (other services may be degraded: no providers here).
health_ok=0
for _ in $(seq 1 24); do
  health="$(docker exec "$API" wget -q -O - "http://localhost:8088/health" 2>/dev/null || true)"
  if node -e '
      const h = JSON.parse(process.argv[1]);
      const s = h.services || {};
      const ok = n => (s[n] && s[n].status) === "healthy";
      process.exit(ok("database") && ok("cache") ? 0 : 1);
    ' "$health" 2>/dev/null; then
    health_ok=1
    break
  fi
  sleep 5
done
[[ $health_ok == 1 ]] || fail "API /health did not report database and cache healthy: ${health:0:600}"
log "API ok on $api_arch"

log "starting the worker"
docker run -d --name "$WORKER" --network "$NET" --env-file "$ENV_FILE" \
  -e APP_MODE=worker -e SERVICE_NAME=worker "$IMAGE" >/dev/null

worker_ok=0
for _ in $(seq 1 $((WORKER_WAIT_SECS / 5))); do
  [[ "$(docker inspect -f '{{.State.Running}}' "$WORKER" 2>/dev/null)" == "true" ]] || fail "worker container exited"
  if docker exec "$WORKER" node dist/worker-bootstrap.js --healthcheck >/dev/null 2>&1; then
    worker_ok=1
    break
  fi
  sleep 5
done
[[ $worker_ok == 1 ]] || fail "worker --healthcheck did not pass within ${WORKER_WAIT_SECS}s"

worker_arch="$(arch_of "$WORKER")"
[[ "$worker_arch" == "$EXPECTED_ARCH" ]] || fail "worker runs on $worker_arch, expected $EXPECTED_ARCH"
log "worker ok on $worker_arch"
log "PASS: $IMAGE on $EXPECTED_ARCH"
