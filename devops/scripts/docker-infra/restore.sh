#!/bin/bash
# Restore Script - Priority-based restore (Local first, S3 fallback)
# Restores PostgreSQL and Dragonfly from backups

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Ensure command_exists is available (from utils.sh)
if ! type command_exists >/dev/null 2>&1; then
    command_exists() {
        command -v "$1" >/dev/null 2>&1
    }
fi

# Container prefix (only for app containers, infrastructure uses fixed names)
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"

BACKUP_ID="${1:-latest}"
RESTORE_SOURCE=""  # Will be set to "local" or "s3"

# Find backup (local or S3)
find_backup() {
    # Security: Validate backup ID before use
    if ! validate_backup_id "$BACKUP_ID"; then
        log_error "Invalid backup ID: ${BACKUP_ID}"
        return 1
    fi
    
    log_info "Looking for backup: ${BACKUP_ID}..."
    
    # Try local first - check all backup type directories
    if [[ "$BACKUP_ID" == "latest" ]]; then
        local latest_meta=$(ls -t "${BACKUP_DIR}/metadata"/*.json 2>/dev/null | head -1)
        if [[ -n "$latest_meta" ]]; then
            BACKUP_ID=$(basename "$latest_meta" .json)
            # Validate extracted backup ID
            if ! validate_backup_id "$BACKUP_ID"; then
                log_error "Invalid backup ID extracted from metadata: ${BACKUP_ID}"
                return 1
            fi
            RESTORE_SOURCE="local"
            log_success "Found latest local backup: ${BACKUP_ID}"
            return 0
        fi
    else
        # Security: Validate path before use
        local meta_file="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
        if ! validate_file_path "$meta_file" "$BACKUP_DIR"; then
            log_error "Invalid metadata file path: ${meta_file}"
            return 1
        fi
        if [[ -f "$meta_file" ]]; then
            RESTORE_SOURCE="local"
            log_success "Found local backup: ${BACKUP_ID}"
            return 0
        fi
        
        # Debug: List available metadata files to help diagnose
        log_info "Metadata file not found at: ${meta_file}"
        log_info "Checking for available metadata files in: ${BACKUP_DIR}/metadata/"
        if [[ -d "${BACKUP_DIR}/metadata" ]]; then
            local available_files=$(ls -1 "${BACKUP_DIR}/metadata"/*.json 2>/dev/null | head -5 || echo "none")
            if [[ "$available_files" != "none" ]]; then
                log_info "Available metadata files:"
                echo "$available_files" | while read -r file; do
                    log_info "  - $(basename "$file")"
                done
            else
                log_warning "No metadata files found in ${BACKUP_DIR}/metadata/"
            fi
        else
            log_warning "Metadata directory does not exist: ${BACKUP_DIR}/metadata/"
        fi
        
        # Also check if backup ID might be in a subdirectory (e.g., pre-deployment/pre-deployment-2026-01-04-084414)
        # Extract the actual backup ID if it includes a type prefix
        local backup_type=""
        local actual_backup_id="$BACKUP_ID"
        if [[ "$BACKUP_ID" =~ ^(pre-deployment|success|hourly|daily|weekly)- ]]; then
            backup_type="${BASH_REMATCH[1]}"
            actual_backup_id="${BACKUP_ID#${backup_type}-}"
        fi
        
        # Try finding in backup type subdirectories
        for backup_type_dir in pre-deployment success hourly daily weekly; do
            local type_meta_file="${BACKUP_DIR}/metadata/${backup_type_dir}/${BACKUP_ID}.json"
            if [[ -f "$type_meta_file" ]]; then
                RESTORE_SOURCE="local"
                log_success "Found local backup in ${backup_type_dir}/: ${BACKUP_ID}"
                return 0
            fi
        done
    fi
    
    # Try S3 only if S3 is enabled AND local backup not found
    if [[ -n "${S3_ENABLED:-}" ]] && [[ "${S3_ENABLED}" == "true" ]]; then
        # Check if rclone or s3cmd is available before trying S3
        if command_exists rclone || command_exists s3cmd; then
            local s3_meta_path="backups/metadata/${BACKUP_ID}.json"
            # Security: Validate S3 path
            if ! validate_s3_path "$s3_meta_path"; then
                log_error "Invalid S3 path: ${s3_meta_path}"
                return 1
            fi
            # Security: Sanitize filename for temp file
            local sanitized_id=$(sanitize_filename "$BACKUP_ID")
            local temp_meta="/tmp/${sanitized_id}.json"
            
            if s3_download "$s3_meta_path" "$temp_meta" 2>/dev/null; then
                RESTORE_SOURCE="s3"
                mkdir -p "${BACKUP_DIR}/metadata"
                # Security: Validate destination path
                local dest_meta="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
                if ! validate_file_path "$dest_meta" "$BACKUP_DIR"; then
                    log_error "Invalid destination path: ${dest_meta}"
                    rm -f "$temp_meta"
                    return 1
                fi
                cp "$temp_meta" "$dest_meta"
                rm -f "$temp_meta"
                log_success "Found S3 backup: ${BACKUP_ID}"
                return 0
            else
                log_warning "S3 backup not found or S3 tools not available, skipping S3 check"
            fi
        else
            log_warning "S3 is enabled but neither rclone nor s3cmd is installed - skipping S3 check"
        fi
    fi
    
    log_error "Backup not found: ${BACKUP_ID}"
    return 1
}

# Restore PostgreSQL
restore_postgres() {
    local container="${POSTGRES_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
    
    local meta_file="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
    
    # Security: Validate metadata file path
    if ! validate_file_path "$meta_file" "$BACKUP_DIR"; then
        log_error "Invalid metadata file path: ${meta_file}"
        return 1
    fi
    
    if [[ ! -f "$meta_file" ]]; then
        log_error "Metadata file not found: ${meta_file}"
        return 1
    fi
    
    # Extract backup file info from metadata (simplified - would use jq in production)
    local backup_file=""
    if [[ "$RESTORE_SOURCE" == "local" ]]; then
        # Try to extract file path from postgres object first, then fallback to direct file field
        local extracted_file=$(grep -o '"file": "[^"]*"' "$meta_file" | head -1 | cut -d'"' -f4)
        local extracted_local_path=$(grep -o '"local_path": "[^"]*"' "$meta_file" | head -1 | cut -d'"' -f4)
        
        # Prefer local_path if available (full path), otherwise use file (relative)
        if [[ -n "$extracted_local_path" ]] && [[ -f "$extracted_local_path" ]]; then
            backup_file="$extracted_local_path"
        elif [[ -n "$extracted_file" ]]; then
            # Security: Sanitize and validate extracted filename
            extracted_file=$(sanitize_filename "$extracted_file")
            if [[ -z "$extracted_file" ]]; then
                log_error "Invalid filename extracted from metadata"
                return 1
            fi
            # Try to find the file in backup type subdirectories
            local backup_type=""
            if [[ "$BACKUP_ID" =~ ^(pre-deployment|success|hourly|daily|weekly)- ]]; then
                backup_type="${BASH_REMATCH[1]}"
            fi
            if [[ -n "$backup_type" ]] && [[ -f "${BACKUP_DIR}/postgres/${backup_type}/${extracted_file}" ]]; then
                backup_file="${BACKUP_DIR}/postgres/${backup_type}/${extracted_file}"
            elif [[ -f "${BACKUP_DIR}/postgres/${extracted_file}" ]]; then
                backup_file="${BACKUP_DIR}/postgres/${extracted_file}"
            else
                log_error "Backup file not found: ${extracted_file} (searched in ${BACKUP_DIR}/postgres/${backup_type}/ and ${BACKUP_DIR}/postgres/)"
                return 1
            fi
        else
            log_error "Could not extract file path from metadata"
            return 1
        fi
        # Security: Validate backup file path
        if ! validate_file_path "$backup_file" "$BACKUP_DIR"; then
            log_error "Invalid backup file path: ${backup_file}"
            return 1
        fi
    else
        # Download from S3
        local s3_file=$(grep -o '"file": "[^"]*"' "$meta_file" | head -1 | cut -d'"' -f4)
        # Security: Sanitize and validate S3 filename
        s3_file=$(sanitize_filename "$s3_file")
        if [[ -z "$s3_file" ]]; then
            log_error "Invalid S3 filename extracted from metadata"
            return 1
        fi
        backup_file="/tmp/${s3_file}"
        local s3_path="backups/postgres/${s3_file}"
        # Security: Validate S3 path
        if ! validate_s3_path "$s3_path"; then
            log_error "Invalid S3 path: ${s3_path}"
            return 1
        fi
        s3_download "$s3_path" "$backup_file" || return 1
    fi
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: ${backup_file}"
        return 1
    fi
    
    log_info "Restoring PostgreSQL from ${backup_file}..."
    
    # Stop app containers temporarily (safety measure during database restore)
    # This prevents app from writing to database during restore
    # NOTE: This is NOT a health check - it's a safety measure for data consistency
    docker stop "${CONTAINER_PREFIX}api" "${CONTAINER_PREFIX}worker" 2>/dev/null || true
    
    # Drop and recreate database
    docker exec "$container" psql -U postgres -c "DROP DATABASE IF EXISTS userdb;" || true
    docker exec "$container" psql -U postgres -c "CREATE DATABASE userdb;" || return 1
    
    # Restore
    if gunzip -c "$backup_file" | docker exec -i "$container" psql -U postgres userdb; then
        log_success "PostgreSQL restore completed"
        
        # Cleanup temp file if from S3
        [[ "$RESTORE_SOURCE" == "s3" ]] && rm -f "$backup_file"
        
        return 0
    else
        log_error "PostgreSQL restore failed"
        return 1
    fi
}

# Restore Dragonfly
restore_dragonfly() {
    local container="${DRAGONFLY_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
    
    local meta_file="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
    
    # Security: Validate metadata file path
    if ! validate_file_path "$meta_file" "$BACKUP_DIR"; then
        log_error "Invalid metadata file path: ${meta_file}"
        return 1
    fi
    
    if [[ ! -f "$meta_file" ]]; then
        log_warning "Dragonfly metadata not found, skipping restore"
        return 0
    fi
    
    local backup_file=""
    if [[ "$RESTORE_SOURCE" == "local" ]]; then
        local extracted_file=$(grep -o '"file": "[^"]*"' "$meta_file" | tail -1 | cut -d'"' -f4)
        # Security: Sanitize and validate extracted filename
        extracted_file=$(sanitize_filename "$extracted_file")
        if [[ -z "$extracted_file" ]]; then
            log_error "Invalid filename extracted from metadata"
            return 1
        fi
        backup_file="${BACKUP_DIR}/dragonfly/${extracted_file}"
        # Security: Validate backup file path
        if ! validate_file_path "$backup_file" "$BACKUP_DIR"; then
            log_error "Invalid backup file path: ${backup_file}"
            return 1
        fi
    else
        local s3_file=$(grep -o '"file": "[^"]*"' "$meta_file" | tail -1 | cut -d'"' -f4)
        # Security: Sanitize and validate S3 filename
        s3_file=$(sanitize_filename "$s3_file")
        if [[ -z "$s3_file" ]]; then
            log_error "Invalid S3 filename extracted from metadata"
            return 1
        fi
        backup_file="/tmp/${s3_file}"
        local s3_path="backups/dragonfly/${s3_file}"
        # Security: Validate S3 path
        if ! validate_s3_path "$s3_path"; then
            log_error "Invalid S3 path: ${s3_path}"
            return 1
        fi
        s3_download "$s3_path" "$backup_file" || return 1
    fi
    
    if [[ ! -f "$backup_file" ]]; then
        log_warning "Dragonfly backup file not found, skipping restore"
        return 0
    fi
    
    log_info "Restoring Dragonfly from ${backup_file}..."
    
    # Stop container
    docker stop "$container" 2>/dev/null || true
    
    # Extract and copy RDB file
    local temp_rdb="/tmp/dragonfly-restore.rdb"
    gunzip -c "$backup_file" > "$temp_rdb" || return 1
    
    # Copy to container
    docker cp "$temp_rdb" "${container}:/data/dump.rdb" || return 1
    rm -f "$temp_rdb"
    
    # Start container
    docker start "$container" || return 1
    
    # Wait for health
    wait_for_health "$container" 60 || return 1
    
    # Cleanup temp file if from S3
    [[ "$RESTORE_SOURCE" == "s3" ]] && rm -f "$backup_file"
    
    log_success "Dragonfly restore completed"
    return 0
}

# ============================================================================
# SUBCOMMAND: Disaster Recovery (S3-only restore)
# ============================================================================

disaster_recovery() {
    local backup_id="${1:-}"
    
    if [[ -z "$backup_id" ]]; then
        echo "Usage: $0 disaster <backup-id|latest>"
        echo ""
        echo "Examples:"
        echo "  $0 disaster success-2026-01-02-120000"
        echo "  $0 disaster latest"
        exit 1
    fi
    
    log_info "=== DISASTER RECOVERY ==="
    log_info "Restoring from S3 backup: $backup_id"
    
    # Validate backup ID
    if ! validate_backup_id "$backup_id"; then
        log_error "Invalid backup ID"
        exit 1
    fi
    
    # Check S3 is enabled
    if [[ -z "${S3_ENABLED:-}" ]] || [[ "${S3_ENABLED}" != "true" ]]; then
        log_error "S3 is not enabled - cannot perform disaster recovery"
        exit 1
    fi
    
    # Find backup metadata
    log_info "Downloading backup metadata from S3..."
    METADATA_FILE="/tmp/disaster-recovery-${backup_id}.json"
    
    if [[ "$backup_id" == "latest" ]]; then
        # Find latest success backup
        log_info "Finding latest success backup..."
        # TODO: Implement S3 listing to find latest
        log_error "Latest backup discovery not yet implemented"
        exit 1
    fi
    
    # Download metadata
    if ! s3_download "backups/metadata/${backup_id}.json" "$METADATA_FILE"; then
        log_error "Failed to download backup metadata from S3"
        exit 1
    fi
    
    # Parse metadata
    if ! command_exists jq; then
        log_error "jq is required for disaster recovery"
        exit 1
    fi
    
    POSTGRES_S3_PATH=$(jq -r '.postgres.s3_path' "$METADATA_FILE")
    DRAGONFLY_S3_PATH=$(jq -r '.dragonfly.s3_path' "$METADATA_FILE")
    
    log_info "Backup details:"
    log_info "  Postgres: $POSTGRES_S3_PATH"
    log_info "  Dragonfly: $DRAGONFLY_S3_PATH"
    
    # Download backup files
    log_info "Downloading PostgreSQL backup from S3..."
    POSTGRES_BACKUP="/tmp/postgres-disaster-recovery.sql.gz"
    if ! s3_download "$POSTGRES_S3_PATH" "$POSTGRES_BACKUP"; then
        log_error "Failed to download PostgreSQL backup"
        exit 1
    fi
    
    log_info "Downloading Dragonfly backup from S3..."
    DRAGONFLY_BACKUP="/tmp/dragonfly-disaster-recovery.rdb.gz"
    if ! s3_download "$DRAGONFLY_S3_PATH" "$DRAGONFLY_BACKUP"; then
        log_warning "Failed to download Dragonfly backup (non-critical)"
    fi
    
    # Verify backups
    log_info "Verifying downloaded backups..."
    if ! verify_backup "$POSTGRES_BACKUP" "$METADATA_FILE"; then
        log_error "PostgreSQL backup verification failed"
        exit 1
    fi
    
    if [[ -f "$DRAGONFLY_BACKUP" ]]; then
        verify_backup "$DRAGONFLY_BACKUP" "$METADATA_FILE" || log_warning "Dragonfly backup verification failed"
    fi
    
    # Ensure infrastructure is running
    log_info "Ensuring infrastructure containers are running..."
    
    # Ensure docker-compose.prod.yml exists (restores from /tmp or git if missing)
    if ! ensure_compose_file; then
        log_error "Failed to ensure docker-compose.prod.yml exists"
        exit 1
    fi
    
    # Ensure directory exists before changing into it
    local compose_dir="${BASE_DIR}/devops/docker"
    mkdir -p "$compose_dir" || {
        log_error "Failed to create directory: ${compose_dir}"
        exit 1
    }
    cd "$compose_dir" || {
        log_error "Failed to change to directory: ${compose_dir}"
        exit 1
    }
    
    if ! docker compose -f docker-compose.prod.yml --profile infrastructure up -d; then
        log_error "Failed to start infrastructure containers"
        exit 1
    fi
    
    # Wait for containers to be healthy
    log_info "Waiting for containers to be healthy..."
    wait_for_health "postgres" 300 || exit 1
    wait_for_health "dragonfly" 300 || log_warning "Dragonfly not healthy"
    
    # Restore PostgreSQL
    log_info "Restoring PostgreSQL database..."
    if gunzip -c "$POSTGRES_BACKUP" | docker exec -i postgres psql -U postgres -d userdb; then
        log_success "PostgreSQL restored successfully"
    else
        log_error "PostgreSQL restore failed"
        exit 1
    fi
    
    # Restore Dragonfly
    if [[ -f "$DRAGONFLY_BACKUP" ]]; then
        log_info "Restoring Dragonfly data..."
        
        # Stop dragonfly
        docker stop dragonfly
        
        # Extract RDB file
        gunzip -c "$DRAGONFLY_BACKUP" > /tmp/dump.rdb
        
        # Copy to container volume
        docker cp /tmp/dump.rdb dragonfly:/data/dump.rdb
        
        # Start dragonfly
        docker start dragonfly
        
        # Wait for health
        wait_for_health "dragonfly" 120 || log_warning "Dragonfly not healthy after restore"
        
        rm -f /tmp/dump.rdb
        log_success "Dragonfly restored successfully"
    fi
    
    # Cleanup
    rm -f "$POSTGRES_BACKUP" "$DRAGONFLY_BACKUP" "$METADATA_FILE"
    
    log_success "=== DISASTER RECOVERY COMPLETED ==="
    log_info "Infrastructure has been restored from backup: $backup_id"
    log_info "Next steps:"
    log_info "  1. Verify data integrity"
    log_info "  2. Deploy application containers"
    log_info "  3. Run health checks"
}

# ============================================================================
# MAIN RESTORE EXECUTION
# ============================================================================

main_restore() {
    log_info "Starting restore process (Backup ID: ${BACKUP_ID})..."
    
    check_docker || exit 1
    
    # Find backup
    find_backup || exit 1
    
    log_info "Using backup source: ${RESTORE_SOURCE}"
    
    # Restore PostgreSQL
    if restore_postgres; then
        log_success "PostgreSQL restore completed"
    else
        log_error "PostgreSQL restore failed"
        exit 1
    fi
    
    # Restore Dragonfly
    restore_dragonfly || log_warning "Dragonfly restore failed (non-critical)"
    
    # Start app containers (restart after infrastructure restore completes)
    # NOTE: This is NOT a health check - it's restarting the app after infrastructure restore
    docker start "${CONTAINER_PREFIX}api" "${CONTAINER_PREFIX}worker" 2>/dev/null || true
    
    log_success "Restore process completed"
}

# ============================================================================
# MAIN DISPATCHER
# ============================================================================

usage() {
    echo "Usage: $0 [disaster] <backup-id|latest>"
    echo ""
    echo "Commands:"
    echo "  <backup-id>     Restore from local backup (falls back to S3 if not found)"
    echo "  latest          Restore from latest local backup"
    echo "  disaster <id>   Disaster recovery: restore from S3 only (for complete server loss)"
    echo ""
    echo "Examples:"
    echo "  $0 success-2026-01-02-120000    # Restore specific backup"
    echo "  $0 latest                       # Restore latest backup"
    echo "  $0 disaster success-2026-01-02-120000  # Disaster recovery from S3"
    exit 1
}

main() {
    local command="${1:-}"
    
    case "$command" in
        disaster)
            shift || true
            disaster_recovery "$@"
            ;;
        ""|help|--help|-h)
            usage
            ;;
        *)
            # Default: treat as backup-id for backward compatibility
            main_restore "$@"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

