#!/bin/bash
# ============================================================================
# network-isolation-verify.sh — Verify Docker network isolation between envs
# ----------------------------------------------------------------------------
# Confirms that a container on the deployed env's network cannot reach
# any service on the other env's network.
#
# Usage:
#   network-isolation-verify.sh --env production|preprod
#
# Exits 0 if isolation confirmed; 1 if cross-network access detected.
# Requirements: 2.1, 2.9
# ============================================================================

set -euo pipefail

ENV=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            ENV="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 --env production|preprod"
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

if [[ -z "$ENV" ]]; then
    echo "ERROR: --env is required" >&2
    exit 2
fi

if [[ "$ENV" != "production" && "$ENV" != "preprod" ]]; then
    echo "ERROR: --env must be 'production' or 'preprod'" >&2
    exit 2
fi

# Determine network and target names based on env
if [[ "$ENV" == "production" ]]; then
    NETWORK="app-network"
    OTHER_NETWORK="preprod-network"
    NGINX_CONTAINER="latest-nginx"
    NGINX_PORT="${NGINX_PORT:-8088}"
else
    NETWORK="preprod-network"
    OTHER_NETWORK="app-network"
    NGINX_CONTAINER="preprod-nginx"
    NGINX_PORT="${NGINX_PORT:-8090}"
fi

# Check that the network actually exists
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "ERROR: Network ${NETWORK} does not exist on this host." >&2
    exit 1
fi
if ! docker network inspect "$OTHER_NETWORK" >/dev/null 2>&1; then
    echo "ERROR: Network ${OTHER_NETWORK} does not exist on this host." >&2
    exit 1
fi

echo "Verifying isolation: ${NETWORK} -> ${OTHER_NETWORK}"

# Spawn a temporary alpine container on the deployed env's network and
# attempt to reach the OTHER environment's nginx container.
set +e
RESULT=$(docker run --rm \
    --network "$NETWORK" \
    --name "isolation-test-$$" \
    alpine:latest \
    sh -c "timeout 5 wget -q -O - http://${NGINX_CONTAINER}:${NGINX_PORT}/nginx-health" 2>&1)
EXIT=$?
set -e

if [[ $EXIT -eq 0 ]] && echo "$RESULT" | grep -q "nginx-ok"; then
    echo "ISOLATION VIOLATED: ${NETWORK} reached ${OTHER_NETWORK}'s nginx"
    echo "Output: $RESULT"
    exit 1
fi

# Also try a TCP connect to the other network's subnet to verify ICC is blocked.
RESULT2=$(docker run --rm \
    --network "$NETWORK" \
    --name "isolation-test-tcp-$$" \
    alpine:latest \
    sh -c "timeout 5 nc -zv 172.19.0.7 8090" 2>&1 || true)
if echo "$RESULT2" | grep -q "open\|succeeded"; then
    echo "ISOLATION VIOLATED: ${NETWORK} reached 172.19.0.7:8090 (preprod nginx IP)"
    echo "Output: $RESULT2"
    exit 1
fi

echo "OK: ${NETWORK} cannot reach ${OTHER_NETWORK} (cross-network attempts failed/timed out)"
exit 0
