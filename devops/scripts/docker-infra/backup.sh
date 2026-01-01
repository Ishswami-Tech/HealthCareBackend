#!/bin/bash
# Backup Script - Dual Backup (Local + Contabo S3)
# Backs up PostgreSQL and Dragonfly to both local storage and Contabo S3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Container prefix
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

BACKUP_ID=$(create_backup_id)
TIMESTAMP=$(get_timestamp)
METADATA_FILE="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"

# Results
declare -A BACKUP_RESULTS
BACKUP_RESULTS["postgres_local"]="failed"
BACKUP_RESULTS["postgres_s3"]="failed"
BACKUP_RESULTS["dragonfly_local"]="failed"
BACKUP_RESULTS["dragonfly_s3"]="failed"

# Backup PostgreSQL
backup_postgres() {
    local container="${CONTAINER_PREFIX}postgres"
    local backup_file="${BACKUP_DIR}/postgres/postgres-${TIMESTAMP}.sql.gz"
    
    log_info "Starting PostgreSQL backup..."
    
    if ! container_running "$container"; then
        log_error "PostgreSQL container is not running"
        return 1
    fi
    
    # Create backup
    if docker exec "$container" pg_dump -U postgres userdb | gzip > "$backup_file"; then
        chmod 600 "$backup_file"
        local checksum=$(calculate_checksum "$backup_file")
        local size=$(get_file_size "$backup_file")
        local db_size=$(docker exec "$container" psql -U postgres -d userdb -t -c "SELECT pg_size_pretty(pg_database_size('userdb'));" 2>/dev/null | xargs || echo "unknown")
        local table_count=$(docker exec "$container" psql -U postgres -d userdb -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs || echo "0")
        
        BACKUP_RESULTS["postgres_local"]="success"
        log_success "PostgreSQL backup created: ${backup_file}"
        
        # Upload to S3
        local s3_path="backups/postgres/postgres-${TIMESTAMP}.sql.gz"
        if s3_upload "$backup_file" "$s3_path"; then
            BACKUP_RESULTS["postgres_s3"]="success"
        else
            log_warning "S3 upload failed, but local backup succeeded"
            BACKUP_RESULTS["postgres_s3"]="failed"
        fi
        
        # Store metadata
        cat > "${BACKUP_DIR}/metadata/postgres-${TIMESTAMP}.json" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "postgres-${TIMESTAMP}.sql.gz",
  "size": "${size}",
  "checksum": "sha256:${checksum}",
  "database_size": "${db_size}",
  "table_count": ${table_count},
  "local_path": "${backup_file}",
  "s3_path": "${s3_path}",
  "storage": {
    "local": "${BACKUP_RESULTS[postgres_local]}",
    "s3": "${BACKUP_RESULTS[postgres_s3]}"
  }
}
EOF
        
        return 0
    else
        log_error "PostgreSQL backup failed"
        return 1
    fi
}

# Backup Dragonfly
backup_dragonfly() {
    local container="${CONTAINER_PREFIX}dragonfly"
    local backup_file="${BACKUP_DIR}/dragonfly/dragonfly-${TIMESTAMP}.rdb.gz"
    
    log_info "Starting Dragonfly backup..."
    
    if ! container_running "$container"; then
        log_error "Dragonfly container is not running"
        return 1
    fi
    
    # Try to create RDB snapshot
    local temp_rdb="/tmp/dragonfly-${TIMESTAMP}.rdb"
    
    # Use SAVE command to create snapshot
    if docker exec "$container" redis-cli -p 6379 SAVE >/dev/null 2>&1; then
        # Copy RDB file from container
        if docker cp "${container}:/data/dump.rdb" "$temp_rdb" 2>/dev/null; then
            # Compress
            if gzip -c "$temp_rdb" > "$backup_file"; then
                rm -f "$temp_rdb"
                chmod 600 "$backup_file"
                local checksum=$(calculate_checksum "$backup_file")
                local size=$(get_file_size "$backup_file")
                local key_count=$(docker exec "$container" redis-cli -p 6379 DBSIZE 2>/dev/null | xargs || echo "0")
                
                BACKUP_RESULTS["dragonfly_local"]="success"
                log_success "Dragonfly backup created: ${backup_file}"
                
                # Upload to S3
                local s3_path="backups/dragonfly/dragonfly-${TIMESTAMP}.rdb.gz"
                if s3_upload "$backup_file" "$s3_path"; then
                    BACKUP_RESULTS["dragonfly_s3"]="success"
                else
                    log_warning "S3 upload failed, but local backup succeeded"
                    BACKUP_RESULTS["dragonfly_s3"]="failed"
                fi
                
                # Store metadata
                cat > "${BACKUP_DIR}/metadata/dragonfly-${TIMESTAMP}.json" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "dragonfly-${TIMESTAMP}.rdb.gz",
  "size": "${size}",
  "checksum": "sha256:${checksum}",
  "key_count": ${key_count},
  "local_path": "${backup_file}",
  "s3_path": "${s3_path}",
  "storage": {
    "local": "${BACKUP_RESULTS[dragonfly_local]}",
    "s3": "${BACKUP_RESULTS[dragonfly_s3]}"
  }
}
EOF
                
                return 0
            fi
        fi
    fi
    
    log_error "Dragonfly backup failed"
    return 1
}

# Create combined metadata
create_metadata() {
    local postgres_meta="${BACKUP_DIR}/metadata/postgres-${TIMESTAMP}.json"
    local dragonfly_meta="${BACKUP_DIR}/metadata/dragonfly-${TIMESTAMP}.json"
    
    if [[ -f "$postgres_meta" ]] && [[ -f "$dragonfly_meta" ]]; then
        local postgres_json=$(cat "$postgres_meta")
        local dragonfly_json=$(cat "$dragonfly_meta")
        
        cat > "$METADATA_FILE" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "postgres": ${postgres_json},
  "dragonfly": ${dragonfly_json},
  "storage": {
    "local": "${BACKUP_RESULTS[postgres_local]}",
    "s3": "${BACKUP_RESULTS[postgres_s3]}"
  }
}
EOF
        
        chmod 600 "$METADATA_FILE"
        
        # Upload metadata to S3
        local s3_meta_path="backups/metadata/${BACKUP_ID}.json"
        s3_upload "$METADATA_FILE" "$s3_meta_path" || log_warning "Failed to upload metadata to S3"
        
        log_success "Backup metadata created: ${METADATA_FILE}"
    fi
}

# Main execution
main() {
    log_info "Starting backup process (ID: ${BACKUP_ID})..."
    
    check_docker || exit 1
    
    # Check disk space
    local available_space=$(check_disk_space "$BACKUP_DIR")
    if [[ "$available_space" -lt 10 ]]; then
        log_warning "Low disk space: ${available_space}GB available"
    fi
    
    # Backup PostgreSQL
    if backup_postgres; then
        log_success "PostgreSQL backup completed"
    else
        log_error "PostgreSQL backup failed - ABORTING"
        exit 1
    fi
    
    # Backup Dragonfly
    if backup_dragonfly; then
        log_success "Dragonfly backup completed"
    else
        log_warning "Dragonfly backup failed (non-critical)"
    fi
    
    # Create metadata
    create_metadata
    
    # Output backup ID for use in restore
    echo "$BACKUP_ID"
    
    log_success "Backup process completed (ID: ${BACKUP_ID})"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

