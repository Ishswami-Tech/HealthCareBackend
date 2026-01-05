#!/bin/bash
# Diagnostic Script - Auto-debugging infrastructure issues
# Collects diagnostics and attempts auto-fix

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source utils.sh - handle both normal directory structure and /tmp/ execution
if ! command -v log_info &>/dev/null; then
    if [[ -f "${SCRIPT_DIR}/../shared/utils.sh" ]]; then
        source "${SCRIPT_DIR}/../shared/utils.sh"
    elif [[ -f "/opt/healthcare-backend/devops/scripts/shared/utils.sh" ]]; then
        source "/opt/healthcare-backend/devops/scripts/shared/utils.sh"
    elif [[ -f "/tmp/utils.sh" ]]; then
        source "/tmp/utils.sh"
    else
        echo "ERROR: Cannot find utils.sh" >&2
        exit 1
    fi
fi

# Container prefix (only for app containers, infrastructure uses fixed names)
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"
OPENVIDU_CONTAINER="openvidu-server"
SERVICES=("postgres" "dragonfly" "openvidu-server")

# Collect diagnostics
collect_diagnostics() {
    log_info "Collecting diagnostics..."
    
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local issues=()
    local resource_usage="{}"
    local logs="{}"
    
    # Check each service
    for service in "${SERVICES[@]}"; do
        # Use fixed names for infrastructure services
        case "$service" in
            postgres)
                local container="${POSTGRES_CONTAINER}"
                ;;
            dragonfly)
                local container="${DRAGONFLY_CONTAINER}"
                ;;
            openvidu-server)
                local container="${OPENVIDU_CONTAINER}"
                ;;
            *)
                local container="${CONTAINER_PREFIX}${service}"
                ;;
        esac
        
        # Security: Validate container name
        if ! validate_container_name "$container"; then
            issues+=("{\"service\":\"${service}\",\"severity\":\"critical\",\"issue\":\"Invalid container name\",\"details\":\"Container name validation failed\"}")
            continue
        fi
        
        local status=$(get_container_status "$container")
        
        if [[ "$status" != "running" ]]; then
            issues+=("{\"service\":\"${service}\",\"severity\":\"critical\",\"issue\":\"Container status: ${status}\",\"details\":\"Container is not running\"}")
            
            # Get logs (container name already validated)
            local service_logs=$(docker logs --tail 100 "$container" 2>&1 | head -20 || echo "No logs available")
            logs="${logs%?},\"${service}\":[\"$(echo "$service_logs" | sed 's/"/\\"/g' | tr '\n' '|')\"]}"
        fi
    done
    
    # Resource usage
    if command_exists docker; then
        local cpu=$(docker stats --no-stream --format "{{.CPUPerc}}" 2>/dev/null | head -1 || echo "unknown")
        local mem=$(docker stats --no-stream --format "{{.MemUsage}}" 2>/dev/null | head -1 || echo "unknown")
        resource_usage="{\"cpu\":\"${cpu}\",\"memory\":\"${mem}\"}"
    fi
    
    # Output JSON
    {
        json_start
        json_string "timestamp" "$timestamp"
        echo "  \"issues\": ["
        for issue in "${issues[@]}"; do
            echo "    ${issue},"
        done | sed '$ s/,$//'
        echo "  ],"
        json_object "resource_usage" "$resource_usage"
        json_object "logs" "$logs"
        json_end
    } | json_fix_trailing
}

# Attempt auto-fix
auto_fix() {
    log_info "Attempting auto-fix..."
    
    local fixed=false
    
    for service in "${SERVICES[@]}"; do
        # Use fixed names for infrastructure services
        case "$service" in
            postgres)
                local container="${POSTGRES_CONTAINER}"
                ;;
            dragonfly)
                local container="${DRAGONFLY_CONTAINER}"
                ;;
            openvidu-server)
                local container="${OPENVIDU_CONTAINER}"
                ;;
            *)
                local container="${CONTAINER_PREFIX}${service}"
                ;;
        esac
        local status=$(get_container_status "$container")
        
        if [[ "$status" == "exited" ]] || [[ "$status" == "stopped" ]]; then
            log_info "Attempting to start ${container}..."
            if docker start "$container" >/dev/null 2>&1; then
                wait_for_health "$container" 60 && {
                    log_success "Fixed: ${container} started successfully"
                    fixed=true
                }
            fi
        elif [[ "$status" == "restarting" ]]; then
            log_info "Container ${container} is restarting, checking logs..."
            docker logs --tail 50 "$container" 2>&1 | grep -i "error\|fatal\|panic" || true
        fi
    done
    
    if $fixed; then
        return 0
    else
        return 1
    fi
}

# Main execution
main() {
    check_docker || exit 1
    
    # Collect diagnostics
    local diagnostics=$(collect_diagnostics)
    echo "$diagnostics"
    
    # Attempt auto-fix
    if auto_fix; then
        log_success "Auto-fix succeeded"
        exit 0
    else
        log_warning "Auto-fix failed or not applicable"
        exit 1
    fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

