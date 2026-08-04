#!/bin/bash
# ============================================================================
# health-check.sh — Multi-environment infrastructure health checker
# ----------------------------------------------------------------------------
# Usage:
#   ./health-check.sh --env production|preprod [--json]
#
# Environment variables:
#   DEPLOY_ENV         - Target environment (production|preprod)
#   CONTAINER_PREFIX    - "latest-" or "preprod-"
#   COMPOSE_FILE       - docker-compose.prod.yml or docker-compose.preprod.yml
#   BASE_DIR           - Base deployment directory (default: /opt/healthcare-backend)
# ----------------------------------------------------------------------------

set -euo pipefail

# ----------------------------------------------------------------------------
# Defaults and argument parsing
# ----------------------------------------------------------------------------
DEPLOY_ENV="${DEPLOY_ENV:-production}"
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BASE_DIR="${BASE_DIR:-/opt/healthcare-backend}"
OUTPUT_JSON=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            DEPLOY_ENV="$2"
            shift 2
            ;;
        --json)
            OUTPUT_JSON=true
            shift
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 [OPTIONS]

Options:
  --env ENV              Target environment: production|preprod (default: production)
  --json                 Output JSON format
  -h, --help             Show this help
EOF
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# ----------------------------------------------------------------------------
# Auto-configure based on environment
# ----------------------------------------------------------------------------
case "$DEPLOY_ENV" in
    production)
        [[ "$CONTAINER_PREFIX" == "latest-" ]] || CONTAINER_PREFIX="latest-"
        [[ "$COMPOSE_FILE" == "docker-compose.prod.yml" ]] || COMPOSE_FILE="docker-compose.prod.yml"
        ;;
    preprod)
        [[ "$CONTAINER_PREFIX" == "preprod-" ]] || CONTAINER_PREFIX="preprod-"
        [[ "$COMPOSE_FILE" == "docker-compose.preprod.yml" ]] || COMPOSE_FILE="docker-compose.preprod.yml"
        ;;
esac

# Fixed container names for infrastructure (never change, regardless of env)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"

validate_container_name() {
    local container="$1"
    [[ "$container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]
}

container_running() {
    local container="$1"
    docker ps --format '{{.Names}}' | grep -Fxq "$container"
}

container_host_port() {
    local container="$1"
    local container_port="$2"

    docker port "$container" "$container_port" 2>/dev/null | head -n 1 | sed -E 's#.*:([0-9]+)$#\1#'
}

declare -A SERVICE_STATUS
declare -A SERVICE_DETAILS

SERVICE_STATUS["postgres"]="unknown"
SERVICE_STATUS["dragonfly"]="unknown"

SERVICE_DETAILS["postgres"]='{"status":"unknown"}'
SERVICE_DETAILS["dragonfly"]='{"status":"unknown"}'

set_service_status() {
    local service="$1"
    local status="$2"
    local details="$3"

    SERVICE_STATUS["$service"]="$status"
    SERVICE_DETAILS["$service"]="$details"
}

compose_file() {
    local candidates=(
        "${BASE_DIR}/devops/docker/${COMPOSE_FILE}"
        "$(cd "$(dirname "${BASH_SOURCE[0]}")/../docker" 2>/dev/null && pwd)/${COMPOSE_FILE}"
        "/tmp/${COMPOSE_FILE}"
    )

    for candidate in "${candidates[@]}"; do
        if [[ -f "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done

    return 1
}

auto_recreate_enabled() {
    local flag="${AUTO_RECREATE_SERVICES:-${AUTO_RECREATE_MISSING:-false}}"
    [[ "$flag" == "true" ]]
}

recreate_service() {
    local service="$1"
    local label="$2"

    if ! auto_recreate_enabled; then
        return 1
    fi

    local compose
    if ! compose=$(compose_file); then
        set_service_status "$service" "missing" "{\"status\":\"missing\",\"error\":\"Compose file not found\"}"
        return 1
    fi

    echo "INFO: Auto-recreating ${label} using docker compose" >&2
    if docker compose -f "$compose" up -d --no-deps --force-recreate "$service" >/dev/null 2>&1; then
        sleep 5
        return 0
    fi

    echo "WARNING: Failed to recreate ${label} using docker compose" >&2
    return 1
}

postgres_healthy() {
    local container="postgres"

    docker exec "$container" pg_isready -U postgres -d userdb >/dev/null 2>&1 && \
        docker exec "$container" psql -U postgres -d userdb -c "SELECT 1" >/dev/null 2>&1
}

dragonfly_healthy() {
    local container="dragonfly"

    docker exec "$container" redis-cli -p 6379 ping >/dev/null 2>&1
}

check_postgres() {
    local container="postgres"

    if ! validate_container_name "$container"; then
        set_service_status "postgres" "invalid" '{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi

    if container_running "$container"; then
        if postgres_healthy; then
            set_service_status "postgres" "healthy" '{"status":"healthy","ready":true,"port":5432}'
            return 0
        fi

        if recreate_service "postgres" "PostgreSQL" && container_running "$container" && postgres_healthy; then
            set_service_status "postgres" "healthy" '{"status":"healthy","ready":true,"port":5432,"recreated":true}'
            return 0
        fi

        set_service_status "postgres" "unhealthy" '{"status":"unhealthy","error":"PostgreSQL probe failed"}'
        return 1
    fi

    if recreate_service "postgres" "PostgreSQL" && container_running "$container" && postgres_healthy; then
        set_service_status "postgres" "healthy" '{"status":"healthy","ready":true,"port":5432,"recreated":true}'
        return 0
    fi

    set_service_status "postgres" "missing" '{"status":"missing","error":"Container not running"}'
    return 1
}

check_dragonfly() {
    local container="dragonfly"

    if ! validate_container_name "$container"; then
        set_service_status "dragonfly" "invalid" '{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi

    if container_running "$container"; then
        if dragonfly_healthy; then
            set_service_status "dragonfly" "healthy" '{"status":"healthy","ready":true,"port":6379,"ping":"PONG"}'
            return 0
        fi

        if recreate_service "dragonfly" "Dragonfly" && container_running "$container" && dragonfly_healthy; then
            set_service_status "dragonfly" "healthy" '{"status":"healthy","ready":true,"port":6379,"ping":"PONG","recreated":true}'
            return 0
        fi

        set_service_status "dragonfly" "unhealthy" '{"status":"unhealthy","error":"PING failed"}'
        return 1
    fi

    if recreate_service "dragonfly" "Dragonfly" && container_running "$container" && dragonfly_healthy; then
        set_service_status "dragonfly" "healthy" '{"status":"healthy","ready":true,"port":6379,"ping":"PONG","recreated":true}'
        return 0
    fi

    set_service_status "dragonfly" "missing" '{"status":"missing","error":"Container not running"}'
    return 1
}

emit_json() {
    local overall_status="$1"

    cat <<EOF
{
  "status": "${overall_status}",
  "services": {
    "postgres": ${SERVICE_DETAILS[postgres]},
    "dragonfly": ${SERVICE_DETAILS[dragonfly]}
  }
}
EOF
}

main() {
    local overall_status="healthy"
    local exit_code=0
    local missing_found=false
    local unhealthy_found=false

    check_postgres || true
    check_dragonfly || true

    for service in postgres dragonfly; do
        case "${SERVICE_STATUS[$service]}" in
            healthy)
                ;;
            missing)
                missing_found=true
                overall_status="missing"
                exit_code=3
                ;;
            unhealthy|invalid)
                unhealthy_found=true
                if [[ "$exit_code" -eq 0 ]]; then
                    exit_code=2
                fi
                if [[ "$overall_status" == "healthy" ]]; then
                    overall_status="unhealthy"
                fi
                ;;
            *)
                unhealthy_found=true
                if [[ "$exit_code" -eq 0 ]]; then
                    exit_code=1
                fi
                if [[ "$overall_status" == "healthy" ]]; then
                    overall_status="unknown"
                fi
                ;;
        esac
    done

    if [[ "$missing_found" == "true" ]]; then
        overall_status="missing"
        exit_code=3
    elif [[ "$unhealthy_found" == "true" ]] && [[ "$exit_code" -eq 0 ]]; then
        overall_status="unhealthy"
        exit_code=2
    fi

    emit_json "$overall_status"
    exit "$exit_code"
}

main "$@"
