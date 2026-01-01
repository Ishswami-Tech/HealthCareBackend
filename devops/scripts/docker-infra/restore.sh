#!/bin/bash
# Restore Script - Priority-based restore (Local first, S3 fallback)
# Restores PostgreSQL and Dragonfly from backups

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Container prefix
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

BACKUP_ID="${1:-latest}"
RESTORE_SOURCE=""  # Will be set to "local" or "s3"

# Find backup (local or S3)
find_backup() {
    log_info "Looking for backup: ${BACKUP_ID}..."
    
    # Try local first
    if [[ "$BACKUP_ID" == "latest" ]]; then
        local latest_meta=$(ls -t "${BACKUP_DIR}/metadata"/*.json 2>/dev/null | head -1)
        if [[ -n "$latest_meta" ]]; then
            BACKUP_ID=$(basename "$latest_meta" .json)
            RESTORE_SOURCE="local"
            log_success "Found latest local backup: ${BACKUP_ID}"
            return 0
        fi
    else
        local meta_file="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
        if [[ -f "$meta_file" ]]; then
            RESTORE_SOURCE="local"
            log_success "Found local backup: ${BACKUP_ID}"
            return 0
        fi
    fi
    
    # Try S3
    if [[ -n "${S3_ENABLED:-}" ]] && [[ "${S3_ENABLED}" == "true" ]]; then
        local s3_meta_path="backups/metadata/${BACKUP_ID}.json"
        local temp_meta="/tmp/${BACKUP_ID}.json"
        
        if s3_download "$s3_meta_path" "$temp_meta"; then
            RESTORE_SOURCE="s3"
            mkdir -p "${BACKUP_DIR}/metadata"
            cp "$temp_meta" "${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
            log_success "Found S3 backup: ${BACKUP_ID}"
            return 0
        fi
    fi
    
    log_error "Backup not found: ${BACKUP_ID}"
    return 1
}

# Restore PostgreSQL
restore_postgres() {
    local container="${CONTAINER_PREFIX}postgres"
    local meta_file="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
    
    if [[ ! -f "$meta_file" ]]; then
        log_error "Metadata file not found: ${meta_file}"
        return 1
    fi
    
    # Extract backup file info from metadata (simplified - would use jq in production)
    local backup_file=""
    if [[ "$RESTORE_SOURCE" == "local" ]]; then
        backup_file=$(grep -o '"file": "[^"]*"' "$meta_file" | head -1 | cut -d'"' -f4)
        backup_file="${BACKUP_DIR}/postgres/${backup_file}"
    else
        # Download from S3
        local s3_file=$(grep -o '"file": "[^"]*"' "$meta_file" | head -1 | cut -d'"' -f4)
        backup_file="/tmp/${s3_file}"
        local s3_path="backups/postgres/${s3_file}"
        s3_download "$s3_path" "$backup_file" || return 1
    fi
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: ${backup_file}"
        return 1
    fi
    
    log_info "Restoring PostgreSQL from ${backup_file}..."
    
    # Stop app containers
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
    local container="${CONTAINER_PREFIX}dragonfly"
    local meta_file="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
    
    if [[ ! -f "$meta_file" ]]; then
        log_warning "Dragonfly metadata not found, skipping restore"
        return 0
    fi
    
    local backup_file=""
    if [[ "$RESTORE_SOURCE" == "local" ]]; then
        backup_file=$(grep -o '"file": "[^"]*"' "$meta_file" | tail -1 | cut -d'"' -f4)
        backup_file="${BACKUP_DIR}/dragonfly/${backup_file}"
    else
        local s3_file=$(grep -o '"file": "[^"]*"' "$meta_file" | tail -1 | cut -d'"' -f4)
        backup_file="/tmp/${s3_file}"
        local s3_path="backups/dragonfly/${s3_file}"
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

# Main execution
main() {
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
    
    # Start app containers
    docker start "${CONTAINER_PREFIX}api" "${CONTAINER_PREFIX}worker" 2>/dev/null || true
    
    log_success "Restore process completed"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

