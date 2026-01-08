#!/bin/bash
# Backup Script - Dual Backup (Local + Contabo S3)
# Backs up PostgreSQL and Dragonfly to both local storage and Contabo S3

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

# Container prefix (only for app containers, infrastructure uses fixed names)
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"

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
    local container="${POSTGRES_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
    
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
        
        # Store metadata - extract backup type from path if present
        local backup_type_from_path=""
        local dir_path=$(dirname "$backup_file" 2>/dev/null || echo "")
        if [[ -n "$dir_path" ]]; then
            backup_type_from_path=$(basename "$dir_path" 2>/dev/null || echo "")
        fi
        local relative_file_path="postgres-${TIMESTAMP}.sql.gz"
        if [[ -n "$backup_type_from_path" ]] && [[ "$backup_type_from_path" != "postgres" ]]; then
            relative_file_path="${backup_type_from_path}/postgres-${TIMESTAMP}.sql.gz"
        fi
        
        # Store metadata
        cat > "${BACKUP_DIR}/metadata/postgres-${TIMESTAMP}.json" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "${relative_file_path}",
  "size": "${size}",
  "checksum": "sha256:${checksum}",
  "database_size": "${db_size}",
  "table_count": ${table_count},
  "local_path": "${backup_file}",
  "s3_path": "${s3_path}",
  "storage": {
    "local": "${BACKUP_RESULTS["postgres_local"]}",
    "s3": "${BACKUP_RESULTS["postgres_s3"]}"
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
    local container="${DRAGONFLY_CONTAINER}"
    
    # Security: Validate container name
    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
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
    "local": "${BACKUP_RESULTS["dragonfly_local"]}",
    "s3": "${BACKUP_RESULTS["dragonfly_s3"]}"
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
    
    # Always create metadata if postgres backup succeeded (dragonfly is optional)
    if [[ -f "$postgres_meta" ]]; then
        local postgres_json=$(cat "$postgres_meta")
        local dragonfly_json="null"
        
        # Include dragonfly metadata if available
        if [[ -f "$dragonfly_meta" ]]; then
            dragonfly_json=$(cat "$dragonfly_meta")
        fi
        
        cat > "$METADATA_FILE" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "postgres": ${postgres_json},
  "dragonfly": ${dragonfly_json},
  "storage": {
    "local": "${BACKUP_RESULTS["postgres_local"]}",
    "s3": "${BACKUP_RESULTS["postgres_s3"]}"
  }
}
EOF
        
        chmod 600 "$METADATA_FILE"
        
        # Upload metadata to S3
        local s3_meta_path="backups/metadata/${BACKUP_ID}.json"
        s3_upload "$METADATA_FILE" "$s3_meta_path" || log_warning "Failed to upload metadata to S3"
        
        log_success "Backup metadata created: ${METADATA_FILE}"
    else
        log_error "Cannot create metadata: PostgreSQL metadata file not found: ${postgres_meta}"
        return 1
    fi
}

# ============================================================================
# SUBCOMMAND: Retry Failed S3 Uploads
# ============================================================================

retry_failed_uploads() {
    FAILED_UPLOADS_LOG="/var/log/backups/failed-uploads.txt"
    
    if [[ ! -f "$FAILED_UPLOADS_LOG" ]]; then
        log_info "No failed uploads to retry"
        return 0
    fi
    
    log_info "Retrying failed S3 uploads..."
    
    # Create temporary file for remaining failures
    TEMP_FILE=$(mktemp)
    SUCCESS_COUNT=0
    FAIL_COUNT=0
    
    while IFS='|' read -r timestamp file s3_path; do
        log_info "Retrying upload: $(basename "$file") -> $s3_path"
        
        # Check if local file still exists
        if [[ ! -f "$file" ]]; then
            log_warning "Local file no longer exists: $file"
            FAIL_COUNT=$((FAIL_COUNT + 1))
            continue
        fi
        
        # Retry upload with retry logic
        if s3_upload_with_retry "$file" "$s3_path" 3 5; then
            log_success "Upload succeeded: $s3_path"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        else
            log_error "Upload still failing: $s3_path"
            echo "$timestamp|$file|$s3_path" >> "$TEMP_FILE"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    done < "$FAILED_UPLOADS_LOG"
    
    # Replace failed uploads log with remaining failures
    if [[ -s "$TEMP_FILE" ]]; then
        mv "$TEMP_FILE" "$FAILED_UPLOADS_LOG"
        log_warning "Still have $FAIL_COUNT failed uploads"
    else
        rm -f "$FAILED_UPLOADS_LOG" "$TEMP_FILE"
        log_success "All failed uploads have been retried successfully!"
    fi
    
    log_info "Retry summary: $SUCCESS_COUNT succeeded, $FAIL_COUNT failed"
    
    if [[ $FAIL_COUNT -gt 0 ]]; then
        send_alert "WARNING" "S3 upload retry: $SUCCESS_COUNT succeeded, $FAIL_COUNT still failing"
        return 1
    fi
    
    return 0
}

# ============================================================================
# SUBCOMMAND: Setup Automated Cron Jobs
# ============================================================================

setup_cron_backups() {
    log_info "Setting up automated backup cron jobs..."
    
    # Backup script path
    BACKUP_SCRIPT="/opt/healthcare-backend/devops/scripts/docker-infra/backup.sh"
    LOG_DIR="/var/log/backups"
    
    # Ensure log directory exists
    mkdir -p "$LOG_DIR"
    chmod 755 "$LOG_DIR"
    
    # Remove existing healthcare backup cron jobs
    crontab -l 2>/dev/null | grep -v "healthcare-backend/devops/scripts/docker-infra/backup.sh" | crontab - 2>/dev/null || true
    
    # Define cron jobs
    CRON_HOURLY="0 * * * * $BACKUP_SCRIPT hourly >> $LOG_DIR/hourly.log 2>&1"
    CRON_DAILY="0 2 * * * $BACKUP_SCRIPT daily >> $LOG_DIR/daily.log 2>&1"
    CRON_WEEKLY="0 3 * * 0 $BACKUP_SCRIPT weekly >> $LOG_DIR/weekly.log 2>&1"
    
    # Add cron jobs
    log_info "Adding hourly backup cron job (every hour)"
    (crontab -l 2>/dev/null; echo "$CRON_HOURLY") | crontab -
    
    log_info "Adding daily backup cron job (2 AM daily)"
    (crontab -l 2>/dev/null; echo "$CRON_DAILY") | crontab -
    
    log_info "Adding weekly backup cron job (Sunday 3 AM)"
    (crontab -l 2>/dev/null; echo "$CRON_WEEKLY") | crontab -
    
    # Setup log rotation
    LOG_ROTATE_CONF="/etc/logrotate.d/healthcare-backups"
    if [[ -w "/etc/logrotate.d" ]] || sudo -n true 2>/dev/null; then
        log_info "Setting up log rotation..."
        
        cat > /tmp/healthcare-backups.logrotate <<EOF
$LOG_DIR/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF
        
        if [[ -w "/etc/logrotate.d" ]]; then
            mv /tmp/healthcare-backups.logrotate "$LOG_ROTATE_CONF"
        else
            sudo mv /tmp/healthcare-backups.logrotate "$LOG_ROTATE_CONF"
        fi
        
        log_success "Log rotation configured"
    else
        log_warning "Cannot configure log rotation (no write access to /etc/logrotate.d)"
    fi
    
    # Display current cron jobs
    log_success "Cron jobs installed successfully!"
    log_info "Current cron jobs:"
    crontab -l | grep "healthcare-backend" || log_warning "No healthcare backup cron jobs found"
    
    log_success "Automated backup setup completed!"
    log_info "Backups will run:"
    log_info "  - Hourly: Every hour (keeps last 24 hours)"
    log_info "  - Daily: 2 AM daily (keeps last 7 days)"
    log_info "  - Weekly: Sunday 3 AM (keeps last 4 weeks)"
    log_info "Logs are stored in: $LOG_DIR"
}

# ============================================================================
# MAIN BACKUP EXECUTION
# ============================================================================

main_backup() {
    # Parse backup type from argument (hourly, daily, weekly, pre-deployment, success)
    local backup_type="${1:-pre-deployment}"
    
    # Validate backup type
    case "$backup_type" in
        hourly|daily|weekly|pre-deployment|success)
            log_info "Backup type: $backup_type"
            ;;
        *)
            log_error "Invalid backup type: $backup_type"
            log_error "Valid types: hourly, daily, weekly, pre-deployment, success"
            exit 1
            ;;
    esac
    
    # Update backup ID to include type
    BACKUP_ID="${backup_type}-${TIMESTAMP}"
    METADATA_FILE="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"
    
    log_info "Starting backup process (ID: ${BACKUP_ID})..."
    
    check_docker || exit 1
    
    # Check disk space before backup (requires 20GB minimum)
    if ! check_disk_space_before_backup 20; then
        log_error "Insufficient disk space for backup"
        exit 1
    fi
    
    # Create backup type subdirectories
    mkdir -p "${BACKUP_DIR}/postgres/${backup_type}"
    mkdir -p "${BACKUP_DIR}/dragonfly/${backup_type}"
    
    # Update backup file paths to include type
    local postgres_backup_file="${BACKUP_DIR}/postgres/${backup_type}/postgres-${TIMESTAMP}.sql.gz"
    local dragonfly_backup_file="${BACKUP_DIR}/dragonfly/${backup_type}/dragonfly-${TIMESTAMP}.rdb.gz"
    
    # Backup PostgreSQL
    if backup_postgres_to_path "$postgres_backup_file"; then
        log_success "PostgreSQL backup completed"
    else
        log_error "PostgreSQL backup failed - ABORTING"
        exit 1
    fi
    
    # Backup Dragonfly
    if backup_dragonfly_to_path "$dragonfly_backup_file"; then
        log_success "Dragonfly backup completed"
    else
        log_warning "Dragonfly backup failed (non-critical)"
    fi
    
    # Create metadata
    if ! create_metadata; then
        log_error "Failed to create backup metadata - backup may not be restorable"
        log_error "Backup files were created but metadata is missing"
        # Don't exit - backup files are still valid, just metadata is missing
    fi
    
    # Verify metadata file was created
    if [[ ! -f "$METADATA_FILE" ]]; then
        log_error "Metadata file was not created: ${METADATA_FILE}"
        log_error "This backup may not be restorable via restore.sh"
    else
        log_success "Backup metadata verified: ${METADATA_FILE}"
    fi
    
    # Cleanup old backups based on retention policy
    cleanup_old_backups_by_type "$backup_type"
    
    # Output backup ID for use in restore
    echo "$BACKUP_ID"
    
    log_success "Backup process completed (ID: ${BACKUP_ID})"
}

# Helper function to backup postgres to specific path
backup_postgres_to_path() {
    local backup_file="$1"
    local container="${POSTGRES_CONTAINER}"
    
    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
    
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
        
        # Upload to S3 with retry logic
        local backup_dir_name=$(dirname "$backup_file" 2>/dev/null || echo "")
        local backup_type=$(basename "$backup_dir_name" 2>/dev/null || echo "postgres")
        local s3_path="backups/postgres/${backup_type}/postgres-${TIMESTAMP}.sql.gz"
        if s3_upload_with_retry "$backup_file" "$s3_path" 3 5; then
            BACKUP_RESULTS["postgres_s3"]="success"
        else
            log_warning "S3 upload failed, but local backup succeeded"
            BACKUP_RESULTS["postgres_s3"]="failed"
        fi
        
        # Store metadata - extract backup type from path if present
        local backup_type_from_path=""
        local dir_path=$(dirname "$backup_file" 2>/dev/null || echo "")
        if [[ -n "$dir_path" ]]; then
            backup_type_from_path=$(basename "$dir_path" 2>/dev/null || echo "")
        fi
        local relative_file_path="postgres-${TIMESTAMP}.sql.gz"
        if [[ -n "$backup_type_from_path" ]] && [[ "$backup_type_from_path" != "postgres" ]]; then
            relative_file_path="${backup_type_from_path}/postgres-${TIMESTAMP}.sql.gz"
        fi
        
        # Store metadata
        cat > "${BACKUP_DIR}/metadata/postgres-${TIMESTAMP}.json" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "${relative_file_path}",
  "size": "${size}",
  "checksum": "sha256:${checksum}",
  "database_size": "${db_size}",
  "table_count": ${table_count},
  "local_path": "${backup_file}",
  "s3_path": "${s3_path}",
  "storage": {
    "local": "${BACKUP_RESULTS["postgres_local"]}",
    "s3": "${BACKUP_RESULTS["postgres_s3"]}"
  }
}
EOF
        
        return 0
    else
        log_error "PostgreSQL backup failed"
        return 1
    fi
}

# Helper function to backup dragonfly to specific path
backup_dragonfly_to_path() {
    local backup_file="$1"
    local container="${DRAGONFLY_CONTAINER}"
    
    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
    
    local temp_rdb="/tmp/dragonfly-${TIMESTAMP}.rdb"
    
    log_info "Starting Dragonfly backup..."
    
    if ! container_running "$container"; then
        log_error "Dragonfly container is not running"
        return 1
    fi
    
    # Use SAVE command to create snapshot
    if docker exec "$container" redis-cli -p 6379 SAVE > /dev/null 2>&1; then
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
                
                # Upload to S3 with retry logic
                local backup_dir_name=$(dirname "$backup_file" 2>/dev/null || echo "")
                local backup_type=$(basename "$backup_dir_name" 2>/dev/null || echo "dragonfly")
                local s3_path="backups/dragonfly/${backup_type}/dragonfly-${TIMESTAMP}.rdb.gz"
                if s3_upload_with_retry "$backup_file" "$s3_path" 3 5; then
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
    "local": "${BACKUP_RESULTS["dragonfly_local"]}",
    "s3": "${BACKUP_RESULTS["dragonfly_s3"]}"
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

# Cleanup old backups based on retention policy
cleanup_old_backups_by_type() {
    local backup_type="$1"
    
    case "$backup_type" in
        hourly)
            # Keep last 24 hourly backups
            cleanup_backup_type "hourly" 24
            ;;
        daily)
            # Keep last 7 daily backups
            cleanup_backup_type "daily" 7
            ;;
        weekly)
            # Keep last 4 weekly backups
            cleanup_backup_type "weekly" 4
            ;;
        pre-deployment)
            # Keep last 3 pre-deployment backups
            cleanup_backup_type "pre-deployment" 3
            ;;
        success)
            # Keep last 5 success backups
            cleanup_backup_type "success" 5
            ;;
    esac
}

# ============================================================================
# MAIN DISPATCHER
# ============================================================================

usage() {
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  hourly|daily|weekly|pre-deployment|success  Create backup of specified type"
    echo "  retry                                         Retry failed S3 uploads"
    echo "  setup-cron                                    Setup automated backup cron jobs"
    echo ""
    echo "Examples:"
    echo "  $0 hourly              # Create hourly backup"
    echo "  $0 pre-deployment      # Create pre-deployment backup"
    echo "  $0 retry               # Retry failed S3 uploads"
    echo "  $0 setup-cron          # Setup automated backups"
    exit 1
}

main() {
    local command="${1:-}"
    
    case "$command" in
        hourly|daily|weekly|pre-deployment|success)
            main_backup "$@"
            ;;
        retry)
            retry_failed_uploads
            ;;
        setup-cron)
            setup_cron_backups
            ;;
        ""|help|--help|-h)
            # If no command provided, default to pre-deployment backup
            if [[ -z "$command" ]]; then
                main_backup "pre-deployment"
            else
                usage
            fi
            ;;
        *)
            log_error "Unknown command: $command"
            usage
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

