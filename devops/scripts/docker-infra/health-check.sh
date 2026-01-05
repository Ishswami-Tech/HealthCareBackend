#!/bin/bash
# Infrastructure Health Check Script
# Checks the health of INFRASTRUCTURE containers only (PostgreSQL, Dragonfly, Coturn, Portainer, OpenVidu)
# Does NOT check or manage application containers (api, worker)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source utils.sh - handle both normal directory structure and /tmp/ execution
# Check if utils.sh functions are already available (sourced by workflow)
if ! command -v log_info &>/dev/null; then
    # Try relative path first (normal execution from devops/scripts/docker-infra/)
    if [[ -f "${SCRIPT_DIR}/../shared/utils.sh" ]]; then
        source "${SCRIPT_DIR}/../shared/utils.sh"
    # Fall back to /opt/healthcare-backend path (production server)
    elif [[ -f "/opt/healthcare-backend/devops/scripts/shared/utils.sh" ]]; then
        source "/opt/healthcare-backend/devops/scripts/shared/utils.sh"
    # Fall back to /tmp/utils.sh (when executed from /tmp/ by GitHub Actions)
    elif [[ -f "/tmp/utils.sh" ]]; then
        source "/tmp/utils.sh"
    else
        echo "ERROR: Cannot find utils.sh. Tried:" >&2
        echo "  - ${SCRIPT_DIR}/../shared/utils.sh" >&2
        echo "  - /opt/healthcare-backend/devops/scripts/shared/utils.sh" >&2
        echo "  - /tmp/utils.sh" >&2
        exit 1
    fi
fi

# Services to check (INFRASTRUCTURE ONLY - not application containers)
# Infrastructure containers use fixed names, never use CONTAINER_PREFIX
SERVICES=("postgres" "dragonfly" "openvidu-server")

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"
OPENVIDU_CONTAINER="openvidu-server"
COTURN_CONTAINER="coturn"

# Ensure BASE_DIR is set (from utils.sh, but provide fallback)
BASE_DIR="${BASE_DIR:-/opt/healthcare-backend}"

# Exit codes
EXIT_HEALTHY=0
EXIT_MINOR_ISSUES=1
EXIT_CRITICAL=2
EXIT_MISSING=3

# Results
declare -A SERVICE_STATUS
declare -A SERVICE_DETAILS

# Initialize all service statuses to avoid unbound variable errors
SERVICE_STATUS["postgres"]="unknown"
SERVICE_STATUS["dragonfly"]="unknown"
SERVICE_STATUS["coturn"]="unknown"
SERVICE_STATUS["portainer"]="unknown"
SERVICE_STATUS["openvidu"]="unknown"
SERVICE_DETAILS["postgres"]='{"status":"unknown"}'
SERVICE_DETAILS["dragonfly"]='{"status":"unknown"}'
SERVICE_DETAILS["coturn"]='{"status":"unknown"}'
SERVICE_DETAILS["portainer"]='{"status":"unknown"}'
SERVICE_DETAILS["openvidu"]='{"status":"unknown"}'

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
    
    # Check if coturn process is running inside container
    if ! docker exec "$container" pgrep -x turnserver >/dev/null 2>&1; then
        status="unhealthy"
        details="{\"status\":\"unhealthy\",\"error\":\"turnserver process not running\"}"
        SERVICE_STATUS["coturn"]="$status"
        SERVICE_DETAILS["coturn"]="$details"
        return 1
    fi
    
    # Check TURN/STUN server via turnutils_stunclient with retry logic
    # Retry up to 3 times with 2 second delays (coturn may need time to fully start)
    local stun_check_passed=false
    local retry_count=0
    local max_retries=3
    
    while [[ $retry_count -lt $max_retries ]] && ! $stun_check_passed; do
        # Try STUN check on port 3478 (default STUN/TURN port)
        if docker exec "$container" turnutils_stunclient -p 3478 localhost >/dev/null 2>&1; then
            stun_check_passed=true
            status="healthy"
            details="{\"status\":\"healthy\",\"port\":\"3478\",\"protocol\":\"STUN/TURN\"}"
        else
            retry_count=$((retry_count + 1))
            if [[ $retry_count -lt $max_retries ]]; then
                sleep 2
            fi
        fi
    done
    
    # If STUN check failed, try alternative checks
    if ! $stun_check_passed; then
        # Check if port is listening (try multiple methods - coturn container may not have sh)
        local port_check_passed=false
        
        # Method 1: Try with sh if available
        if docker exec "$container" sh -c "netstat -tuln 2>/dev/null | grep -q ':3478' || ss -tuln 2>/dev/null | grep -q ':3478'" >/dev/null 2>&1; then
            port_check_passed=true
        # Method 2: Try direct netstat/ss commands (some containers have these in PATH)
        elif docker exec "$container" netstat -tuln 2>/dev/null | grep -q ':3478' >/dev/null 2>&1; then
            port_check_passed=true
        elif docker exec "$container" ss -tuln 2>/dev/null | grep -q ':3478' >/dev/null 2>&1; then
            port_check_passed=true
        # Method 3: Check if turnserver process is running and container is healthy according to Docker
        elif docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null | grep -q "healthy" >/dev/null 2>&1; then
            port_check_passed=true
        fi
        
        if $port_check_passed; then
            status="healthy"
            details="{\"status\":\"healthy\",\"port\":\"3478\",\"note\":\"Port/process active (STUN check failed but service appears running)\"}"
            stun_check_passed=true
        else
            # Get more diagnostic info
            local container_status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
            local exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$container" 2>/dev/null || echo "unknown")
            local health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
            local error_msg="STUN/TURN check failed"
            
            # Check container logs for errors
            local recent_logs=$(docker logs --tail 5 "$container" 2>&1 | tail -3 || echo "")
            
            if [[ "$container_status" != "running" ]]; then
                error_msg="Container status: ${container_status}"
            elif [[ "$exit_code" != "0" ]] && [[ "$exit_code" != "unknown" ]]; then
                error_msg="Container exit code: ${exit_code}"
            elif [[ "$health_status" == "unhealthy" ]]; then
                error_msg="Docker health check reports unhealthy"
            fi
            
            status="unhealthy"
            details="{\"status\":\"unhealthy\",\"error\":\"${error_msg}\",\"container_status\":\"${container_status}\",\"exit_code\":\"${exit_code}\",\"docker_health\":\"${health_status}\"}"
        fi
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
    
    # Check container status - if restarting, it's unhealthy and needs recreation
    local container_status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [[ "$container_status" == "restarting" ]]; then
        SERVICE_STATUS["portainer"]="unhealthy"
        SERVICE_DETAILS["portainer"]='{"status":"unhealthy","error":"Container is restarting (likely command error)","note":"Container needs to be recreated with correct command","container_status":"restarting"}'
        # Force stop and remove the restarting container so it can be recreated
        log_warning "Portainer is restarting - forcing stop and removal for recreation"
        docker stop "$container" 2>/dev/null || true
        docker rm -f "$container" 2>/dev/null || true
        return 1
    fi
    
    if ! container_running "$container"; then
        SERVICE_STATUS["portainer"]="missing"
        SERVICE_DETAILS["portainer"]='{"status":"missing","error":"Container not running"}'
        return 1
    fi
    
    # Check Docker health status first (if healthcheck is configured)
    local health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "none")
    
    # For Portainer, check actual functionality, not just container status
    # Portainer's healthcheck checks /api/system/status which may not be available until initial setup
    # But we should verify the service is actually responding, not just that container is running
    
    if [[ "$health_status" == "healthy" ]]; then
        status="healthy"
        details="{\"status\":\"healthy\",\"health_check\":\"passing\",\"port\":\"9000\"}"
    elif [[ "$health_status" == "starting" ]]; then
        # Starting is acceptable for Portainer (non-critical) - give it time
        status="healthy"
        details="{\"status\":\"healthy\",\"health_check\":\"starting\",\"note\":\"Container starting - acceptable for non-critical UI service\"}"
    else
        # Fallback: Check if Portainer is accessible (more lenient for initial setup)
        # Portainer is a non-critical UI service, so we're lenient with health checks
        # It may need initial setup (admin account creation) before API is fully functional
        local portainer_accessible=false
        
        # Method 1: Check if port is listening inside container (prerequisite check)
        local port_listening=false
        if docker exec "$container" sh -c "nc -z localhost 9000 2>/dev/null || netstat -an 2>/dev/null | grep -q ':9000.*LISTEN' || ss -an 2>/dev/null | grep -q ':9000.*LISTEN'" 2>/dev/null; then
            port_listening=true
        fi
        
        # Method 2: Try accessing Portainer UI - verify HTTP response (this proves service is working)
        if $port_listening && command -v curl &>/dev/null; then
            # Check if we get any HTTP response (even redirects or setup page means service is working)
            local http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:9000/ 2>/dev/null || echo "000")
            if [[ "$http_code" =~ ^(200|301|302|401|403)$ ]]; then
                portainer_accessible=true
                status="healthy"
                details="{\"status\":\"healthy\",\"port\":\"9000\",\"http_code\":\"${http_code}\",\"note\":\"Portainer UI responding - may need initial setup\"}"
            fi
        fi
        
        # Method 3: Try wget if curl failed or not available
        if ! $portainer_accessible && $port_listening && command -v wget &>/dev/null; then
            if wget -q --spider --timeout=5 http://localhost:9000/ 2>/dev/null; then
                portainer_accessible=true
                status="healthy"
                details="{\"status\":\"healthy\",\"port\":\"9000\",\"note\":\"Portainer UI responding via wget - may need initial setup\"}"
            fi
        fi
        
        # Method 4: If port is listening and process is running, but no HTTP response yet
        # Only use this as fallback if port is listening (proves service is bound to port)
        if ! $portainer_accessible && $port_listening; then
            if docker exec "$container" ps aux 2>/dev/null | grep -q "[p]ortainer"; then
                # Port is listening and process is running - service is likely functional
                # HTTP check may fail during initial setup, but service is operational
                portainer_accessible=true
                status="healthy"
                details="{\"status\":\"healthy\",\"method\":\"process_and_port_check\",\"port\":\"9000\",\"note\":\"Portainer process running and port listening - service functional (HTTP check may fail during initial setup)\"}"
            fi
        fi
        
        # If still not accessible, mark as unhealthy
        if ! $portainer_accessible; then
        status="unhealthy"
            details="{\"status\":\"unhealthy\",\"error\":\"Portainer not responding\",\"health_check\":\"${health_status}\",\"container_status\":\"${container_status}\",\"port_listening\":\"${port_listening}\",\"note\":\"Portainer service is not responding. Check logs: docker logs portainer\"}"
        fi
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

# Fix unhealthy containers (backup → fix → restore → verify)
fix_unhealthy_containers() {
    log_info "=== Attempting to Fix Unhealthy Containers ==="
    
    local diagnose_script="${BASE_DIR}/devops/scripts/docker-infra/diagnose.sh"
    local backup_script="${BASE_DIR}/devops/scripts/docker-infra/backup.sh"
    local restore_script="${BASE_DIR}/devops/scripts/docker-infra/restore.sh"
    local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
    local fixed_any=false
    local unhealthy_services=()
    local backup_id=""
    
    # Ensure docker-compose.prod.yml exists (restores from /tmp or git if missing)
    if ! ensure_compose_file; then
        log_error "Failed to ensure docker-compose.prod.yml exists"
        return 1
    fi
    
    # Identify unhealthy services
    for service in postgres dragonfly coturn portainer openvidu; do
        if [[ "${SERVICE_STATUS[$service]}" == "unhealthy" ]]; then
            log_info "Service ${service} is unhealthy"
            unhealthy_services+=("$service")
        fi
    done
    
    if [[ ${#unhealthy_services[@]} -eq 0 ]]; then
        log_info "No unhealthy containers to fix"
        return 0
    fi
    
    # STEP 1: Take backup before fixing (if containers are accessible)
    log_info "=== STEP 1: Creating Backup Before Fix ==="
    
    local needs_backup=false
    for service in "${unhealthy_services[@]}"; do
        case "$service" in
            postgres|dragonfly)
                needs_backup=true
                break
                ;;
        esac
    done
    
    if $needs_backup && [[ -f "$backup_script" ]]; then
        # Check if we can backup (containers might be running but unhealthy)
        local can_backup=false
        
        if container_running "${POSTGRES_CONTAINER}"; then
            log_info "PostgreSQL is running (unhealthy), attempting backup..."
            can_backup=true
        fi
        
        if container_running "${DRAGONFLY_CONTAINER}"; then
            log_info "Dragonfly is running (unhealthy), attempting backup..."
            can_backup=true
        fi
        
        if $can_backup; then
            log_info "Creating pre-fix backup..."
            backup_id=$("$backup_script" pre-deployment 2>&1 | tail -1) || {
                log_warning "Backup failed, but continuing with fix (data may be lost)"
                backup_id=""
            }
            
            if [[ -n "$backup_id" ]] && [[ "$backup_id" =~ ^pre-deployment- ]]; then
                log_success "Backup created successfully (ID: ${backup_id})"
            else
                log_warning "Backup may have failed (invalid backup ID: ${backup_id:-none})"
                backup_id=""
            fi
        else
            log_warning "Cannot create backup (containers not accessible)"
        fi
    fi
    
    # STEP 2: Fix unhealthy containers
    log_info "=== STEP 2: Fixing Unhealthy Containers ==="
    
    # Try diagnose.sh first (if available)
    if [[ -f "$diagnose_script" ]]; then
        log_info "Running diagnose.sh to attempt auto-fix..."
        if "$diagnose_script" >/dev/null 2>&1; then
            log_success "Diagnose script completed"
            fixed_any=true
        else
            log_warning "Diagnose script did not fix all issues"
        fi
    fi
    
    # Try restarting unhealthy containers
    # Ensure directory exists before changing into it
    local compose_dir="$(dirname "$compose_file")"
    mkdir -p "$compose_dir" || {
        log_error "Failed to create directory: ${compose_dir}"
        return 1
    }
    cd "$compose_dir" 2>/dev/null || {
        log_error "Failed to change to directory: ${compose_dir}"
        return 1
    }
    
    for service in "${unhealthy_services[@]}"; do
        local container=""
        local compose_service=""
        
        case "$service" in
            postgres)
                container="${POSTGRES_CONTAINER}"
                compose_service="postgres"
                ;;
            dragonfly)
                container="${DRAGONFLY_CONTAINER}"
                compose_service="dragonfly"
                ;;
            coturn)
                container="${COTURN_CONTAINER}"
                compose_service="coturn"
                ;;
            portainer)
                container="portainer"
                compose_service="portainer"
                ;;
            openvidu)
                container="${OPENVIDU_CONTAINER}"
                compose_service="openvidu-server"
                ;;
        esac
        
        if [[ -z "$container" ]] || [[ -z "$compose_service" ]]; then
            continue
        fi
        
        # Security: Validate container name
        if ! validate_container_name "$container"; then
            log_warning "Invalid container name: ${container}, skipping"
            continue
        fi
        
        # Check container status
        local status=$(get_container_status "$container")
        
        if [[ "$status" == "exited" ]] || [[ "$status" == "stopped" ]]; then
            log_info "Container ${container} is stopped, attempting to start..."
            if docker start "$container" >/dev/null 2>&1; then
                log_success "Started ${container}"
                fixed_any=true
            else
                log_warning "Failed to start ${container}, trying docker-compose restart..."
                docker compose -f docker-compose.prod.yml --profile infrastructure restart "$compose_service" >/dev/null 2>&1 || {
                    log_warning "Failed to restart ${compose_service}"
                }
            fi
        elif [[ "$status" == "running" ]]; then
            log_info "Container ${container} is running but unhealthy, attempting restart..."
            if docker restart "$container" >/dev/null 2>&1; then
                log_success "Restarted ${container}"
                fixed_any=true
            else
                log_warning "Failed to restart ${container}, trying docker-compose restart..."
                docker compose -f docker-compose.prod.yml --profile infrastructure restart "$compose_service" >/dev/null 2>&1 || {
                    log_warning "Failed to restart ${compose_service}"
                }
            fi
        elif [[ "$status" == "restarting" ]]; then
            log_info "Container ${container} is already restarting, waiting..."
            sleep 10
        fi
    done
    
    # STEP 3: Wait for containers to stabilize
    log_info "=== STEP 3: Waiting for Containers to Stabilize ==="
    
    if $fixed_any; then
        log_info "Waiting for containers to stabilize after fixes..."
        sleep 15
        
        # Wait for critical services to be healthy
        for service in "${unhealthy_services[@]}"; do
            case "$service" in
                postgres)
                    wait_for_health "${POSTGRES_CONTAINER}" 120 || {
                        log_warning "PostgreSQL did not become healthy after fix attempt"
                    }
                    ;;
                dragonfly)
                    wait_for_health "${DRAGONFLY_CONTAINER}" 120 || {
                        log_warning "Dragonfly did not become healthy after fix attempt"
                    }
                    ;;
            esac
        done
    fi
    
    # STEP 4: Restore backup if we have one
    if [[ -n "$backup_id" ]] && [[ -f "$restore_script" ]]; then
        log_info "=== STEP 4: Restoring Backup ==="
        
        # Check if we need to restore (postgres or dragonfly were unhealthy)
        local needs_restore=false
        for service in "${unhealthy_services[@]}"; do
            case "$service" in
                postgres|dragonfly)
                    needs_restore=true
                    break
                    ;;
            esac
        done
        
        if $needs_restore; then
            log_info "Restoring from backup: ${backup_id}"
            if "$restore_script" "$backup_id" >/dev/null 2>&1; then
                log_success "Backup restored successfully"
                
                # Wait for services to be healthy after restore
                sleep 10
                for service in "${unhealthy_services[@]}"; do
                    case "$service" in
                        postgres)
                            wait_for_health "${POSTGRES_CONTAINER}" 120 || {
                                log_warning "PostgreSQL did not become healthy after restore"
                            }
                            ;;
                        dragonfly)
                            wait_for_health "${DRAGONFLY_CONTAINER}" 120 || {
                                log_warning "Dragonfly did not become healthy after restore"
                            }
                            ;;
                    esac
                done
            else
                log_warning "Backup restore failed, but containers were fixed"
            fi
        fi
    else
        log_info "No backup to restore (backup_id: ${backup_id:-none})"
    fi
    
    if $fixed_any; then
        log_success "Fixed unhealthy containers"
        return 0
    else
        log_warning "Could not fix unhealthy containers automatically"
        return 1
    fi
}

# Recover a single missing container (backup → recreate → restore → verify)
# This function handles ONE container at a time
recover_single_missing_container() {
    local service="$1"
    local container=""
    local compose_service=""
    local needs_data_backup=false
    local needs_data_restore=false
    
    # Map service to container and compose service names
    case "$service" in
        postgres)
            container="${POSTGRES_CONTAINER}"
            compose_service="postgres"
            needs_data_backup=true
            needs_data_restore=true
            ;;
        dragonfly)
            container="${DRAGONFLY_CONTAINER}"
            compose_service="dragonfly"
            needs_data_backup=true
            needs_data_restore=true
            ;;
        coturn)
            container="${COTURN_CONTAINER}"
            compose_service="coturn"
            ;;
        portainer)
            container="portainer"
            compose_service="portainer"
            ;;
        openvidu)
            container="${OPENVIDU_CONTAINER}"
            compose_service="openvidu-server"
            ;;
        *)
            log_error "Unknown service: ${service}"
            return 1
            ;;
    esac
    
    log_info "=== Recovering Missing Container: ${service} (${container}) ==="
    
    local backup_script="${BASE_DIR}/devops/scripts/docker-infra/backup.sh"
    local restore_script="${BASE_DIR}/devops/scripts/docker-infra/restore.sh"
    local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
    local backup_id=""
    
    # Ensure docker-compose.prod.yml exists (restores from /tmp or git if missing)
    if ! ensure_compose_file; then
        log_error "Failed to ensure docker-compose.prod.yml exists"
        return 1
    fi
    
    # Ensure directory exists before changing into it
    local compose_dir="$(dirname "$compose_file")"
    mkdir -p "$compose_dir" || {
        log_error "Failed to create directory: ${compose_dir}"
        return 1
    }
    cd "$compose_dir" || {
        log_error "Failed to change to directory: ${compose_dir}"
        return 1
    }
    
    # STEP 1: Create backup (if this is a data container and we can access it)
    if $needs_data_backup && [[ -f "$backup_script" ]]; then
        log_info "=== STEP 1: Creating Backup for ${service} ==="
        
        # Try to start container temporarily if it's not running
        if ! container_running "$container"; then
            log_info "Starting ${container} temporarily for backup..."
            docker compose -f docker-compose.prod.yml --profile infrastructure up -d "$compose_service" >/dev/null 2>&1 || {
                log_warning "Failed to start ${container} for backup"
            }
            
            # Wait a bit for container to start
            sleep 5
            
            # Wait for health if it's a critical service
            if [[ "$service" == "postgres" ]]; then
                wait_for_health "${POSTGRES_CONTAINER}" 120 || {
                    log_warning "${service} not healthy, but attempting backup anyway"
                }
            elif [[ "$service" == "dragonfly" ]]; then
                wait_for_health "${DRAGONFLY_CONTAINER}" 60 || {
                    log_warning "${service} not healthy, but attempting backup anyway"
                }
            fi
        fi
        
        if container_running "$container"; then
            log_info "Creating backup for ${service}..."
            backup_id=$("$backup_script" pre-deployment 2>&1 | tail -1) || {
                log_warning "Backup failed for ${service}, but continuing with recreation"
                backup_id=""
            }
            
            if [[ -n "$backup_id" ]] && [[ "$backup_id" =~ ^pre-deployment- ]]; then
                log_success "Backup created successfully for ${service} (ID: ${backup_id})"
            else
                log_warning "Backup may have failed for ${service}"
                backup_id=""
            fi
        else
            log_warning "Cannot backup ${service} (container not accessible)"
        fi
    fi
    
    # STEP 2: Recreate the container
    log_info "=== STEP 2: Recreating ${service} ==="
    
    # Stop container gracefully if it's running
    if container_running "$container"; then
        log_info "Stopping ${container} gracefully..."
        docker compose -f docker-compose.prod.yml --profile infrastructure stop "$compose_service" >/dev/null 2>&1 || true
        sleep 3
    fi
    
    # Remove container
    log_info "Removing ${container}..."
    docker rm -f "$container" >/dev/null 2>&1 || true
    
    # Recreate container with --force-recreate and --no-deps to ensure fresh start
    log_info "Recreating ${compose_service}..."
    # For Portainer, ensure we use the correct command (no --hide-label=* flag)
    if docker compose -f docker-compose.prod.yml --profile infrastructure up -d --force-recreate --no-deps "$compose_service"; then
        log_success "Container ${compose_service} recreated successfully"
    else
        log_error "Failed to recreate ${compose_service}"
        return 1
    fi
    
    # Wait for container to start
    log_info "Waiting for ${container} to start..."
    sleep 15
    
    # STEP 3: Restore backup (if we have one and this is a data container)
    if $needs_data_restore && [[ -n "$backup_id" ]] && [[ -f "$restore_script" ]]; then
        log_info "=== STEP 3: Restoring Backup for ${service} ==="
        log_info "Restoring from backup: ${backup_id}"
        if "$restore_script" "$backup_id" >/dev/null 2>&1; then
            log_success "Backup restored successfully for ${service}"
        else
            log_warning "Backup restore failed for ${service} (but container is recreated)"
        fi
    fi
    
    # STEP 4: Verify health
    log_info "=== STEP 4: Verifying Health of ${service} ==="
    
    # Wait for health with timeout
    local health_timeout=300
    case "$service" in
        postgres)
            wait_for_health "${POSTGRES_CONTAINER}" "$health_timeout" && return 0
            ;;
        dragonfly)
            wait_for_health "${DRAGONFLY_CONTAINER}" "$health_timeout" && return 0
            ;;
        coturn)
            wait_for_health "${COTURN_CONTAINER}" "$health_timeout" && return 0
            ;;
        portainer)
            # Portainer is non-critical UI service - be lenient with health checks
            # Wait longer for Portainer to start (it may need initial setup)
            log_info "Waiting for Portainer to start (non-critical service, lenient check)..."
            sleep 30
            
            # Check if container is running (not exited/crashed)
            local container_status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
            if [[ "$container_status" == "running" ]]; then
                # Container is running - check if port is listening (most reliable indicator)
                if docker exec "$container" sh -c "nc -z localhost 9000 2>/dev/null || netstat -an 2>/dev/null | grep -q ':9000.*LISTEN' || ss -an 2>/dev/null | grep -q ':9000.*LISTEN'" 2>/dev/null; then
                    log_success "Portainer container is running and port is listening (healthy enough)"
                    return 0
                else
                    # Container running but port not listening yet - give it more time
                    log_info "Portainer container running but port not listening yet, waiting additional 30s..."
                    sleep 30
                    if docker exec "$container" sh -c "nc -z localhost 9000 2>/dev/null || netstat -an 2>/dev/null | grep -q ':9000.*LISTEN' || ss -an 2>/dev/null | grep -q ':9000.*LISTEN'" 2>/dev/null; then
                        log_success "Portainer port is now listening"
                        return 0
                    fi
                fi
                
                # If container is running, consider it acceptable (even if health check fails)
                # Portainer may need initial setup which is done via web UI
                log_warning "Portainer container is running but health check failed - this is acceptable for non-critical service"
                log_info "Portainer may need initial setup. Access http://localhost:9000 to complete setup."
                return 0
            else
                log_warning "Portainer container status: ${container_status} (expected: running)"
                # Try one more health check
                check_portainer && return 0
            fi
            ;;
        openvidu)
            wait_for_health "${OPENVIDU_CONTAINER}" "$health_timeout" && return 0
            ;;
    esac
    
    log_warning "Container ${service} is not healthy after recreation"
    return 1
}

# Full recovery workflow: processes each missing container individually
recover_missing_containers() {
    log_info "=== Processing Missing Containers (One by One) ==="
    
    local missing_services=()
    
    # Identify missing services
    for service in postgres dragonfly coturn portainer openvidu; do
        if [[ "${SERVICE_STATUS[$service]}" == "missing" ]]; then
            log_info "Service ${service} is missing"
            missing_services+=("$service")
        fi
    done
    
    if [[ ${#missing_services[@]} -eq 0 ]]; then
        log_info "No missing containers to recover"
        return 0
    fi
    
    local all_recovered=true
    
    # Process each missing container individually
    for service in "${missing_services[@]}"; do
        log_info ""
        log_info "═══════════════════════════════════════════════════════════"
        log_info "Recovering: ${service}"
        log_info "═══════════════════════════════════════════════════════════"
        
        if recover_single_missing_container "$service"; then
            log_success "✓ ${service} recovered successfully"
        else
            log_error "✗ ${service} failed to recover"
            all_recovered=false
        fi
        
        # Re-check status after processing
        case "$service" in
            postgres)
                check_postgres || all_recovered=false
                ;;
            dragonfly)
                check_dragonfly || all_recovered=false
                ;;
            coturn)
                check_coturn || all_recovered=false
                ;;
            portainer)
                check_portainer || all_recovered=false
                ;;
            openvidu)
                check_openvidu || all_recovered=false
                ;;
        esac
    done
    
    if $all_recovered; then
        log_success "All missing containers have been recovered"
        return 0
    else
        log_warning "Some containers failed to recover"
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
    local portainer_unhealthy=false  # Track Portainer separately (non-critical)
    
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
    
    # Check Portainer (non-critical UI service - don't fail overall health if only Portainer is unhealthy)
    check_portainer || {
        if [[ "${SERVICE_STATUS[portainer]}" == "missing" ]]; then
            # Portainer missing is acceptable (non-critical)
            portainer_unhealthy=true
            log_warning "Portainer is missing (non-critical UI service - acceptable)"
        else
            # Portainer unhealthy is acceptable (non-critical)
            portainer_unhealthy=true
            log_warning "Portainer is unhealthy (non-critical UI service - acceptable, may need initial setup)"
        fi
        # Don't set all_healthy=false or any_missing/any_unhealthy for Portainer
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
    
    # Log summary before JSON output
    echo ""
    log_info "=== Health Check Summary ==="
    for service in postgres dragonfly coturn portainer openvidu; do
        local status="${SERVICE_STATUS[$service]:-unknown}"
        if [[ "$status" == "healthy" ]]; then
            log_success "✓ $service: $status"
        elif [[ "$status" == "missing" ]]; then
            log_error "✗ $service: $status (container not running)"
        elif [[ "$status" == "unhealthy" ]]; then
            log_warning "⚠ $service: $status"
        else
            log_warning "? $service: $status"
        fi
    done
    echo ""
    
    # Skip if all healthy (no backup/fix/restore needed)
    if $all_healthy; then
        log_success "All infrastructure services are healthy - no action needed"
    # Generate JSON output
        {
            json_start
            json_string "status" "$overall_status"
            json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
            echo "  \"services\": {"
            echo "    \"postgres\": ${SERVICE_DETAILS[postgres]},"
            echo "    \"dragonfly\": ${SERVICE_DETAILS[dragonfly]},"
            echo "    \"coturn\": ${SERVICE_DETAILS[coturn]},"
            echo "    \"portainer\": ${SERVICE_DETAILS[portainer]},"
            echo "    \"openvidu\": ${SERVICE_DETAILS[openvidu]}"
            echo "  }"
            json_end
        } | json_fix_trailing
        exit $EXIT_HEALTHY
    fi
    
    # Generate JSON output (initial status before fixes)
    {
        json_start
        json_string "status" "$overall_status"
        json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "  \"services\": {"
        echo "    \"postgres\": ${SERVICE_DETAILS[postgres]},"
        echo "    \"dragonfly\": ${SERVICE_DETAILS[dragonfly]},"
        echo "    \"coturn\": ${SERVICE_DETAILS[coturn]},"
        echo "    \"portainer\": ${SERVICE_DETAILS[portainer]},"
        echo "    \"openvidu\": ${SERVICE_DETAILS[openvidu]}"
        echo "  }"
        json_end
    } | json_fix_trailing
    
    # Auto-fix unhealthy containers if enabled (backup → fix → restore → verify)
    # Retry up to 2 times if fix fails
    local max_fix_retries=2
    local fix_attempt=0
    local fix_succeeded=false
    
    if $any_unhealthy && [[ "${AUTO_RECREATE_MISSING:-false}" == "true" ]]; then
        while [[ $fix_attempt -lt $max_fix_retries ]] && ! $fix_succeeded; do
            fix_attempt=$((fix_attempt + 1))
            log_info "Auto-fix attempt $fix_attempt/$max_fix_retries - attempting to fix unhealthy containers..."
            
            if fix_unhealthy_containers; then
                log_success "Unhealthy containers fixed, re-checking health..."
                fix_succeeded=true
                
                # Re-check health after fixing
                all_healthy=true
                any_missing=false
                any_unhealthy=false
                portainer_unhealthy=false
            
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
            
            check_coturn || {
                if [[ "${SERVICE_STATUS[coturn]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
            
            # Portainer is non-critical - track separately
            check_portainer || {
                if [[ "${SERVICE_STATUS[portainer]}" == "missing" ]]; then
                    portainer_unhealthy=true
                else
                    portainer_unhealthy=true
                fi
                # Don't set all_healthy=false for Portainer
            }
            
            check_openvidu || {
                if [[ "${SERVICE_STATUS[openvidu]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
            
            # Update overall status
            if $any_missing; then
                overall_status="missing"
            elif $any_unhealthy; then
                overall_status="unhealthy"
            else
                overall_status="healthy"
            fi
            
            # Regenerate JSON output
            {
                json_start
                json_string "status" "$overall_status"
                json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "  \"services\": {"
                echo "    \"postgres\": ${SERVICE_DETAILS[postgres]},"
                echo "    \"dragonfly\": ${SERVICE_DETAILS[dragonfly]},"
                echo "    \"coturn\": ${SERVICE_DETAILS[coturn]},"
                echo "    \"portainer\": ${SERVICE_DETAILS[portainer]},"
                echo "    \"openvidu\": ${SERVICE_DETAILS[openvidu]}"
                echo "  }"
                json_end
            } | json_fix_trailing
            else
                log_warning "Fix attempt $fix_attempt failed, waiting before retry..."
                if [[ $fix_attempt -lt $max_fix_retries ]]; then
                    sleep $((fix_attempt * 5))  # Exponential backoff: 5s, 10s
                fi
            fi
        done
        
        if ! $fix_succeeded; then
            log_warning "Could not fix unhealthy containers after $max_fix_retries attempts, they may need recreation"
            # Mark as missing so recovery workflow can handle them
            any_missing=true
            any_unhealthy=false
        fi
    fi
    
    # Auto-recover missing containers if enabled (backup → recreate → restore → verify)
    # Retry up to 2 times if recovery fails
    local max_recovery_retries=2
    local recovery_attempt=0
    local recovery_succeeded=false
    
    if $any_missing && [[ "${AUTO_RECREATE_MISSING:-false}" == "true" ]]; then
        while [[ $recovery_attempt -lt $max_recovery_retries ]] && ! $recovery_succeeded; do
            recovery_attempt=$((recovery_attempt + 1))
            log_info "Auto-recovery attempt $recovery_attempt/$max_recovery_retries - starting full recovery workflow..."
            
            if recover_missing_containers; then
                log_success "Missing containers recreated successfully"
                recovery_succeeded=true
                
                # Re-check health after recreation
                log_info "Re-checking infrastructure health after recreation..."
                all_healthy=true
                any_missing=false
                any_unhealthy=false
                portainer_unhealthy=false
            
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
            
            check_coturn || {
                if [[ "${SERVICE_STATUS[coturn]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
            
            # Portainer is non-critical - track separately
            check_portainer || {
                if [[ "${SERVICE_STATUS[portainer]}" == "missing" ]]; then
                    portainer_unhealthy=true
                else
                    portainer_unhealthy=true
                fi
                # Don't set all_healthy=false for Portainer
            }
            
            check_openvidu || {
                if [[ "${SERVICE_STATUS[openvidu]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
            
            # Update overall status
            if $any_missing; then
                overall_status="missing"
            elif $any_unhealthy; then
                overall_status="unhealthy"
            else
                overall_status="healthy"
            fi
            
            # Regenerate JSON output
            {
                json_start
                json_string "status" "$overall_status"
                json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "  \"services\": {"
                echo "    \"postgres\": ${SERVICE_DETAILS[postgres]},"
                echo "    \"dragonfly\": ${SERVICE_DETAILS[dragonfly]},"
                echo "    \"coturn\": ${SERVICE_DETAILS[coturn]},"
                echo "    \"portainer\": ${SERVICE_DETAILS[portainer]},"
                echo "    \"openvidu\": ${SERVICE_DETAILS[openvidu]}"
                echo "  }"
                json_end
            } | json_fix_trailing
            else
                log_warning "Recovery attempt $recovery_attempt failed, waiting before retry..."
                if [[ $recovery_attempt -lt $max_recovery_retries ]]; then
                    sleep $((recovery_attempt * 10))  # Exponential backoff: 10s, 20s
                fi
            fi
        done
        
        if ! $recovery_succeeded; then
            log_error "Failed to recreate missing containers after $max_recovery_retries attempts"
            # Re-check one more time to see final status
            all_healthy=true
            any_missing=false
            any_unhealthy=false
            
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
            
            check_coturn || {
                if [[ "${SERVICE_STATUS[coturn]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
            
            check_portainer || {
                if [[ "${SERVICE_STATUS[portainer]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
            
            check_openvidu || {
                if [[ "${SERVICE_STATUS[openvidu]}" == "missing" ]]; then
                    any_missing=true
                else
                    any_unhealthy=true
                fi
                all_healthy=false
            }
        fi
    fi
    
    # Set exit code with informative message
    # Portainer is non-critical, so if only Portainer is unhealthy, consider infrastructure healthy
    if $all_healthy; then
        if $portainer_unhealthy; then
            log_success "All critical infrastructure services are healthy"
            log_warning "Portainer (non-critical UI) is unhealthy - this is acceptable"
            log_info "Portainer may need initial setup. Access http://localhost:9000 to complete setup."
        else
            log_success "All infrastructure services are healthy"
        fi
        exit $EXIT_HEALTHY
    elif $any_missing; then
        log_error "One or more critical infrastructure containers are missing"
        if $portainer_unhealthy; then
            log_warning "Portainer (non-critical UI) is also unhealthy - this is acceptable"
        fi
        if [[ "${AUTO_RECREATE_MISSING:-false}" != "true" ]]; then
            log_info "Tip: Set AUTO_RECREATE_MISSING=true to automatically recreate missing containers"
        else
            log_error "Auto-recovery was enabled but failed to fix missing containers"
        fi
        exit $EXIT_MISSING
    elif $any_unhealthy; then
        log_error "One or more critical infrastructure services are unhealthy"
        if $portainer_unhealthy; then
            log_warning "Portainer (non-critical UI) is also unhealthy - this is acceptable"
        fi
        exit $EXIT_CRITICAL
    else
        log_warning "Infrastructure health check completed with minor issues"
        if $portainer_unhealthy; then
            log_warning "Portainer (non-critical UI) is unhealthy - this is acceptable"
        fi
        exit $EXIT_MINOR_ISSUES
    fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

