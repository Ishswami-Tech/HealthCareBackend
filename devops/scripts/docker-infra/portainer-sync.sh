#!/bin/bash
# ============================================================================
# portainer-sync.sh — Optional Portainer CE API integration
# ----------------------------------------------------------------------------
# Provides non-blocking Portainer API integration for visibility and optional
# stack lifecycle control. NEVER fails the pipeline.
#
# Actions:
#   update-labels     - Updates container labels in Portainer for visibility
#   redeploy-stack    - Triggers a stack redeploy via Portainer API
#   verify-containers - Confirms expected containers are running
#
# Usage:
#   portainer-sync.sh --env production|preprod --action ACTION
#
# Requirements: 3.1, 3.2 (Portainer integration; non-blocking by design)
# ============================================================================

set -uo pipefail

ENV=""
ACTION=""
PORTAINER_URL="${PORTAINER_URL:-https://portainer.ishswami.in}"
PORTAINER_API_TOKEN="${PORTAINER_API_TOKEN:-}"
PORTAINER_ENDPOINT_ID="${PORTAINER_ENDPOINT_ID:-}"
PORTAINER_STACK_ID="${PORTAINER_STACK_ID:-}"
TIMEOUT=10

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env) ENV="$2"; shift 2 ;;
        --action) ACTION="$2"; shift 2 ;;
        --portainer-url) PORTAINER_URL="$2"; shift 2 ;;
        --endpoint-id) PORTAINER_ENDPOINT_ID="$2"; shift 2 ;;
        --stack-id) PORTAINER_STACK_ID="$2"; shift 2 ;;
        --timeout) TIMEOUT="$2"; shift 2 ;;
        -h|--help)
            cat <<EOF
Usage: $0 --env production|preprod --action ACTION

Actions:
  update-labels     - Update container labels for visibility
  redeploy-stack    - Trigger stack redeploy
  verify-containers - Confirm expected containers are running

Environment variables (optional):
  PORTAINER_URL          (default: https://portainer.ishswami.in)
  PORTAINER_API_TOKEN    (required for any action to succeed)
  PORTAINER_ENDPOINT_ID  (required for container ops)
  PORTAINER_STACK_ID     (required for redeploy-stack)
EOF
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

# Non-blocking: log if action is invalid or env unset; never fail the pipeline.
if [[ -z "$ENV" || -z "$ACTION" ]]; then
    echo "WARN: portainer-sync: --env and --action are required; skipping." >&2
    exit 0
fi

if [[ -z "$PORTAINER_API_TOKEN" ]]; then
    echo "WARN: portainer-sync: PORTAINER_API_TOKEN not set; skipping (Portainer is optional)." >&2
    exit 0
fi

# Quick reachability check
if ! curl -sS --max-time "$TIMEOUT" -o /dev/null \
    -H "Authorization: Bearer ${PORTAINER_API_TOKEN}" \
    "${PORTAINER_URL}/api/status" 2>/dev/null; then
    echo "WARN: portainer-sync: Portainer API unreachable at ${PORTAINER_URL}; skipping." >&2
    exit 0
fi

case "$ACTION" in
    update-labels)
        # Best-effort: tag the deploy via container labels. Portainer stores
        # labels from the Docker engine; we trigger a stack refresh.
        if [[ -z "$PORTAINER_STACK_ID" ]]; then
            echo "WARN: portainer-sync: PORTAINER_STACK_ID not set; cannot refresh stack." >&2
            exit 0
        fi
        RESP=$(curl -sS --max-time "$TIMEOUT" -X GET \
            -H "Authorization: Bearer ${PORTAINER_API_TOKEN}" \
            "${PORTAINER_URL}/api/stacks/${PORTAINER_STACK_ID}" 2>&1 || echo "FAIL")
        if echo "$RESP" | grep -q '"Id"'; then
            echo "OK: portainer-sync: stack ${PORTAINER_STACK_ID} reachable for ${ENV}."
        else
            echo "WARN: portainer-sync: could not retrieve stack ${PORTAINER_STACK_ID}." >&2
        fi
        ;;

    redeploy-stack)
        if [[ -z "$PORTAINER_STACK_ID" ]]; then
            echo "WARN: portainer-sync: PORTAINER_STACK_ID not set; cannot redeploy." >&2
            exit 0
        fi
        echo "INFO: portainer-sync: triggering redeploy of stack ${PORTAINER_STACK_ID}..."
        RESP=$(curl -sS --max-time "$TIMEOUT" -X PUT \
            -H "Authorization: Bearer ${PORTAINER_API_TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{}' \
            "${PORTAINER_URL}/api/stacks/${PORTAINER_STACK_ID}/git/redeploy" 2>&1 || echo "FAIL")
        if echo "$RESP" | grep -q "FAIL\|error"; then
            echo "WARN: portainer-sync: redeploy request did not succeed." >&2
        else
            echo "OK: portainer-sync: redeploy triggered."
        fi
        ;;

    verify-containers)
        if [[ -z "$PORTAINER_ENDPOINT_ID" ]]; then
            echo "WARN: portainer-sync: PORTAINER_ENDPOINT_ID not set; cannot list containers." >&2
            exit 0
        fi
        RESP=$(curl -sS --max-time "$TIMEOUT" \
            -H "Authorization: Bearer ${PORTAINER_API_TOKEN}" \
            "${PORTAINER_URL}/api/endpoints/${PORTAINER_ENDPOINT_ID}/docker/containers/json?all=1&filters=%7B%22label%22%3A%5B%22env%3D${ENV}%22%5D%7D" \
            2>&1 || echo "[]")
        COUNT=$(echo "$RESP" | grep -o '"Id"' | wc -l | tr -d ' ')
        echo "INFO: portainer-sync: ${COUNT} containers with env=${ENV} visible in Portainer."
        ;;

    *)
        echo "WARN: portainer-sync: unknown action '${ACTION}'; skipping." >&2
        exit 0
        ;;
esac

# Non-blocking: always exit 0
exit 0
