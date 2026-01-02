#!/bin/bash
# Infrastructure Health Check Script
# Checks the health of all infrastructure services (PostgreSQL, Dragonfly, OpenVidu)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source utils.sh - handle both normal directory structure and /tmp/ execution
# Check if utils.sh functions are already available (sourced by workflow)
if ! command -v log_info &>/dev/null; then
    # Try relative path first (normal execution from devops/scripts/docker-infra/)
    if [[ -f "${SCRIPT_DIR}/../shared/utils.sh" ]]; then
        source "${SCRIPT_DIR}/../shared/utils.sh"
    # Fall back to /tmp/utils.sh (when executed from /tmp/ by GitHub Actions)
    elif [[ -f "/tmp/utils.sh" ]]; then
        source "/tmp/utils.sh"
    else
        echo "ERROR: Cannot find utils.sh. Tried:" >&2
        echo "  - ${SCRIPT_DIR}/../shared/utils.sh" >&2
        echo "  - /tmp/utils.sh" >&2
        exit 1
    fi
fi

# Services to check
SERVICES=("postgres" "dragonfly" "openvidu-server")
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"
OPENVIDU_CONTAINER="openvidu-server"

# Exit codes
EXIT_HEALTHY=0
EXIT_MINOR_ISSUES=1
EXIT_CRITICAL=2
EXIT_MISSING=3

# Results
declare -A SERVICE_STATUS
declare -A SERVICE_DETAILS

# Check PostgreSQL
check_postgres() {
    local container="${POSTGRES_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        SERVICE_STATUS["postgres"]="invalid"
        SERVICE_DETAILS["postgres"]='{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi
    
    local status="unhealthy"
    local details="{}"
    
    if ! container_running "$container"; then
        SERVICE_STATUS["postgres"]="missing"
        SERVICE_DETAILS["postgres"]='{"status":"missing","error":"Container not running"}'
        return 1
    fi
    
    # Check if pg_isready works
    if docker exec "$container" pg_isready -U postgres -d userdb >/dev/null 2>&1; then
        # Test query
        if docker exec "$container" psql -U postgres -d userdb -c "SELECT 1" >/dev/null 2>&1; then
            status="healthy"
            # Get database size
            local db_size=$(docker exec "$container" psql -U postgres -d userdb -t -c "SELECT pg_size_pretty(pg_database_size('userdb'));" 2>/dev/null | xargs || echo "unknown")
            details="{\"status\":\"healthy\",\"database_size\":\"${db_size}\",\"ready\":true}"
        else
            status="unhealthy"
            details='{"status":"unhealthy","error":"Test query failed"}'
        fi
    else
        status="unhealthy"
        details='{"status":"unhealthy","error":"pg_isready failed"}'
    fi
    
    SERVICE_STATUS["postgres"]="$status"
    SERVICE_DETAILS["postgres"]="$details"
    
    if [[ "$status" == "healthy" ]]; then
        return 0
    else
        return 1
    fi
}

# Check Dragonfly
check_dragonfly() {
    local container="${DRAGONFLY_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        SERVICE_STATUS["dragonfly"]="invalid"
        SERVICE_DETAILS["dragonfly"]='{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi
    
    local status="unhealthy"
    local details="{}"
    
    if ! container_running "$container"; then
        SERVICE_STATUS["dragonfly"]="missing"
        SERVICE_DETAILS["dragonfly"]='{"status":"missing","error":"Container not running"}'
        return 1
    fi
    
    # Check PING
    if docker exec "$container" redis-cli -p 6379 ping >/dev/null 2>&1; then
        # Get INFO
        local info=$(docker exec "$container" redis-cli -p 6379 INFO 2>/dev/null || echo "")
        local key_count=$(echo "$info" | grep "^db0:keys" | cut -d= -f2 | cut -d, -f1 || echo "0")
        local memory=$(echo "$info" | grep "^used_memory_human" | cut -d: -f2 | xargs || echo "unknown")
        
        status="healthy"
        details="{\"status\":\"healthy\",\"keys\":${key_count},\"memory\":\"${memory}\",\"ping\":\"PONG\"}"
    else
        status="unhealthy"
        details='{"status":"unhealthy","error":"PING failed"}'
    fi
    
    SERVICE_STATUS["dragonfly"]="$status"
    SERVICE_DETAILS["dragonfly"]="$details"
    
    if [[ "$status" == "healthy" ]]; then
        return 0
    else
        return 1
    fi
}

# Check Coturn
check_coturn() {
    local container="${COTURN_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        SERVICE_STATUS["coturn"]="invalid"
        SERVICE_DETAILS["coturn"]='{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi
    
    local status="unhealthy"
    local details="{}"
    
    if ! container_running "$container"; then
        SERVICE_STATUS["coturn"]="missing"
        SERVICE_DETAILS["coturn"]='{"status":"missing","error":"Container not running"}'
        return 1
    fi
    
    # Check TURN/STUN server via turnutils_stunclient
    if docker exec "$container" turnutils_stunclient -p 3478 localhost > /dev/null 2>&1; then
        status="healthy"
        details="{\"status\":\"healthy\",\"port\":\"3478\",\"protocol\":\"STUN/TURN\"}"
    else
        status="unhealthy"
        details="{\"status\":\"unhealthy\",\"error\":\"STUN/TURN check failed\"}"
    fi
    
    SERVICE_STATUS["coturn"]="$status"
    SERVICE_DETAILS["coturn"]="$details"
    
    if [[ "$status" == "healthy" ]]; then
        return 0
    else
        return 1
    fi
}

# Check Portainer
check_portainer() {
    local container="portainer"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        SERVICE_STATUS["portainer"]="invalid"
        SERVICE_DETAILS["portainer"]='{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi
    
    local status="unhealthy"
    local details="{}"
    
    if ! container_running "$container"; then
        SERVICE_STATUS["portainer"]="missing"
        SERVICE_DETAILS["portainer"]='{"status":"missing","error":"Container not running"}'
        return 1
    fi
    
    # Check if Portainer API is responding
    if docker exec "$container" wget -q --spider http://localhost:9000 2>/dev/null; then
        status="healthy"
        details="{\"status\":\"healthy\",\"port\":\"9000\",\"ui\":\"accessible\"}"
    else
        status="unhealthy"
        details="{\"status\":\"unhealthy\",\"error\":\"API not responding\"}"
    fi
    
    SERVICE_STATUS["portainer"]="$status"
    SERVICE_DETAILS["portainer"]="$details"
    
    if [[ "$status" == "healthy" ]]; then
        return 0
    else
        return 1
    fi
}

# Check OpenVidu
check_openvidu() {
    local container="${OPENVIDU_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        SERVICE_STATUS["openvidu"]="invalid"
        SERVICE_DETAILS["openvidu"]='{"status":"invalid","error":"Invalid container name"}'
        return 1
    fi
    
    local status="unhealthy"
    local details="{}"
    
    if ! container_running "$container"; then
        SERVICE_STATUS["openvidu"]="missing"
        SERVICE_DETAILS["openvidu"]='{"status":"missing","error":"Container not running"}'
        return 1
    fi
    
    # Check health via supervisorctl
    if docker exec "$container" supervisorctl status >/dev/null 2>&1; then
        status="healthy"
        details='{"status":"healthy","supervisor":"running"}'
    else
        status="unhealthy"
        details='{"status":"unhealthy","error":"supervisorctl check failed"}'
    fi
    
    SERVICE_STATUS["openvidu"]="$status"
    SERVICE_DETAILS["openvidu"]="$details"
    
    if [[ "$status" == "healthy" ]]; then
        return 0
    else
        return 1
    fi
}

# Main execution
main() {
    log_info "Starting infrastructure health check..."
    
    check_docker || exit $EXIT_CRITICAL
    
    local all_healthy=true
    local any_missing=false
    local any_unhealthy=false
    
    # Check each service
    check_postgres || {
        if [[ "${SERVICE_STATUS[postgres]}" == "missing" ]]; then
            any_missing=true
        else
            any_unhealthy=true
        fi
        all_healthy=false
    }
    
    check_dragonfly || {
        if [[ "${SERVICE_STATUS[dragonfly]}" == "missing" ]]; then
            any_missing=true
        else
            any_unhealthy=true
        fi
        all_healthy=false
    }
    
    # Check Coturn
    check_coturn || {
        if [[ "${SERVICE_STATUS[coturn]}" == "missing" ]]; then
            any_missing=true
        else
            any_unhealthy=true
        fi
        all_healthy=false
    }
    
    # Check Portainer
    check_portainer || {
        if [[ "${SERVICE_STATUS[portainer]}" == "missing" ]]; then
            any_missing=true
        else
            any_unhealthy=true
        fi
        all_healthy=false
    }
    
    # Check OpenVidu
    check_openvidu || {
        if [[ "${SERVICE_STATUS[openvidu]}" == "missing" ]]; then
            any_missing=true
        else
            any_unhealthy=true
        fi
        all_healthy=false
    }
    
    # Determine overall status
    local overall_status="healthy"
    if $any_missing; then
        overall_status="missing"
    elif $any_unhealthy; then
        overall_status="unhealthy"
    fi
    
    # Generate JSON output
    {
        json_start
        json_string "status" "$overall_status"
        json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "  \"services\": {"
        echo "    \"postgres\": ${SERVICE_DETAILS[postgres]},"
        echo "    \"dragonfly\": ${SERVICE_DETAILS[dragonfly]},"
        echo "    \"openvidu\": ${SERVICE_DETAILS[openvidu]}"
        echo "  }"
        json_end
    } | json_fix_trailing
    
    # Set exit code
    if $all_healthy; then
        exit $EXIT_HEALTHY
    elif $any_missing; then
        exit $EXIT_MISSING
    elif $any_unhealthy; then
        exit $EXIT_CRITICAL
    else
        exit $EXIT_MINOR_ISSUES
    fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

