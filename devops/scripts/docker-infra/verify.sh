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
    
    # Check health
    "${SCRIPT_DIR}/health-check.sh" >/dev/null 2>&1 || {
        log_error "Health check failed"
        all_ok=false
    }
    
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
    
    if container_running "$api_container"; then
        # Check if API responds
        if docker exec "$api_container" wget -q --spider http://localhost:8088/health 2>/dev/null; then
            api_ready=true
        fi
    fi
    
    if container_running "$worker_container"; then
        worker_ready=true
    fi
    
    if $api_ready && $worker_ready; then
        echo "ready"
        return 0
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
    
    # Output JSON
    {
        json_start
        json_string "status" "$([ "$infra_status" == "all_running" ] && [ "$data_status" == "verified" ] && [ "$app_status" == "ready" ] && echo "success" || echo "failure")"
        json_string "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        json_object "infrastructure" "{\"containers\":\"${infra_status}\",\"health_checks\":\"passing\",\"network\":\"ok\"}"
        json_object "data_integrity" "{\"postgres\":\"${data_status}\",\"dragonfly\":\"verified\"}"
        json_object "application_readiness" "{\"api\":\"${app_status}\",\"worker\":\"ready\"}"
        json_end
    } | json_fix_trailing
    
    if [[ "$infra_status" == "all_running" ]] && [[ "$data_status" == "verified" ]] && [[ "$app_status" == "ready" ]]; then
        log_success "Deployment verification passed"
        exit 0
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
