#!/usr/bin/env bash
# coolify-deploy.sh — Trigger a Coolify deploy from the VPS host
#
# Coolify manages container lifecycle with zero-downtime deploys.
# This script calls Coolify's REST API to trigger a new deployment.
#
# Usage:
#   COOLIFY_API_TOKEN=<token> ./coolify-deploy.sh \
#     --app-uuid <uuid> \
#     --image ghcr.io/owner/repo:tag \
#     [--wait] [--force]
#
# Prerequisites on the VPS:
#   - Coolify running (http://localhost:8000)
#   - COOLIFY_API_TOKEN set (from Coolify settings or .env)
#   - curl, jq installed
#
# The --app-uuid is the Coolify application's UUID.
# Get it from: curl -H "Bearer $TOKEN" http://localhost:8000/api/v1/applications
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Defaults ───────────────────────────────────────────────────────────────
APP_UUID=""
IMAGE=""
FORCE=false
WAIT=false
MAX_WAIT=300
API_URL="${COOLIFY_API_URL:-http://localhost:8000/api/v1}"
API_TOKEN="${COOLIFY_API_TOKEN:-}"

# ─── Colors ─────────────────────────────────────────────────────────────────
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
Usage: $0 --app-uuid UUID --image IMAGE:TAG [OPTIONS]

Trigger a Coolify zero-downtime deploy.

Required:
  --app-uuid UUID    Coolify application UUID
  --image IMAGE      Docker image (e.g. ghcr.io/owner/repo:tag)

Options:
  --force            Force redeploy even if image is the same
  --wait             Wait until deploy completes (healthy or failed)
  --wait-timeout N   Max seconds to wait (default: 300)
  --api-url URL      Coolify API URL (default: http://localhost:8000/api/v1)
  --api-token TOKEN  Coolify API token (or COOLIFY_API_TOKEN env)
  --help             Show this help

Example:
  COOLIFY_API_TOKEN="xxx" $0 \\
    --app-uuid abc-123 \\
    --image ghcr.io/user/healthcare-api:preprod-abc1234 \\
    --wait --force
EOF
  exit 1
}

# ─── Parse Arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-uuid)     APP_UUID="$2"; shift 2 ;;
    --image)        IMAGE="$2"; shift 2 ;;
    --force)        FORCE=true; shift ;;
    --wait)         WAIT=true; shift ;;
    --wait-timeout) MAX_WAIT="$2"; shift 2 ;;
    --api-url)      API_URL="$2"; shift 2 ;;
    --api-token)    API_TOKEN="$2"; shift 2 ;;
    --help)         usage ;;
    *)              log_error "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$APP_UUID" ]]; then
  log_error "--app-uuid is required"
  usage
fi
if [[ -z "$IMAGE" ]]; then
  log_error "--image is required"
  usage
fi
if [[ -z "$API_TOKEN" ]]; then
  log_error "COOLIFY_API_TOKEN is required (pass via --api-token or env)"
  exit 1
fi

# ─── Trigger Deploy ─────────────────────────────────────────────────────────
log_info "Triggering Coolify deploy..."
log_info "  App:    $APP_UUID"
log_info "  Image:  $IMAGE"
log_info "  Force:  $FORCE"

PAYLOAD=$(jq -n \
  --arg img "$IMAGE" \
  --argjson force "$FORCE" \
  '{image: $img, force: $force}')

HTTP_CODE=$(curl -s -o /tmp/coolify-response.json -w "%{http_code}" \
  -X POST \
  "${API_URL}/applications/${APP_UUID}/deploy" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
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

# Extract deploy UUID from response for tracking
DEPLOY_UUID=$(echo "$RESPONSE_BODY" | jq -r '.uuid // empty' 2>/dev/null || echo "")
if [[ -n "$DEPLOY_UUID" ]]; then
  log_info "Deploy UUID: $DEPLOY_UUID"
fi

# ─── Wait for Completion ────────────────────────────────────────────────────
if [[ "$WAIT" == "true" ]]; then
  log_info "Waiting for deploy to complete (timeout: ${MAX_WAIT}s)..."

  # Try to find the deployment resource
  DEPLOYMENTS_URL="${API_URL}/applications/${APP_UUID}/deployments?per_page=1"

  ELAPSED=0
  POLL_INTERVAL=15

  while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    # Check application status
    APP_STATUS=$(curl -s \
      "${API_URL}/applications/${APP_UUID}" \
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
        log_error "Deploy failed — status: $STATUS"
        exit 1
        ;;
    esac

    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  log_warn "Timeout waiting for deploy (${MAX_WAIT}s elapsed)"
  exit 1
fi

log_info "Deploy triggered (not waiting — run with --wait to block)"
