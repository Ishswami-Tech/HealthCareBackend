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
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-$(docker ps --filter 'ancestor=postgres:' --format '{{.Names}}' | head -1)}"
# The control plane's HA Dragonfly copy: a replica of the Sentinel-managed master (temps-ha/
# dragonfly-start). Never the old Coolify `redis-dragonfly`, which holds stale data.
DRAGONFLY_CONTAINER="${DRAGONFLY_CONTAINER:-redis-dragonfly-cache}"
# The Sentinels that pick the Dragonfly master (control plane). When present, the backup copy must
# be replicating from the master they name, so a copy left behind by a failover is never saved.
DRAGONFLY_SENTINEL_CONTAINER="${DRAGONFLY_SENTINEL_CONTAINER:-dragonfly-sentinel}"
DRAGONFLY_SENTINEL_NAME="${DRAGONFLY_SENTINEL_NAME:-dragonfly}"

# Temps HA Postgres helpers (temps_ha_postgres_enabled, resolve_postgres_primary, pg_tool) live in
# shared/utils.sh, shared with restore.sh.

BACKUP_ID=$(create_backup_id)
TIMESTAMP=$(get_timestamp)
METADATA_FILE="${BACKUP_DIR}/metadata/${BACKUP_ID}.json"

# Results
declare -A BACKUP_RESULTS
BACKUP_RESULTS[postgres_local]="failed"
BACKUP_RESULTS[postgres_s3]="failed"
BACKUP_RESULTS[dragonfly_local]="failed"
BACKUP_RESULTS[dragonfly_s3]="failed"
BACKUP_RESULTS[env_local]="failed"
BACKUP_RESULTS[env_s3]="failed"

# Result metrics and statuses for modern backup sequence
# BACKUP_RESULTS is declared as an associative array at the top

# Create combined metadata. A backup counts as successful when the local Postgres dump succeeded:
# that dump is what a deploy needs to be able to roll back to. The S3 copy is off-site redundancy;
# when S3 is slow or down the copy is queued for `backup.sh retry` and the backup still counts
# (it used to fail AND delete the good local dump, which blocked every deploy while Contabo S3 was
# stalled on 2026-11-16).
create_metadata() {
    local postgres_meta="${BACKUP_DIR}/metadata/postgres-${TIMESTAMP}.json"
    local dragonfly_meta="${BACKUP_DIR}/metadata/dragonfly-${TIMESTAMP}.json"
    local postgres_s3_status="${BACKUP_RESULTS[postgres_s3]:-failed}"

    if [[ "${BACKUP_RESULTS[postgres_local]:-failed}" != "success" ]]; then
        log_error "Backup not successful (local PostgreSQL dump failed) - not creating metadata"
        return 1
    fi
    if [[ "$postgres_s3_status" != "success" ]]; then
        log_warning "PostgreSQL dump kept locally only: the S3 copy failed and is queued for 'backup.sh retry'"
        send_alert "WARNING" "Backup ${BACKUP_ID}: PostgreSQL S3 copy failed; local dump kept, queued for retry"
    fi

    if [[ ! -f "$postgres_meta" ]]; then
        log_error "Cannot create metadata: PostgreSQL metadata file not found: ${postgres_meta}"
        return 1
    fi

    local postgres_json=$(cat "$postgres_meta")
    local dragonfly_json="null"
    if [[ -f "$dragonfly_meta" ]]; then
        dragonfly_json=$(cat "$dragonfly_meta")
    fi

    local postgres_local_status="${BACKUP_RESULTS[postgres_local]}"
    local env_local_status="${BACKUP_RESULTS[env_local]:-skipped}"
    local env_s3_status="${BACKUP_RESULTS[env_s3]:-skipped}"

    cat > "$METADATA_FILE" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployed_image": "${DEPLOYED_IMAGE:-}",
  "deploy_env": "${DEPLOY_ENV:-}",
  "postgres": ${postgres_json},
  "dragonfly": ${dragonfly_json},
  "env": {
    "local": "${env_local_status}",
    "s3": "${env_s3_status}"
  },
  "storage": {
    "local": "${postgres_local_status}",
    "s3": "${postgres_s3_status}"
  }
}
EOF
    chmod 600 "$METADATA_FILE"

    local s3_meta_path="backups/metadata/${BACKUP_ID}.json"
    if ! s3_upload_with_retry "$METADATA_FILE" "$s3_meta_path" 1 0; then
        log_warning "Metadata kept locally only: the S3 copy failed and is queued for 'backup.sh retry'"
    fi
    log_success "Backup metadata created: ${METADATA_FILE}"
    return 0
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
    
    # Define cron job
    CRON_12H="0 */12 * * * $BACKUP_SCRIPT 12h >> $LOG_DIR/12h.log 2>&1"
    
    # Add cron job
    log_info "Adding backup cron job (every 12 hours)"
    (crontab -l 2>/dev/null; echo "$CRON_12H") | crontab -
    
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
    log_info "  - 12-hour: Every 12 hours (keeps last 2 weeks)"
    log_info "Logs are stored in: $LOG_DIR"
}

# ============================================================================
# MAIN BACKUP EXECUTION
# ============================================================================

main_backup() {
    # Parse backup type from argument (hourly, daily, weekly, pre-deployment, success)
    local backup_type="${1:-pre-deployment}"

    # Capture currently deployed image for rollback metadata.
    # Multiple discovery paths so this works whether the deploy is Coolify-managed
    # (DOCKER_IMAGE in .env), compose-managed (image: in docker-compose.yml), or
    # running as a container (image label).
    capture_deployed_image() {
        # 1. Explicit override from CI
        if [[ -n "${DEPLOYED_IMAGE:-}" ]]; then
            echo "${DEPLOYED_IMAGE}"
            return 0
        fi

        # 2. Coolify-managed: /data/coolify/services/<uuid>/.env
        local coolify_env
        coolify_env=$(ls -t /data/coolify/services/*/.env 2>/dev/null | head -1)
        if [[ -n "$coolify_env" && -f "$coolify_env" ]]; then
            local img
            img=$(grep -E '^DOCKER_IMAGE=' "$coolify_env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
            if [[ -n "$img" ]]; then
                echo "$img"
                return 0
            fi
        fi

        # 3. docker compose: image: ghcr.io/... line
        local compose_file="${COMPOSE_FILE:-}"
        if [[ -n "$compose_file" && -f "$compose_file" ]]; then
            local img
            img=$(grep -E '^\s*image:\s*' "$compose_file" 2>/dev/null | head -1 | sed -E 's/^\s*image:\s*//' | tr -d '"' | tr -d "'")
            if [[ -n "$img" && "$img" != *'$'* ]]; then
                echo "$img"
                return 0
            fi
        fi

        # 4. Running container's image
        local api_container
        api_container=$(docker ps --filter "label=app.component=backend" --format '{{.Names}}' 2>/dev/null | head -1)
        if [[ -z "$api_container" ]]; then
            api_container=$(docker ps --filter "name=api" --format '{{.Names}}' 2>/dev/null | head -1)
        fi
        if [[ -n "$api_container" ]]; then
            docker inspect --format '{{.Config.Image}}' "$api_container" 2>/dev/null
            return 0
        fi

        return 1
    }

    DEPLOYED_IMAGE="${DEPLOYED_IMAGE:-$(capture_deployed_image || echo '')}"
    DEPLOY_ENV="${DEPLOY_ENV:-${DEPLOY_ENV_OVERRIDE:-}}"
    if [[ -n "$DEPLOYED_IMAGE" ]]; then
        log_info "Captured deployed image for rollback metadata: ${DEPLOYED_IMAGE}"
    else
        log_warning "Could not capture deployed image — rollback will require manual image selection"
    fi

    # Validate backup type
    case "$backup_type" in
        12h|hourly|daily|weekly|pre-deployment|success)
            log_info "Backup type: $backup_type"
            ;;
        *)
            log_error "Invalid backup type: $backup_type"
            log_error "Valid types: 12h, hourly, daily, weekly, pre-deployment, success"
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
    mkdir -p "${BACKUP_DIR}/env/${backup_type}"

    # Update backup file paths to include type
    local postgres_backup_file="${BACKUP_DIR}/postgres/${backup_type}/postgres-${TIMESTAMP}.sql.gz"
    local dragonfly_backup_file="${BACKUP_DIR}/dragonfly/${backup_type}/dragonfly-${TIMESTAMP}.rdb.gz"
    local env_backup_file="${BACKUP_DIR}/env/${backup_type}/env-${TIMESTAMP}.tar.gz"
    
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

    # Backup .env.production and critical config files
    if backup_env_files "$env_backup_file"; then
        log_success "Environment/config backup completed"
    else
        log_warning "Environment/config backup failed (non-critical)"
    fi
    
    # Create metadata for successful backups (the local Postgres dump succeeded; S3 is best-effort)
    if ! create_metadata; then
        log_error "Backup not fully successful - not registering (only successful backups are kept)"
        # Remove partial/failed backup artifacts so we don't retain failed backups
        rm -f "${postgres_backup_file}" "${BACKUP_DIR}/metadata/postgres-${TIMESTAMP}.json"
        rm -f "${dragonfly_backup_file}" "${BACKUP_DIR}/metadata/dragonfly-${TIMESTAMP}.json"
        rm -f "${env_backup_file}" "${BACKUP_DIR}/metadata/env-${TIMESTAMP}.json"
        rm -f "$METADATA_FILE"
        log_info "Removed partial backup files for failed run"
        exit 1
    fi

    if [[ ! -f "$METADATA_FILE" ]]; then
        log_error "Metadata file was not created: ${METADATA_FILE}"
        exit 1
    fi
    log_success "Backup metadata verified: ${METADATA_FILE}"

    # Cleanup old backups based on retention policy (only successful ones are kept)
    cleanup_old_backups_by_type "$backup_type"

    # Output backup ID only for successful backups
    echo "$BACKUP_ID"
    log_success "Backup process completed (ID: ${BACKUP_ID})"
}

# Helper function to backup postgres to specific path
backup_postgres_to_path() {
    local backup_file="$1"
    local container="${POSTGRES_CONTAINER}"
    local source="$container"

    if temps_ha_postgres_enabled; then
        if ! resolve_postgres_primary; then
            log_error "Could not resolve the current Postgres primary from the HA monitor"
            return 1
        fi
        source="$PG_TARGET"
        log_info "Starting PostgreSQL backup from the current primary ${PG_TARGET}..."
    else
        if ! validate_container_name "$container"; then
            log_error "Invalid container name: ${container}"
            return 1
        fi

        log_info "Starting PostgreSQL backup..."

        if ! container_running "$container"; then
            log_error "PostgreSQL container is not running"
            return 1
        fi
    fi

    # Create backup
    if pg_tool pg_dump | gzip > "$backup_file"; then
        chmod 600 "$backup_file"
        local checksum=$(calculate_checksum "$backup_file")
        local size=$(get_file_size "$backup_file")
        local db_size=$(pg_tool psql -t -c "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null | xargs || echo "unknown")
        local table_count=$(pg_tool psql -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs || echo "0")
        
        BACKUP_RESULTS[postgres_local]="success"
        log_success "PostgreSQL backup created: ${backup_file}"
        
        # Upload to S3 with retry logic
        local backup_dir_name=$(dirname "$backup_file" 2>/dev/null || echo "")
        local backup_type=$(basename "$backup_dir_name" 2>/dev/null || echo "postgres")
        local s3_path="backups/postgres/${backup_type}/postgres-${TIMESTAMP}.sql.gz"
        if s3_upload_with_retry "$backup_file" "$s3_path" 3 5; then
            BACKUP_RESULTS[postgres_s3]="success"
        else
            log_warning "S3 upload failed, but local backup succeeded"
            BACKUP_RESULTS[postgres_s3]="failed"
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
        
        # Extract array values to variables for use in heredoc (fixes syntax error)
        local postgres_local_status="${BACKUP_RESULTS[postgres_local]}"
        local postgres_s3_status="${BACKUP_RESULTS[postgres_s3]}"
        
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
  "source": "${source}",
  "local_path": "${backup_file}",
  "s3_path": "${s3_path}",
  "storage": {
    "local": "${postgres_local_status}",
    "s3": "${postgres_s3_status}"
  }
}
EOF
        
        return 0
    else
        log_error "PostgreSQL backup failed"
        return 1
    fi
}

# redis-cli inside the Dragonfly container, authenticated with the server's own --requirepass.
# The password is read from the server's argv INSIDE the container and never leaves it: it is not
# on the host command line, in the environment of this script, or in any log.
dragonfly_cli() {
    local container="$1"
    shift
    docker exec -i "$container" sh -s -- "$@" <<'SH'
args=""
for p in /proc/[0-9]*; do
    a=$(tr '\0' '\n' < "$p/cmdline" 2>/dev/null) || continue
    case "$(printf '%s\n' "$a" | head -1)" in
        dragonfly|*/dragonfly|redis-server|*/redis-server) args="$a"; break ;;
    esac
done
[ -n "$args" ] || args=$(tr '\0' '\n' < /proc/1/cmdline)
flag() { printf '%s\n' "$args" | sed -n "s/^--$1=//p" | head -1; }
next() { printf '%s\n' "$args" | grep -A1 -x -- "--$1" | sed -n 2p; }
pw=$(flag requirepass); [ -n "$pw" ] || pw=$(next requirepass)
port=$(flag port); [ -n "$port" ] || port=$(next port)
[ -n "$pw" ] && export REDISCLI_AUTH="$pw"
exec redis-cli -p "${port:-6379}" --no-auth-warning "$@"
SH
}

# Back up Dragonfly (all logical DBs: app cache/sessions/token blacklist in db0, HCB BullMQ in db1,
# social-media BullMQ in db5) as one gzipped RDB file.
#
# Taken from the control plane's replica, so the India master is never asked to snapshot. A replica
# whose master link is down holds stale data, so the backup refuses instead of saving it. The
# snapshot is written under a name of its own as a single RDB file (restorable by any Dragonfly or
# Redis with --dbfilename), copied out, and removed from the container so the volume does not grow.
backup_dragonfly_to_path() {
    local backup_file="$1"
    local container="${DRAGONFLY_CONTAINER}"
    local snapshot="hcb-backup-${TIMESTAMP}"

    if ! validate_container_name "$container"; then
        log_error "Invalid container name: ${container}"
        return 1
    fi
    log_info "Starting Dragonfly backup from ${container}..."
    if ! container_running "$container"; then
        log_error "Dragonfly container ${container} is not running"
        return 1
    fi

    local repl
    if ! repl=$(dragonfly_cli "$container" INFO replication | tr -d '\r') || [ -z "$repl" ]; then
        log_error "Cannot query Dragonfly in ${container}"
        return 1
    fi
    if grep -q '^NOAUTH\|^ERR' <<<"$repl"; then
        log_error "Dragonfly in ${container} refused the query: $(head -1 <<<"$repl")"
        return 1
    fi
    local role master
    role=$(sed -n 's/^role://p' <<<"$repl")
    case "$role" in
        slave|replica)
            master="$(sed -n 's/^master_host://p' <<<"$repl"):$(sed -n 's/^master_port://p' <<<"$repl")"
            if ! grep -qx 'master_link_status:up' <<<"$repl"; then
                log_error "Dragonfly copy ${container} lost its master (${master}); not backing up stale data"
                return 1
            fi
            if container_running "$DRAGONFLY_SENTINEL_CONTAINER" 2>/dev/null; then
                local sentinel_master
                sentinel_master=$(docker exec "$DRAGONFLY_SENTINEL_CONTAINER" sh -c \
                    'REDISCLI_AUTH="$(cat /data/sentinel.password 2>/dev/null)" redis-cli -p 26379 --no-auth-warning sentinel get-master-addr-by-name "$1"' \
                    sh "$DRAGONFLY_SENTINEL_NAME" 2>/dev/null | tr -d '\r' | paste -sd: -)
                if [ "$sentinel_master" != "$master" ]; then
                    log_error "Dragonfly copy ${container} replicates from ${master}, but Sentinel's master is '${sentinel_master:-unknown}' (after a failover?); not backing up possibly stale data"
                    return 1
                fi
            else
                log_warning "Sentinel container ${DRAGONFLY_SENTINEL_CONTAINER} not running; checked the replication link only"
            fi
            ;;
        master) master="self" ;;
        *)
            log_error "Unexpected Dragonfly role '${role}' in ${container}"
            return 1
            ;;
    esac

    local dir
    dir=$(dragonfly_cli "$container" CONFIG GET dir | tr -d '\r' | sed -n 2p)
    dir="${dir:-/data}"

    local save_output
    save_output=$(dragonfly_cli "$container" SAVE RDB "$snapshot" | tr -d '\r')
    if [ "$save_output" != "OK" ]; then
        log_error "Dragonfly SAVE failed in ${container}: ${save_output}"
        return 1
    fi

    local temp_rdb
    temp_rdb=$(mktemp "/tmp/dragonfly-${TIMESTAMP}.XXXXXX")
    local copied=true
    docker cp "${container}:${dir}/${snapshot}.rdb" "$temp_rdb" 2>/dev/null || copied=false
    docker exec "$container" rm -f "${dir}/${snapshot}.rdb" >/dev/null 2>&1 || \
        log_warning "Could not remove ${dir}/${snapshot}.rdb from ${container}"
    if [ "$copied" != true ] || [ ! -s "$temp_rdb" ]; then
        rm -f "$temp_rdb"
        log_error "Dragonfly snapshot ${dir}/${snapshot}.rdb could not be copied out of ${container}"
        return 1
    fi

    if ! gzip -c "$temp_rdb" > "$backup_file"; then
        rm -f "$temp_rdb" "$backup_file"
        log_error "Could not compress the Dragonfly snapshot"
        return 1
    fi
    rm -f "$temp_rdb"
    chmod 600 "$backup_file"

    local checksum size keyspace_json key_count
    checksum=$(calculate_checksum "$backup_file")
    size=$(get_file_size "$backup_file")
    # Keys per logical DB, e.g. {"db0":2558,"db1":10320,"db5":1044}, and their total.
    keyspace_json=$(dragonfly_cli "$container" INFO keyspace | tr -d '\r' | \
        sed -n 's/^\(db[0-9]*\):keys=\([0-9]*\).*/"\1":\2/p' | paste -sd, -)
    keyspace_json="{${keyspace_json}}"
    key_count=$(grep -oE ':[0-9]+' <<<"$keyspace_json" | tr -d ':' | awk '{ t += $1 } END { print t + 0 }')

    BACKUP_RESULTS[dragonfly_local]="success"
    log_success "Dragonfly backup created: ${backup_file} (${key_count} keys ${keyspace_json}, from ${role} of ${master})"

    local backup_type s3_path
    backup_type=$(basename "$(dirname "$backup_file")")
    s3_path="backups/dragonfly/${backup_type}/dragonfly-${TIMESTAMP}.rdb.gz"
    if s3_upload_with_retry "$backup_file" "$s3_path" 3 5; then
        BACKUP_RESULTS[dragonfly_s3]="success"
    else
        log_warning "S3 upload failed, but local backup succeeded"
        BACKUP_RESULTS[dragonfly_s3]="failed"
    fi

    local dragonfly_local_status="${BACKUP_RESULTS[dragonfly_local]}"
    local dragonfly_s3_status="${BACKUP_RESULTS[dragonfly_s3]}"
    cat > "${BACKUP_DIR}/metadata/dragonfly-${TIMESTAMP}.json" <<EOF
{
  "backup_id": "${BACKUP_ID}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "dragonfly-${TIMESTAMP}.rdb.gz",
  "format": "rdb",
  "size": "${size}",
  "checksum": "sha256:${checksum}",
  "key_count": ${key_count},
  "keyspace": ${keyspace_json},
  "source": { "container": "${container}", "role": "${role}", "master": "${master}" },
  "local_path": "${backup_file}",
  "s3_path": "${s3_path}",
  "storage": {
    "local": "${dragonfly_local_status}",
    "s3": "${dragonfly_s3_status}"
  }
}
EOF
    return 0
}

# ============================================================================
# ENV / CONFIG BACKUP
# ============================================================================

backup_env_files() {
    local backup_file="$1"
    local temp_dir
    temp_dir=$(mktemp -d)

    log_info "Starting environment/config backup..."

    # Files to back up (relative to BASE_DIR)
    local files_to_backup=()
    local source_dir="${BASE_DIR}"

    if [[ -f "${source_dir}/.env.production" ]]; then
        files_to_backup+=("${source_dir}/.env.production")
    else
        log_warning "No .env.production found at ${source_dir}/.env.production"
    fi

    # Docker compose and devops config
    if [[ -d "${source_dir}/devops" ]]; then
        # Tar entire devops directory (docker-compose, scripts, configs)
        files_to_backup+=("${source_dir}/devops")
    fi

    # .env files in project root
    for f in "${source_dir}"/.env "${source_dir}"/.env.local "${source_dir}"/.env.production.local; do
        if [[ -f "$f" ]]; then
            files_to_backup+=("$f")
        fi
    done

    if [[ ${#files_to_backup[@]} -eq 0 ]]; then
        log_warning "No env/config files found to backup"
        return 0
    fi

    # Create tar.gz of all files
    local tar_cmd="tar -czf '${backup_file}'"
    for f in "${files_to_backup[@]}"; do
        tar_cmd+=" '${f}'"
    done
    tar_cmd+=" 2>/dev/null"

    if eval "$tar_cmd" && [[ -f "$backup_file" ]] && [[ -s "$backup_file" ]]; then
        local size=$(du -h "$backup_file" | cut -f1)
        local checksum=$(sha256sum "$backup_file" | cut -d' ' -f1)

        log_success "Env/config backup created: $(basename "$backup_file") (${size})"

        # Upload to S3
        local s3_path="backups/env/${backup_type}/env-${TIMESTAMP}.tar.gz"
        log_info "Uploading env backup to S3: ${s3_path}"

        if s3_upload_with_retry "$backup_file" "$s3_path" 3 5; then
            log_success "Env backup uploaded to S3"
            BACKUP_RESULTS[env_local]="success"
            BACKUP_RESULTS[env_s3]="success"
        else
            log_error "Env backup S3 upload failed"
            BACKUP_RESULTS[env_local]="success"
            BACKUP_RESULTS[env_s3]="failed"
        fi

        # Cleanup temp dir
        rm -rf "$temp_dir"
        return 0
    else
        log_error "Failed to create env backup archive"
        rm -rf "$temp_dir"
        return 1
    fi
}


# Cleanup old backups based on retention policy
cleanup_old_backups_by_type() {
    local backup_type="$1"
    
    case "$backup_type" in
        12h)
            # Keep last 28 twelve-hour backups
            cleanup_backup_type "12h" 28
            ;;
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
    echo "  12h|hourly|daily|weekly|pre-deployment|success  Create backup of specified type"
    echo "  retry                                         Retry failed S3 uploads"
    echo "  setup-cron                                    Setup automated backup cron jobs"
    echo ""
    echo "Examples:"
    echo "  $0 12h                 # Create 12-hour backup"
    echo "  $0 pre-deployment      # Create pre-deployment backup"
    echo "  $0 retry               # Retry failed S3 uploads"
    echo "  $0 setup-cron          # Setup automated backups (12-hour schedule)"
    exit 1
}

main() {
    local command="${1:-}"
    
    case "$command" in
        12h|hourly|daily|weekly|pre-deployment|success)
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

