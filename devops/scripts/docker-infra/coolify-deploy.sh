#!/usr/bin/env bash
# coolify-deploy.sh - Trigger a Coolify deploy from the VPS host
#
# Coolify manages container lifecycle with zero-downtime deploys.
# This script calls Coolify's REST API to trigger a new deployment.
#
# Usage:
#   COOLIFY_API_TOKEN=<token> DEPLOY_ENV=preprod \
#     ./coolify-deploy.sh --app api --image <image:tag> [--wait] [--force]
#
# The script resolves the Coolify app UUID from devops/config/coolify-apps.env
# based on (DEPLOY_ENV, --app), so no UUID secrets are needed in CI.
#
# Prerequisites on the VPS:
#   - Coolify running (http://localhost:8000)
#   - COOLIFY_API_TOKEN set (from Coolify settings or .env)
#   - curl, jq installed
#   - devops/config/coolify-apps.env present and populated
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${COOLIFY_CONFIG_FILE:-${SCRIPT_DIR}/../../config/coolify-apps.env}"

# ─── Defaults ─────────────────────────────────────────────────────────────────
APP_UUID=""
APP_NAME=""
DEPLOY_ENV="${DEPLOY_ENV:-}"
IMAGE=""
FORCE=false
WAIT=false
MAX_WAIT=300
API_URL="${COOLIFY_API_URL:-http://localhost:8000/api/v1}"
API_TOKEN="${COOLIFY_API_TOKEN:-}"

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[coolify]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[coolify]${NC} $*"; }
log_error() { echo -e "${RED}[coolify]${NC} $*"; }
log_success() { echo -e "${GREEN}[coolify]${NC} $*"; }

usage() {
  cat <<EOF
Usage: $0 --app NAME --image IMAGE:TAG [OPTIONS]

Trigger a Coolify rolling deploy with sustained health verification.

Required:
  --app NAME          Coolify app name (nginx, api, worker)
  --image IMAGE       Docker image (e.g. ghcr.io/owner/repo:tag)

Options:
  --env ENV            Environment name (preprod|production), default: \$DEPLOY_ENV
  --force              Force redeploy even if image is the same
  --wait               Wait until deploy completes (healthy or failed)
  --wait-timeout N     Max seconds to wait (default: 300)
  --api-url URL        Coolify API URL (default: http://localhost:8000/api/v1)
  --api-token TOKEN    Coolify API token (or COOLIFY_API_TOKEN env)
  --help               Show this help

Environment variables:
  COOLIFY_API_TOKEN    Coolify API token
  COOLIFY_API_URL      Coolify API base URL
  COOLIFY_CONFIG_FILE  Path to coolify-apps.env (default: devops/config/coolify-apps.env)
  COOLIFY_APP_UUID     Explicit Coolify app UUID override
  DEPLOY_ENV           Environment name (preprod|production)
  RUN_DB_MIGRATIONS    true | status (default) | false - see docs/DEPLOY_MIGRATIONS.md
  MIGRATE_DATABASE_URL Optional explicit DB URL for the migration container
  MIGRATE_NETWORK      Docker network for migrations when no api container runs (default: coolify)

Example:
  DEPLOY_ENV=preprod COOLIFY_API_TOKEN="xxx" $0 \\
    --app api \\
    --image ghcr.io/user/healthcare-api:preprod-abc1234 \\
    --wait --force
EOF
  exit 1
}

# ─── Parse Arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)           APP_NAME="$2"; shift 2 ;;
    --env)           DEPLOY_ENV="$2"; shift 2 ;;
    --image)         IMAGE="$2"; shift 2 ;;
    --force)         FORCE=true; shift ;;
    --wait)          WAIT=true; shift ;;
    --wait-timeout)  MAX_WAIT="$2"; shift 2 ;;
    --api-url)       API_URL="$2"; shift 2 ;;
    --api-token)     API_TOKEN="$2"; shift 2 ;;
    --help)          usage ;;
    *)               log_error "Unknown option: $1"; usage ;;
  esac
done

# ─── Validate args ────────────────────────────────────────────────────────────
[[ -z "$APP_NAME" ]]  && { log_error "--app is required"; usage; }
[[ -z "$IMAGE" ]]     && { log_error "--image is required"; usage; }
[[ -z "$DEPLOY_ENV" ]] && { log_error "DEPLOY_ENV is required (or pass --env)"; usage; }
[[ -z "$API_TOKEN" ]] && { log_error "COOLIFY_API_TOKEN is required"; exit 1; }

# Allow CI to pass the app UUID directly. This keeps production and preprod on
# the same deploy path while preserving config-file fallback behavior.
if [[ -z "${COOLIFY_APP_UUID:-}" ]]; then
  # ─── Resolve app UUID from config file ──────────────────────────────────────
  if [[ ! -f "$CONFIG_FILE" ]]; then
    log_error "Config file not found: $CONFIG_FILE"
    log_error "Create it from devops/config/coolify-apps.env.example"
    exit 1
  fi

  # shellcheck disable=SC1090
  source "$CONFIG_FILE"

  ENV_KEY="$(echo "$DEPLOY_ENV" | tr '[:lower:]-' '[:upper:]_')"
  APP_KEY="$(echo "$APP_NAME" | tr '[:lower:]-' '[:upper:]_')"
  UUID_VAR="${ENV_KEY}_${APP_KEY}_UUID"

  COOLIFY_APP_UUID="${!UUID_VAR:-}"

  if [[ -z "$COOLIFY_APP_UUID" ]]; then
    log_error "No UUID configured for environment '$DEPLOY_ENV' and app '$APP_NAME'"
    log_error "Expected variable: $UUID_VAR in $CONFIG_FILE"
    exit 1
  fi
fi

APP_UUID="${COOLIFY_APP_UUID}"
log_info "Resolved: $DEPLOY_ENV/$APP_NAME -> $APP_UUID"

# ─── Extract tag from image (for logging/verification) ────────────────────────
IMAGE_TAG="${IMAGE##*:}"

# ─── Trigger Deploy ───────────────────────────────────────────────────────────
log_info "Triggering Coolify deploy..."
log_info "  Env:    $DEPLOY_ENV"
log_info "  App:    $APP_NAME ($APP_UUID)"
log_info "  Image:  $IMAGE"
log_info "  Tag:   $IMAGE_TAG"
log_info "  Force:  $FORCE"

# If an explicit image was provided, write DOCKER_IMAGE to the service .env
# and pull the image via docker compose. The compose file uses
# image: '${DOCKER_IMAGE:-ghcr.io/...:preprod}', so updating the .env is the
# canonical way to point the service at a new image.
#
# NOTE: For production (and other environments where Coolify stores its service
# config differently), the service directory may be empty. In that case we
# skip the compose-based image update and rely on the Coolify API deploy call
# to pick up the new image. Coolify pulls the image directly from the registry
# during deployment.
if [[ -n "$IMAGE" ]]; then
  IMAGE_NAME="${IMAGE%:*}"
  IMAGE_TAG="${IMAGE##*:}"
  if [[ "$IMAGE_NAME" == "$IMAGE" ]]; then
    log_error "Image must include a tag: ${IMAGE}"
    exit 1
  fi

  # Resolve the service directory from Coolify's data
  SERVICE_DIR="/data/coolify/services/${APP_UUID}"
  COMPOSE_FILE="${SERVICE_DIR}/docker-compose.yml"
  ENV_FILE="${SERVICE_DIR}/.env"

  if [[ -f "$COMPOSE_FILE" ]]; then
    log_info "Updating DOCKER_IMAGE in ${ENV_FILE} → ${IMAGE}"

    # .env is owned by root — use sudo for writes
    if grep -q '^DOCKER_IMAGE=' "$ENV_FILE" 2>/dev/null; then
      sudo sed -i "s|^DOCKER_IMAGE=.*|DOCKER_IMAGE=${IMAGE}|" "$ENV_FILE"
    else
      echo "DOCKER_IMAGE=${IMAGE}" | sudo tee -a "$ENV_FILE" > /dev/null
    fi

    log_info "DOCKER_IMAGE set to ${IMAGE}"

    # Pull the image via docker compose so the VPS cache is fresh
    log_info "Pulling image via docker compose..."
    PULL_CODE=$(sudo docker compose -f "$COMPOSE_FILE" pull > /dev/null 2>&1; echo $?)
    if [[ "$PULL_CODE" -eq 0 ]]; then
      log_info "Image pulled successfully"
    else
      log_warn "docker compose pull exited with code ${PULL_CODE} — Coolify may use cached image"
      # Tag the SHA image as the floating branch tag so Coolify's fallback picks it up
      SHA_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
      FLOAT_TAG="${IMAGE_NAME}:${IMAGE_TAG%%-*}"
      if sudo docker inspect "$SHA_IMAGE" > /dev/null 2>&1; then
        log_info "Tagging ${SHA_IMAGE} → ${FLOAT_TAG} locally..."
        sudo docker tag "$SHA_IMAGE" "$FLOAT_TAG"
        log_info "Tagged: ${FLOAT_TAG} now points to the new image"
      else
        log_warn "SHA image ${SHA_IMAGE} not found locally — cannot tag fallback"
      fi
    fi
  else
    log_warn "No compose file at ${COMPOSE_FILE} — prod Coolify stores config in its DB"
    log_warn "Creating compose file so deploy script can control the image..."
    log_info "Setting image to ${IMAGE} via composed docker-compose.yml..."

    # Coolify prod service stores config in DB only (no compose on disk).
    # Create one so the deploy script's .env update path works.
    # Coolify does the same thing for preprod — we're just doing it manually.
    sudo mkdir -p "$SERVICE_DIR"

    # Secrets (DATABASE_URL, JWT_SECRET, ...) are NOT written into the generated compose file.
    # They come from the env_file below (and Coolify secrets). The previous version embedded
    # GitHub-expression syntax that cannot run on the VPS and silently fell back to the
    # postgres:postgres superuser default.
    PROD_ENV_FILE="${PROD_ENV_FILE:-/opt/healthcare-production/.env.production}"
    if ! sudo grep -q '^DATABASE_URL=' "$PROD_ENV_FILE" 2>/dev/null; then
      log_error "DATABASE_URL is not set in ${PROD_ENV_FILE}; refusing to generate a compose file"
      exit 1
    fi

    CACHE_PREFIX="production:"

    sudo tee "$COMPOSE_FILE" > /dev/null << COMPOSE_EOF
services:
  api:
    image: '\${DOCKER_IMAGE:-${IMAGE}}'
    container_name: api-${APP_UUID}
    hostname: api
    env_file:
      - ${PROD_ENV_FILE}
      - .env
    environment:
      DRAGONFLY_KEY_PREFIX: '${CACHE_PREFIX}'
      CACHE_PREFIX: '${CACHE_PREFIX}'
      NODE_ENV: production
      APP_MODE: api
      SERVICE_NAME: api
      DEV_MODE: 'false'
      DOCKER_ENV: 'true'
      CRON_TIMEZONE: Asia/Kolkata
      TZ: Asia/Kolkata
      PORT: 8088
      HOST: 0.0.0.0
      PRISMA_SCHEMA_PATH: /app/src/libs/infrastructure/database/prisma/schema.prisma
      CACHE_PROVIDER: dragonfly
      CACHE_ENABLED: 'true'
      DRAGONFLY_ENABLED: 'true'
      DRAGONFLY_HOST: dhpn8hj78kg3ivu0ohdbypmn
      DRAGONFLY_PORT: 6379
      ENABLE_HTTP2: 'false'
      TRUSTED_PROXY_HOPS: 1
      DB_POOL_SIZE: 25
    networks:
      - coolify
    restart: unless-stopped

  worker:
    image: '\${DOCKER_IMAGE:-${IMAGE}}'
    container_name: worker-${APP_UUID}
    hostname: worker
    env_file:
      - ${PROD_ENV_FILE}
      - .env
    environment:
      DRAGONFLY_KEY_PREFIX: '${CACHE_PREFIX}'
      CACHE_PREFIX: '${CACHE_PREFIX}'
      NODE_ENV: production
      APP_MODE: worker
      SERVICE_NAME: worker
      DEV_MODE: 'false'
      DOCKER_ENV: 'true'
      CRON_TIMEZONE: Asia/Kolkata
      TZ: Asia/Kolkata
      DB_POOL_SIZE: 10
    networks:
      - coolify
    restart: unless-stopped

networks:
  coolify:
    external: true
COMPOSE_EOF

    log_info "Created ${COMPOSE_FILE}"

    # Write DOCKER_IMAGE to .env so compose interpolation picks it up
    echo "DOCKER_IMAGE=${IMAGE}" | sudo tee "${SERVICE_DIR}/.env" > /dev/null
    log_info "DOCKER_IMAGE set to ${IMAGE} in ${SERVICE_DIR}/.env"

    # Pull the image
    log_info "Pulling image via docker compose..."
    PULL_CODE=$(sudo docker compose -f "$COMPOSE_FILE" pull > /dev/null 2>&1; echo $?)
    if [[ "$PULL_CODE" -eq 0 ]]; then
      log_info "Image pulled successfully"
    else
      log_warn "docker compose pull exited with code ${PULL_CODE}"
    fi
  fi
fi

# ─── Database migrations (P0-3) ──────────────────────────────────────────────
# Runs BEFORE Coolify starts the new release, in a one-shot container from the NEW image, so
# the old release keeps serving until the schema is ready. CI runs the pre-deployment backup
# job before this script.
#
# RUN_DB_MIGRATIONS:
#   true   - `prisma migrate status` pre-check (fails on failed migrations, history drift or an
#            unmanaged schema), then `prisma migrate deploy`, which holds a Postgres advisory
#            lock so concurrent runs cannot double-apply. Any failure aborts the deploy here.
#   status - pre-check only; prints pending/drift and NEVER blocks the deploy (default).
#   false  - skip.
# Switch an environment to `true` only after docs/DEPLOY_MIGRATIONS.md was followed on a prod copy.
RUN_DB_MIGRATIONS="${RUN_DB_MIGRATIONS:-status}"

resolve_migration_database_url() {
  if [[ -n "${MIGRATE_DATABASE_URL:-}" ]]; then
    printf '%s' "$MIGRATE_DATABASE_URL"
    return 0
  fi
  local candidates=("/data/coolify/services/${APP_UUID}/.env")
  if [[ "$DEPLOY_ENV" == "production" ]]; then
    candidates+=("/opt/healthcare-backend/.env.production" "/opt/healthcare-production/.env.production")
  else
    candidates+=("/opt/healthcare-preprod/.env.preprod")
  fi
  local file value
  for file in "${candidates[@]}"; do
    value=$(sudo grep -E '^DATABASE_URL=' "$file" 2>/dev/null | tail -1 | cut -d= -f2- \
      | sed -e "s/^['\"]//" -e "s/['\"]\$//" || true)
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

run_db_migrations() {
  local mode="$1"
  local db_url network env_tmp exit_code
  local -a script_args=()
  [[ "$mode" == "status" ]] && script_args=(--status-only)

  if ! db_url=$(resolve_migration_database_url); then
    if [[ "$mode" == "status" ]]; then
      log_warn "Migrations (status): DATABASE_URL not found - skipping the read-only status check"
      return 0
    fi
    log_error "Migrations: DATABASE_URL not found (Coolify service .env or app env file). Aborting deploy."
    exit 1
  fi

  # Share the network namespace of the running api container so the DB host resolves exactly
  # as it does for the app. Fall back to MIGRATE_NETWORK (default: coolify) on a first deploy.
  if sudo docker inspect "api-${APP_UUID}" > /dev/null 2>&1; then
    network="container:api-${APP_UUID}"
  else
    network="${MIGRATE_NETWORK:-coolify}"
  fi

  # Pass the URL through a 0600 temp env file, never on the command line or in logs.
  env_tmp=$(umask 077 && mktemp)
  MIGRATE_ENV_TMP="$env_tmp"
  trap 'rm -f "${MIGRATE_ENV_TMP:-}"' EXIT
  printf 'DATABASE_URL=%s\n' "$db_url" > "$env_tmp"

  log_info "Migrations (${mode}): running deploy-migrate.js from ${IMAGE} (network: ${network})"
  set +e
  sudo docker run --rm \
    --network "$network" \
    --env-file "$env_tmp" \
    -e NODE_ENV=production \
    -e APP_MODE=migrate \
    --entrypoint node \
    "$IMAGE" \
    /app/scripts/deploy-migrate.js "${script_args[@]}"
  exit_code=$?
  set -e
  rm -f "$env_tmp"

  if [[ $exit_code -ne 0 ]]; then
    if [[ "$mode" == "status" ]]; then
      log_warn "Migrations (status): pre-check reported a problem (exit ${exit_code}). NOT blocking this deploy."
      log_warn "Pending migrations are NOT applied in status mode. Follow docs/DEPLOY_MIGRATIONS.md."
      return 0
    fi
    log_error "Migrations failed (exit ${exit_code}). The new release was NOT deployed."
    log_error "See docs/DEPLOY_MIGRATIONS.md. Restore from the pre-deployment backup only if a migration half-applied."
    exit 1
  fi
  if [[ "$mode" == "status" ]]; then
    log_warn "Migrations (status): check done; pending migrations (if listed above) were NOT applied"
  else
    log_success "Migrations: database schema is up to date"
  fi
}

case "$RUN_DB_MIGRATIONS" in
  true)   run_db_migrations apply ;;
  status) run_db_migrations status ;;
  *)      log_warn "RUN_DB_MIGRATIONS=${RUN_DB_MIGRATIONS} - skipping Prisma migrations for ${DEPLOY_ENV}" ;;
esac

# Coolify v4 deploy endpoint: POST /api/v1/deploy
# Use uuid-only (not tag) — Coolify deploys whatever image the service is configured with
REQUEST_BODY="{\"uuid\":\"${APP_UUID}\"}"
if [[ "$FORCE" == "true" ]]; then
  REQUEST_BODY="{\"uuid\":\"${APP_UUID}\",\"force\":true}"
fi

HTTP_CODE=$(curl -s -o /tmp/coolify-response.json -w "%{http_code}" \
  -X POST \
  "${API_URL}/deploy" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY" \
  --max-time 60) || {
    log_error "Failed to reach Coolify API at ${API_URL}"
    exit 1
  }

RESPONSE_BODY=$(cat /tmp/coolify-response.json)
log_info "Coolify responded: HTTP ${HTTP_CODE}"
echo "$RESPONSE_BODY" | head -10

if [[ ! "$HTTP_CODE" =~ ^2[0-9]{2}$ ]]; then
  log_error "Deploy trigger failed"
  log_error "$RESPONSE_BODY"
  exit 1
fi

# Coolify v4 returns { deployments: [{ message, resource_uuid }] }
DEPLOY_MSG=$(echo "$RESPONSE_BODY" | jq -r '.deployments[0]?.message // empty' 2>/dev/null || echo "")
if [[ -n "$DEPLOY_MSG" ]]; then
  log_info "Coolify says: $DEPLOY_MSG"
fi

# ─── Wait for Container Health Stability ────────────────────────────────────
# Coolify recreates the container; once it reports healthy, we require
# SUSTAINED_HEALTH_SECONDS of continuous healthy status before declaring the
# deploy complete. This ensures the new container is stable before Coolify
# removes the old one.
if [[ "$WAIT" == "true" ]]; then
  SUSTAINED_HEALTH_SECONDS="${SUSTAINED_HEALTH_SECONDS:-30}"
  log_info "Waiting for deploy to complete (sustained health: ${SUSTAINED_HEALTH_SECONDS}s)..."

  ELAPSED=0
  HEALTH_STABLE=0
  HEALTH_STARTED=false
  POLL_INTERVAL=5

  while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    APP_STATUS=$(curl -s \
      "${API_URL}/services/${APP_UUID}" \
      -H "Authorization: Bearer ${API_TOKEN}" \
      --max-time 10) || APP_STATUS=""

    STATUS=$(echo "$APP_STATUS" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")

    echo -e "${BLUE}[coolify]${NC} Status: $STATUS (${ELAPSED}s elapsed, stable: ${HEALTH_STABLE}s)"

    case "$STATUS" in
      *healthy*|*running*|*ready*)
        if [[ "$HEALTH_STARTED" == "false" ]]; then
          log_info "Container is healthy — waiting ${SUSTAINED_HEALTH_SECONDS}s to confirm stability..."
          HEALTH_STARTED=true
        fi
        HEALTH_STABLE=$((HEALTH_STABLE + POLL_INTERVAL))
        if [[ "$HEALTH_STABLE" -ge "$SUSTAINED_HEALTH_SECONDS" ]]; then
          log_success "Container healthy for ${HEALTH_STABLE}s — deploy stable"
          exit 0
        fi
        ;;
      *failed*|*error*|*stopped*)
        log_error "Deploy failed - status: $STATUS"
        exit 1
        ;;
      *)
        # Status degraded — reset stability counter
        if [[ "$HEALTH_STARTED" == "true" ]]; then
          log_warn "Health degraded (status: $STATUS) — resetting stability counter"
          HEALTH_STARTED=false
          HEALTH_STABLE=0
        fi
        ;;
    esac

    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  log_error "Timeout waiting for sustained health (${MAX_WAIT}s elapsed, stable: ${HEALTH_STABLE}/${SUSTAINED_HEALTH_SECONDS}s)"
  exit 1
fi

log_info "Deploy triggered (not waiting - run with --wait to block)"
