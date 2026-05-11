#!/bin/bash
# Infrastructure health check for the deployment stack.
# Checks only PostgreSQL, Dragonfly, and Portainer.

set -euo pipefail

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
SERVICE_STATUS["portainer"]="unknown"

SERVICE_DETAILS["postgres"]='{"status":"unknown"}'
SERVICE_DETAILS["dragonfly"]='{"status":"unknown"}'
SERVICE_DETAILS["portainer"]='{"status":"unknown"}'

set_service_status() {
    local service="$1"
    local status="$2"
    local details="$3"

    SERVICE_STATUS["$service"]="$status"
    SERVICE_DETAILS["$service"]="$details"
}

check_postgres() {
    local container="postgres"

    if ! validate_container_name "$container"; then
        set_service_status "postgres" "invalid" '{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi

    if ! container_running "$container"; then
        set_service_status "postgres" "missing" '{"status":"missing","error":"Container not running"}'
        return 1
    fi

    if docker exec "$container" pg_isready -U postgres -d userdb >/dev/null 2>&1; then
        if docker exec "$container" psql -U postgres -d userdb -c "SELECT 1" >/dev/null 2>&1; then
            set_service_status "postgres" "healthy" '{"status":"healthy","ready":true,"port":5432}'
            return 0
        fi

        set_service_status "postgres" "unhealthy" '{"status":"unhealthy","error":"Test query failed"}'
        return 1
    fi

    set_service_status "postgres" "unhealthy" '{"status":"unhealthy","error":"pg_isready failed"}'
    return 1
}

check_dragonfly() {
    local container="dragonfly"

    if ! validate_container_name "$container"; then
        set_service_status "dragonfly" "invalid" '{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi

    if ! container_running "$container"; then
        set_service_status "dragonfly" "missing" '{"status":"missing","error":"Container not running"}'
        return 1
    fi

    if docker exec "$container" redis-cli -p 6379 ping >/dev/null 2>&1; then
        set_service_status "dragonfly" "healthy" '{"status":"healthy","ready":true,"port":6379,"ping":"PONG"}'
        return 0
    fi

    set_service_status "dragonfly" "unhealthy" '{"status":"unhealthy","error":"PING failed"}'
    return 1
}

check_portainer() {
    local container="portainer"
    local container_port="9000/tcp"
    local host_port

    if ! validate_container_name "$container"; then
        set_service_status "portainer" "invalid" '{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi

    if ! container_running "$container"; then
        set_service_status "portainer" "missing" '{"status":"missing","error":"Container not running"}'
        return 1
    fi

    local docker_health
    docker_health="$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")"

    if [[ "$docker_health" == "healthy" ]]; then
        set_service_status "portainer" "healthy" '{"status":"healthy","ready":true,"port":9000,"health":"docker"}'
        return 0
    fi

    if [[ "$docker_health" == "restarting" ]]; then
        set_service_status "portainer" "unhealthy" '{"status":"unhealthy","error":"Container restarting"}'
        return 1
    fi

    host_port="$(container_host_port "$container" "$container_port")"
    if [[ -z "$host_port" ]]; then
        set_service_status "portainer" "unhealthy" '{"status":"unhealthy","error":"Port mapping unavailable"}'
        return 1
    fi

    local attempt=0
    local max_attempts=6
    while [[ $attempt -lt $max_attempts ]]; do
        attempt=$((attempt + 1))

        if command -v curl >/dev/null 2>&1; then
            if curl -fsS --max-time 3 "http://127.0.0.1:${host_port}/api/status" >/dev/null 2>&1; then
                set_service_status "portainer" "healthy" '{"status":"healthy","ready":true,"port":9000,"health":"api"}'
                return 0
            fi
        elif command -v wget >/dev/null 2>&1; then
            if wget -q --spider --timeout=3 "http://127.0.0.1:${host_port}/api/status" >/dev/null 2>&1; then
                set_service_status "portainer" "healthy" '{"status":"healthy","ready":true,"port":9000,"health":"api"}'
                return 0
            fi
        fi

        if [[ $attempt -lt $max_attempts ]]; then
            sleep 5
        fi
    done

    set_service_status "portainer" "unhealthy" '{"status":"unhealthy","error":"Health endpoint failed"}'
    return 1
}

emit_json() {
    local overall_status="$1"

    cat <<EOF
{
  "status": "${overall_status}",
  "services": {
    "postgres": ${SERVICE_DETAILS[postgres]},
    "dragonfly": ${SERVICE_DETAILS[dragonfly]},
    "portainer": ${SERVICE_DETAILS[portainer]}
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
    check_portainer || true

    for service in postgres dragonfly portainer; do
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
