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

usage() {
  cat <<EOF
Usage: $0 --app NAME --image IMAGE:TAG [OPTIONS]

Trigger a Coolify zero-downtime deploy.

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
  DEPLOY_ENV           Environment name (preprod|production)

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

# ─── Resolve app UUID from config file ────────────────────────────────────────
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

APP_UUID="${!UUID_VAR:-}"

if [[ -z "$APP_UUID" ]]; then
  log_error "No UUID configured for environment '$DEPLOY_ENV' and app '$APP_NAME'"
  log_error "Expected variable: $UUID_VAR in $CONFIG_FILE"
  exit 1
fi

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

# ─── Wait for Completion ──────────────────────────────────────────────────────
if [[ "$WAIT" == "true" ]]; then
  log_info "Waiting for deploy to complete (timeout: ${MAX_WAIT}s)..."

  ELAPSED=0
  POLL_INTERVAL=15

  while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    # Try services endpoint first (this is a Coolify service), fall back to applications
    APP_STATUS=$(curl -s \
      "${API_URL}/services/${APP_UUID}" \
      -H "Authorization: Bearer ${API_TOKEN}" \
      --max-time 10) || APP_STATUS=""

    STATUS=$(echo "$APP_STATUS" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")

    echo -e "${BLUE}[coolify]${NC} Status: $STATUS (${ELAPSED}s elapsed)"

    case "$STATUS" in
      healthy|running|ready)
        log_info "Application is healthy!"
        exit 0
        ;;
      failed|error|stopped)
        log_error "Deploy failed - status: $STATUS"
        exit 1
        ;;
    esac

    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  log_warn "Timeout waiting for deploy (${MAX_WAIT}s elapsed)"
  exit 1
fi

log_info "Deploy triggered (not waiting - run with --wait to block)"
