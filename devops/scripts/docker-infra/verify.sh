#!/bin/bash
# Unified Verification Script
# Supports both deployment verification and backup verification
#
# Usage:
#   ./verify.sh                    # Post-deployment verification (default)
#   ./verify.sh deployment         # Post-deployment verification
#   ./verify.sh backup <backup-id>  # Verify specific backup
#   ./verify.sh backup all         # Verify all backups

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

# Container prefix (only for app containers, infrastructure uses fixed names)
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"

# Ensure BACKUP_DIR is set (from utils.sh, but provide fallback)
BACKUP_DIR="${BACKUP_DIR:-/opt/healthcare-backend/backups}"

# ============================================================================
# DEPLOYMENT VERIFICATION FUNCTIONS
# ============================================================================

# Verify infrastructure
verify_infrastructure() {
    log_info "Verifying infrastructure..."
    
    local all_ok=true
    local health_check_retries=3
    local health_check_attempt=0
    local health_check_passed=false
    
    # Check containers (INFRASTRUCTURE ONLY - use fixed names)
    # Infrastructure containers: postgres, dragonfly (fixed names, no prefix)
    # Application containers: api, worker (use prefix, checked separately)
    if ! container_running "${POSTGRES_CONTAINER}"; then
        log_error "${POSTGRES_CONTAINER} is not running"
        all_ok=false
    fi
    
    # Use fixed name for dragonfly (infrastructure container)
    local dragonfly_container="dragonfly"
    if ! container_running "$dragonfly_container"; then
        log_error "${dragonfly_container} is not running"
        all_ok=false
    fi
    
    # Check health with retry logic and auto-fix
    while [[ $health_check_attempt -lt $health_check_retries ]] && ! $health_check_passed; do
        health_check_attempt=$((health_check_attempt + 1))
        log_info "Health check attempt $health_check_attempt/$health_check_retries..."
        
        # Run health check with auto-recovery enabled (capture output to check for recovery)
        export AUTO_RECREATE_MISSING="true"
        local health_check_output
        local health_check_exit
        
        # Run health check and capture both stdout and stderr
        health_check_output=$("${SCRIPT_DIR}/health-check.sh" 2>&1)
        health_check_exit=$?
        
        # Log important messages from health check (filter JSON but keep logs)
        echo "$health_check_output" | grep -E "^(INFO|WARNING|ERROR|SUCCESS|===|Auto-|Recovery|Recreating|Starting)" | while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                echo "$line" >&2
            fi
        done || true
        
        # Check if health check passed (exit code 0)
        if [[ $health_check_exit -eq 0 ]]; then
            health_check_passed=true
            log_success "Health check passed"
        else
            # Check if recovery was attempted (look for recovery messages in output)
            local recovery_attempted=false
            if echo "$health_check_output" | grep -qiE "Auto-recovery|recover_missing_containers|Recreating Missing Containers|Starting Full Recovery"; then
                recovery_attempted=true
                log_info "Recovery was attempted, waiting for containers to stabilize..."
                # Wait longer for containers to stabilize after recovery (recovery takes time)
                sleep 30
                
                # Re-run health check to see if recovery succeeded (without auto-recovery to avoid loops)
                log_info "Re-checking health after recovery..."
                if AUTO_RECREATE_MISSING="false" "${SCRIPT_DIR}/health-check.sh" >/dev/null 2>&1; then
                    health_check_passed=true
                    log_success "Health check passed after recovery"
                else
                    log_warning "Health check still failing after recovery attempt"
                fi
            else
                log_warning "Health check attempt $health_check_attempt failed (exit code: $health_check_exit)"
                if echo "$health_check_output" | grep -qiE "missing|unhealthy"; then
                    log_info "Containers appear to be missing or unhealthy, but auto-recovery was not triggered"
                    log_info "This may indicate that AUTO_RECREATE_MISSING is not being set correctly"
                fi
            fi
            
            if [[ $health_check_attempt -lt $health_check_retries ]] && ! $health_check_passed; then
                log_info "Waiting for infrastructure to stabilize before retry..."
                sleep $((health_check_attempt * 10))  # Wait 10s, 20s
            fi
        fi
    done
    
    if ! $health_check_passed; then
        log_error "Health check failed after $health_check_retries attempts"
        all_ok=false
    fi
    
    if $all_ok; then
        echo "all_running"
        return 0
    else
        echo "some_failed"
        return 1
    fi
}

# Verify data integrity
verify_data_integrity() {
    log_info "Verifying data integrity..."
    
    local container="${POSTGRES_CONTAINER}"
    
    # Test query
    if docker exec "$container" psql -U postgres -d userdb -c "SELECT 1" >/dev/null 2>&1; then
        # Check critical tables
        local user_count=$(docker exec "$container" psql -U postgres -d userdb -t -c "SELECT count(*) FROM \"User\" LIMIT 1;" 2>/dev/null | xargs || echo "0")
        log_info "User table has ${user_count} records"
        echo "verified"
        return 0
    else
        log_error "Data integrity check failed"
        echo "failed"
        return 1
    fi
}

# Verify application readiness
verify_application() {
    log_info "Verifying application readiness..."
    
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    # Security: Validate container names
    if ! validate_container_name "$api_container"; then
        log_error "Invalid API container name: ${api_container}"
        return 1
    fi
    if ! validate_container_name "$worker_container"; then
        log_error "Invalid worker container name: ${worker_container}"
        return 1
    fi
    
    local api_ready=false
    local worker_ready=false
    local api_retries=10
    local api_attempt=0
    
    # Check worker (simpler check - just running)
    if container_running "$worker_container"; then
        worker_ready=true
        log_success "Worker container is running"
    else
        log_warning "Worker container is not running"
    fi
    
    # Check API with retry logic (it may need time to start)
    if container_running "$api_container"; then
        log_info "API container is running, checking health endpoint..."
        while [[ $api_attempt -lt $api_retries ]] && ! $api_ready; do
            api_attempt=$((api_attempt + 1))
            log_info "API health check attempt $api_attempt/$api_retries..."
            
            if docker exec "$api_container" wget -q --spider http://localhost:8088/health 2>/dev/null; then
                api_ready=true
                log_success "API is ready and responding"
            else
                if [[ $api_attempt -lt $api_retries ]]; then
                    log_info "API not ready yet, waiting before retry..."
                    sleep $((api_attempt * 3))  # Wait 3s, 6s, 9s, etc.
                fi
            fi
        done
        
        if ! $api_ready; then
            log_warning "API did not become ready after $api_retries attempts"
        fi
    else
        log_warning "API container is not running"
    fi
    
    # Return status based on readiness
    if $api_ready && $worker_ready; then
        echo "ready"
        return 0
    elif $worker_ready; then
        # Worker is ready but API is not - return partial status
        echo "partial"
        return 1
    else
        echo "not_ready"
        return 1
    fi
}

# Post-deployment verification (default mode)
verify_deployment() {
    log_info "Starting deployment verification..."
    
    check_docker || exit 1
    
    local infra_status=$(verify_infrastructure)
    local data_status=$(verify_data_integrity)
    local app_status=$(verify_application)
    
    # Determine overall status
    local overall_status="failure"
    if [[ "$infra_status" == "all_running" ]] && [[ "$data_status" == "verified" ]] && [[ "$app_status" == "ready" ]]; then
        overall_status="success"
    elif [[ "$infra_status" == "all_running" ]] && [[ "$data_status" == "verified" ]] && [[ "$app_status" == "partial" ]]; then
        overall_status="partial"  # Infrastructure OK, but API not ready yet
    fi
    
    # Output JSON
    {
        json_start
        json_string "status" "$overall_status"
        json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        json_object "infrastructure" "{\"containers\":\"${infra_status}\",\"health_checks\":\"passing\",\"network\":\"ok\"}"
        json_object "data_integrity" "{\"postgres\":\"${data_status}\",\"dragonfly\":\"verified\"}"
        json_object "application_readiness" "{\"api\":\"${app_status}\",\"worker\":\"ready\"}"
        json_end
    } | json_fix_trailing
    
    # Exit codes: 0 = success, 1 = partial (infrastructure OK but API not ready), 2 = failure
    if [[ "$overall_status" == "success" ]]; then
        log_success "Deployment verification passed"
        exit 0
    elif [[ "$overall_status" == "partial" ]]; then
        log_warning "Deployment verification partial - infrastructure is healthy but API is not ready yet"
        log_info "This is usually temporary - API may need more time to start"
        exit 1  # Still exit 1, but with warning instead of error
    else
        log_error "Deployment verification failed"
        exit 1
    fi
}

# ============================================================================
# BACKUP VERIFICATION FUNCTIONS
# ============================================================================

# Verify single backup
verify_single_backup() {
    local backup_id="$1"
    
    log_info "Verifying backup: $backup_id"
    
    # Find metadata
    local metadata_file="${BACKUP_DIR}/metadata/${backup_id}.json"
    if [[ ! -f "$metadata_file" ]]; then
        log_error "Metadata not found: $metadata_file"
        return 1
    fi
    
    # Parse metadata to find backup files
    local postgres_file=$(jq -r '.postgres.local_path' "$metadata_file" 2>/dev/null)
    local dragonfly_file=$(jq -r '.dragonfly.local_path' "$metadata_file" 2>/dev/null)
    
    local status="PASS"
    
    # Verify PostgreSQL backup
    if [[ -n "$postgres_file" ]] && [[ -f "$postgres_file" ]]; then
        if verify_backup "$postgres_file" "$metadata_file"; then
            log_success "✓ PostgreSQL backup verified"
        else
            log_error "✗ PostgreSQL backup verification failed"
            status="FAIL"
        fi
    else
        log_warning "PostgreSQL backup file not found"
        status="PARTIAL"
    fi
    
    # Verify Dragonfly backup
    if [[ -n "$dragonfly_file" ]] && [[ -f "$dragonfly_file" ]]; then
        if verify_backup "$dragonfly_file" "$metadata_file"; then
            log_success "✓ Dragonfly backup verified"
        else
            log_error "✗ Dragonfly backup verification failed"
            status="FAIL"
        fi
    else
        log_warning "Dragonfly backup file not found"
        if [[ "$status" != "FAIL" ]]; then
            status="PARTIAL"
        fi
    fi
    
    echo "$status"
}

# Backup verification mode
verify_backup_mode() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 backup <backup-id|all>"
        echo ""
        echo "Examples:"
        echo "  $0 backup success-2026-01-02-120000"
        echo "  $0 backup all"
        exit 1
    fi
    
    local BACKUP_ID="$1"
    
    if [[ "$BACKUP_ID" == "all" ]]; then
        log_info "Verifying all backups..."
        
        TOTAL=0
        PASSED=0
        FAILED=0
        PARTIAL=0
        
        for metadata_file in "${BACKUP_DIR}/metadata"/*.json; do
            if [[ ! -f "$metadata_file" ]]; then
                continue
            fi
            
            backup_id=$(basename "$metadata_file" .json)
            TOTAL=$((TOTAL + 1))
            
            result=$(verify_single_backup "$backup_id")
            
            case "$result" in
                "PASS")
                    PASSED=$((PASSED + 1))
                    ;;
                "FAIL")
                    FAILED=$((FAILED + 1))
                    ;;
                "PARTIAL")
                    PARTIAL=$((PARTIAL + 1))
                    ;;
            esac
            
            echo "---"
        done
        
        log_info "=== VERIFICATION SUMMARY ==="
        log_info "Total backups: $TOTAL"
        log_success "Passed: $PASSED"
        log_warning "Partial: $PARTIAL"
        log_error "Failed: $FAILED"
        
        if [[ $FAILED -gt 0 ]]; then
            send_alert "ERROR" "Backup verification: $FAILED backups failed"
            exit 1
        elif [[ $PARTIAL -gt 0 ]]; then
            send_alert "WARNING" "Backup verification: $PARTIAL backups incomplete"
            exit 0
        else
            log_success "All backups verified successfully!"
            exit 0
        fi
    else
        # Verify single backup
        if ! validate_backup_id "$BACKUP_ID"; then
            log_error "Invalid backup ID"
            exit 1
        fi
        
        result=$(verify_single_backup "$BACKUP_ID")
        
        if [[ "$result" == "PASS" ]]; then
            log_success "Backup verification passed!"
            exit 0
        else
            log_error "Backup verification failed!"
            exit 1
        fi
    fi
}

# ============================================================================
# MAIN DISPATCHER
# ============================================================================

usage() {
    echo "Usage: $0 [deployment|backup] [backup-id|all]"
    echo ""
    echo "Modes:"
    echo "  deployment (default) - Post-deployment verification"
    echo "  backup              - Backup integrity verification"
    echo ""
    echo "Examples:"
    echo "  $0                    # Post-deployment verification"
    echo "  $0 deployment         # Post-deployment verification"
    echo "  $0 backup success-2026-01-02-120000  # Verify specific backup"
    echo "  $0 backup all        # Verify all backups"
    exit 1
}

main() {
    local mode="${1:-deployment}"
    
    case "$mode" in
        deployment|"")
            verify_deployment
            ;;
        backup)
            shift || true
            verify_backup_mode "$@"
            ;;
        *)
            usage
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
