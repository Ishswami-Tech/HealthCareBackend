#!/bin/bash
# Utility functions for infrastructure management scripts
# Source this file in other scripts: source "$(dirname "$0")/../shared/utils.sh"

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="/opt/healthcare-backend"
BACKUP_DIR="${BASE_DIR}/backups"
LOG_DIR="/var/log/deployments"
ENV_FILE="${BASE_DIR}/.env.production"

# Ensure directories exist
ensure_directories() {
    # Check if running as root
    local is_root=false
    if [[ "$(id -u)" == "0" ]]; then
        is_root=true
    fi
    
    # Check if directories exist, create if not
    if [[ ! -d "${BACKUP_DIR}/postgres" ]]; then
        mkdir -p "${BACKUP_DIR}/postgres"
        log_info "Created directory: ${BACKUP_DIR}/postgres"
    fi
    
    if [[ ! -d "${BACKUP_DIR}/dragonfly" ]]; then
        mkdir -p "${BACKUP_DIR}/dragonfly"
        log_info "Created directory: ${BACKUP_DIR}/dragonfly"
    fi
    
    if [[ ! -d "${BACKUP_DIR}/metadata" ]]; then
        mkdir -p "${BACKUP_DIR}/metadata"
        log_info "Created directory: ${BACKUP_DIR}/metadata"
    fi
    
    # /var/log/deployments requires sudo if not running as root
    if [[ ! -d "${LOG_DIR}" ]]; then
        if [[ "${LOG_DIR}" == /var/log* ]] && ! $is_root; then
            # Check if sudo is available without password
            if sudo -n true 2>/dev/null; then
                sudo mkdir -p "${LOG_DIR}" 2>/dev/null || log_warning "Could not create ${LOG_DIR} with sudo"
                sudo chmod 755 "${LOG_DIR}" 2>/dev/null || log_warning "Could not set permissions on ${LOG_DIR}"
            else
                # Try without sudo - might work if permissions allow
                mkdir -p "${LOG_DIR}" 2>/dev/null || log_warning "Could not create ${LOG_DIR} - sudo required but password not available"
            fi
        else
            mkdir -p "${LOG_DIR}"
            chmod 755 "${LOG_DIR}" 2>/dev/null || log_warning "Could not set permissions on ${LOG_DIR}"
        fi
        if [[ -d "${LOG_DIR}" ]]; then
            log_info "Created directory: ${LOG_DIR}"
        fi
    fi
    
    if [[ ! -d "${BASE_DIR}/data/postgres" ]]; then
        mkdir -p "${BASE_DIR}/data/postgres"
        log_info "Created directory: ${BASE_DIR}/data/postgres"
    fi
    
    if [[ ! -d "${BASE_DIR}/data/dragonfly" ]]; then
        mkdir -p "${BASE_DIR}/data/dragonfly"
        log_info "Created directory: ${BASE_DIR}/data/dragonfly"
    fi
    
    if [[ ! -d "${BASE_DIR}/data/openvidu_recordings" ]]; then
        mkdir -p "${BASE_DIR}/data/openvidu_recordings"
        log_info "Created directory: ${BASE_DIR}/data/openvidu_recordings"
    fi
    
    # Set permissions (safe to run multiple times)
    chmod 700 "${BACKUP_DIR}" 2>/dev/null || true
    if [[ "${LOG_DIR}" == /var/log* ]] && ! $is_root; then
        if sudo -n true 2>/dev/null; then
            sudo chmod 755 "${LOG_DIR}" 2>/dev/null || true
        else
            chmod 755 "${LOG_DIR}" 2>/dev/null || true
        fi
    else
        chmod 755 "${LOG_DIR}" 2>/dev/null || true
    fi
    chmod 755 "${BASE_DIR}/data" 2>/dev/null || true
}

# Validate environment file syntax
validate_env_file() {
    local env_file="${1:-${ENV_FILE}}"
    local auto_fix="${2:-false}"
    
    if [[ ! -f "${env_file}" ]]; then
        log_error "Environment file not found: ${env_file}"
        return 1
    fi
    
    local line_num=0
    local errors_found=0
    local fixes_applied=0
    local temp_file=""
    local backup_file=""
    
    if [[ "$auto_fix" == "true" ]]; then
        backup_file="${env_file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "${env_file}" "${backup_file}"
        log_info "Backup created: ${backup_file}"
        temp_file=$(mktemp)
    fi
    
    while IFS= read -r line || [[ -n "$line" ]]; do
        line_num=$((line_num + 1))
        local original_line="$line"
        local fixed_line="$line"
        
        # Skip empty lines
        if [[ -z "$line" ]]; then
            [[ -n "$temp_file" ]] && echo "" >> "$temp_file"
            continue
        fi
        
        # Check for common issues
        
        # Issue 1: Comment line missing # prefix (starts with word like "Application", "App", etc.)
        if [[ "$line" =~ ^[[:space:]]*[A-Z][a-z]+ ]] && [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ ! "$line" =~ = ]]; then
            # Check if it looks like a section header (starts with capital letter, no = sign)
            if [[ "$line" =~ ^[[:space:]]*(Application|App|Database|Cache|JWT|Prisma|Logging|Rate|Security|Email|CORS|Service|WhatsApp|Video|Google|Session|Firebase|Social|S3|Docker|Clinic) ]]; then
                log_warning "Line ${line_num}: Missing # prefix for comment: ${line:0:50}..."
                if [[ "$auto_fix" == "true" ]]; then
                    fixed_line="# ${line}"
                    fixes_applied=$((fixes_applied + 1))
                else
                    errors_found=$((errors_found + 1))
                fi
            fi
        fi
        
        # Issue 2: Variable assignment missing = sign
        if [[ "$line" =~ ^[[:space:]]*[A-Z_][A-Z0-9_]*[[:space:]]+[^=] ]] && [[ ! "$line" =~ ^[[:space:]]*# ]]; then
            log_warning "Line ${line_num}: Variable assignment missing = sign: ${line:0:50}..."
            if [[ "$auto_fix" == "true" ]]; then
                # Try to fix by adding = after variable name
                if [[ "$line" =~ ^([[:space:]]*[A-Z_][A-Z0-9_]*)[[:space:]]+(.+)$ ]]; then
                    fixed_line="${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
                    fixes_applied=$((fixes_applied + 1))
                else
                    log_error "Line ${line_num}: Cannot auto-fix: ${line:0:50}..."
                    errors_found=$((errors_found + 1))
                fi
            else
                errors_found=$((errors_found + 1))
            fi
        fi
        
        # Issue 3: Line starts with "App" or similar without # or =
        if [[ "$line" =~ ^[[:space:]]*App[[:space:]:] ]] && [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ ! "$line" =~ = ]]; then
            log_warning "Line ${line_num}: Line starting with 'App' without # or =: ${line:0:50}..."
            if [[ "$auto_fix" == "true" ]]; then
                fixed_line="# ${line}"
                fixes_applied=$((fixes_applied + 1))
            else
                errors_found=$((errors_found + 1))
            fi
        fi
        
        # Validate: Line should be either:
        # 1. Empty
        # 2. A comment (starts with #)
        # 3. A valid variable assignment (KEY=VALUE)
        if [[ -n "$line" ]] && [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ ! "$line" =~ ^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*= ]]; then
            if [[ "$fixed_line" == "$original_line" ]]; then
                log_error "Line ${line_num}: Invalid format (not a comment or variable assignment): ${line:0:50}..."
                errors_found=$((errors_found + 1))
                if [[ "$auto_fix" == "true" ]]; then
                    # Comment out invalid lines to prevent errors
                    fixed_line="# INVALID LINE (auto-commented): ${line}"
                    fixes_applied=$((fixes_applied + 1))
                fi
            fi
        fi
        
        if [[ -n "$temp_file" ]]; then
            echo "$fixed_line" >> "$temp_file"
        fi
    done < "${env_file}"
    
    # Replace original file if fixes were applied
    if [[ -n "$temp_file" ]] && [[ $fixes_applied -gt 0 ]]; then
        mv "$temp_file" "${env_file}"
        chmod 600 "${env_file}"
        log_success "File updated: ${fixes_applied} fixes applied"
        log_info "Backup saved at: ${backup_file}"
    elif [[ -n "$temp_file" ]]; then
        rm "$temp_file"
    fi
    
    if [[ $errors_found -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Test loading the environment file
test_env_file_load() {
    local env_file="${1:-${ENV_FILE}}"
    
    if [[ ! -f "${env_file}" ]]; then
        log_error "Environment file not found: ${env_file}"
        return 1
    fi
    
    log_info "Testing environment file loading..."
    
    # Try to source the file in a subshell to catch errors
    if bash -c "set -a; source '${env_file}' 2>&1; set +a" 2>&1 | grep -q "command not found"; then
        log_error "Environment file has syntax errors that prevent loading"
        return 1
    else
        log_success "Environment file loads successfully"
        return 0
    fi
}

# Validate and fix environment file (convenience function)
validate_and_fix_env_file() {
    local env_file="${1:-${ENV_FILE}}"
    
    log_info "Validating environment file: ${env_file}"
    
    if validate_env_file "${env_file}" "true"; then
        if test_env_file_load "${env_file}"; then
            log_success "✅ Environment file is valid and loads correctly"
            return 0
        else
            log_error "❌ Environment file still has errors after fixes"
            return 1
        fi
    else
        log_error "❌ Failed to validate/fix environment file"
        return 1
    fi
}

# Load environment variables
load_env() {
    local validate="${1:-false}"
    local auto_fix="${2:-false}"
    
    if [[ -f "${ENV_FILE}" ]]; then
        # Optionally validate before loading
        if [[ "$validate" == "true" ]]; then
            if ! validate_env_file "${ENV_FILE}" "$auto_fix"; then
                log_warning "Environment file has validation errors, but continuing to load..."
            fi
        fi
        
        set -a
        # Use a safer method to load env file that skips invalid lines
        # This prevents errors when sourcing files with malformed lines
        while IFS= read -r line || [[ -n "$line" ]]; do
            # Skip empty lines
            [[ -z "$line" ]] && continue
            # Skip comment lines
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            # Only process lines that look like valid variable assignments (KEY=VALUE)
            if [[ "$line" =~ ^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*= ]]; then
                # Export the variable safely
                export "$line" 2>/dev/null || log_warning "Failed to set environment variable: ${line%%=*}"
            else
                # Log warning for lines that don't match expected format but don't fail
                log_warning "Skipping invalid line in ${ENV_FILE}: ${line:0:50}..."
            fi
        done < "${ENV_FILE}"
        set +a
    else
        log_warning "Environment file not found: ${ENV_FILE}"
    fi
}

# Calculate SHA256 checksum
calculate_checksum() {
    local file="$1"
    if command -v sha256sum &> /dev/null; then
        sha256sum "$file" | cut -d' ' -f1
    elif command -v shasum &> /dev/null; then
        shasum -a 256 "$file" | cut -d' ' -f1
    else
        log_error "No checksum tool available (sha256sum or shasum)"
        return 1
    fi
}

# Get file size in human readable format
get_file_size() {
    local file="$1"
    if [[ -f "$file" ]]; then
        if command -v du &> /dev/null; then
            du -h "$file" | cut -f1
        else
            stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "unknown"
        fi
    else
        echo "0"
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Docker daemon
check_docker() {
    if ! command_exists docker; then
        log_error "Docker is not installed or not in PATH"
        return 1
    fi
    
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running"
        return 1
    fi
    
    return 0
}

# Check disk space (returns available space in GB)
check_disk_space() {
    local path="${1:-${BASE_DIR}}"
    if command_exists df; then
        df -BG "$path" | tail -1 | awk '{print $4}' | sed 's/G//'
    else
        log_warning "df command not available, cannot check disk space"
        echo "0"
    fi
}

# Check if container is running
container_running() {
    local container="$1"
    # Security: Validate container name before use
    if ! validate_container_name "$container"; then
        return 1
    fi
    docker ps --format '{{.Names}}' | grep -q "^${container}$" >/dev/null 2>&1
}

# Get container status
get_container_status() {
    local container="$1"
    # Security: Validate container name before use
    if ! validate_container_name "$container"; then
        echo "invalid"
        return 1
    fi
    docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "missing"
}

# Wait for container to be healthy
wait_for_health() {
    local container="$1"
    local max_wait="${2:-300}"  # Default 5 minutes
    local interval="${3:-10}"    # Default 10 seconds
    local elapsed=0
    
    log_info "Waiting for ${container} to be healthy (max ${max_wait}s)..."
    
    while [[ $elapsed -lt $max_wait ]]; do
        if container_running "$container"; then
            local status=$(get_container_status "$container")
            if [[ "$status" == "running" ]]; then
                # Check health status if healthcheck exists
                local health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "none")
                if [[ "$health" == "healthy" ]] || [[ "$health" == "none" ]]; then
                    log_success "${container} is healthy"
                    return 0
                fi
            fi
        fi
        
        sleep "$interval"
        elapsed=$((elapsed + interval))
        log_info "Still waiting... (${elapsed}/${max_wait}s)"
    done
    
    log_error "${container} did not become healthy within ${max_wait}s"
    return 1
}

# Create timestamp
get_timestamp() {
    date '+%Y-%m-%d-%H%M%S'
}

# Create backup ID
create_backup_id() {
    echo "backup-$(get_timestamp)"
}

# JSON helpers (simple, no jq dependency)
json_start() {
    echo "{"
}

json_end() {
    echo "}"
}

json_string() {
    local key="$1"
    local value="$2"
    echo "  \"${key}\": \"${value}\","
}

json_number() {
    local key="$1"
    local value="$2"
    echo "  \"${key}\": ${value},"
}

json_bool() {
    local key="$1"
    local value="$2"
    echo "  \"${key}\": ${value},"
}

json_object() {
    local key="$1"
    local value="$2"
    echo "  \"${key}\": ${value},"
}

# Remove trailing comma from last JSON entry
json_fix_trailing() {
    sed '$ s/,$//'
}

# Security: Input validation functions
# Validate backup ID format (alphanumeric, hyphens, underscores, or "latest")
validate_backup_id() {
    local backup_id="$1"
    if [[ "$backup_id" == "latest" ]]; then
        return 0
    fi
    # Only allow alphanumeric, hyphens, underscores
    if [[ ! "$backup_id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        log_error "Invalid backup ID format: ${backup_id}"
        return 1
    fi
    # Prevent path traversal attempts
    if [[ "$backup_id" == *".."* ]] || [[ "$backup_id" == *"/"* ]]; then
        log_error "Backup ID contains invalid characters (path traversal attempt): ${backup_id}"
        return 1
    fi
    return 0
}

# Validate file path (prevent path traversal)
validate_file_path() {
    local file_path="$1"
    local base_dir="$2"
    
    # Resolve absolute path
    local abs_path
    if [[ "$file_path" == /* ]]; then
        abs_path="$file_path"
    else
        abs_path="${base_dir}/${file_path}"
    fi
    
    # Normalize path (resolve .. and .)
    abs_path=$(cd "$(dirname "$abs_path")" 2>/dev/null && pwd)/$(basename "$abs_path") 2>/dev/null || echo "$abs_path"
    
    # Check if path is within base directory
    if [[ "$abs_path" != "$base_dir"* ]]; then
        log_error "Path traversal detected: ${file_path}"
        return 1
    fi
    
    # Check for .. in original path
    if [[ "$file_path" == *".."* ]]; then
        log_error "Path traversal detected (..): ${file_path}"
        return 1
    fi
    
    return 0
}

# Validate container name (alphanumeric, hyphens, underscores, dots)
validate_container_name() {
    local container="$1"
    # Only allow safe characters for container names
    if [[ ! "$container" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
        log_error "Invalid container name format: ${container}"
        return 1
    fi
    # Prevent command injection attempts
    # Check for dangerous characters: $, `, |, &, ;
    # Using grep with properly escaped backtick in character class
    if echo "$container" | grep -qE '[\$\`|&;]'; then
        log_error "Container name contains dangerous characters: ${container}"
        return 1
    fi
    return 0
}

# Validate S3 path (prevent path traversal)
validate_s3_path() {
    local s3_path="$1"
    # Only allow alphanumeric, slashes, hyphens, underscores, dots
    if [[ ! "$s3_path" =~ ^[a-zA-Z0-9/_.-]+$ ]]; then
        log_error "Invalid S3 path format: ${s3_path}"
        return 1
    fi
    # Prevent path traversal
    if [[ "$s3_path" == *".."* ]]; then
        log_error "S3 path contains path traversal (..): ${s3_path}"
        return 1
    fi
    return 0
}

# Sanitize filename (remove dangerous characters)
sanitize_filename() {
    local filename="$1"
    # Remove path separators and dangerous characters
    echo "$filename" | sed 's/[^a-zA-Z0-9_.-]//g'
}

# S3 helper functions (using AWS CLI or direct API)
s3_upload() {
    local local_file="$1"
    local s3_path="$2"
    
    # Security: Validate S3 path before use
    if ! validate_s3_path "$s3_path"; then
        log_error "Invalid S3 path: ${s3_path}"
        return 1
    fi
    
    # Security: Validate local file path
    if [[ ! -f "$local_file" ]]; then
        log_error "Local file not found: ${local_file}"
        return 1
    fi
    
    if [[ -z "${S3_ENABLED:-}" ]] || [[ "${S3_ENABLED}" != "true" ]]; then
        log_warning "S3 is not enabled, skipping upload"
        return 0
    fi
    
    if ! command_exists aws; then
        log_error "AWS CLI is not installed. Install it to use S3 backups."
        return 1
    fi
    
    local endpoint_url=""
    if [[ -n "${S3_ENDPOINT:-}" ]]; then
        # Security: Validate endpoint URL format
        if [[ ! "${S3_ENDPOINT}" =~ ^https?:// ]]; then
            log_error "Invalid S3 endpoint format: ${S3_ENDPOINT}"
            return 1
        fi
        endpoint_url="--endpoint-url ${S3_ENDPOINT}"
    fi
    
    # Configure path-style for Contabo S3 compatibility
    local path_style=""
    if [[ -n "${S3_FORCE_PATH_STYLE:-}" ]] && [[ "${S3_FORCE_PATH_STYLE}" == "true" ]]; then
        # AWS CLI v2 uses --force-path-style flag
        path_style="--force-path-style"
    fi
    
    log_info "Uploading ${local_file} to s3://${S3_BUCKET}/${s3_path}..."
    
    if aws s3 cp "$local_file" "s3://${S3_BUCKET}/${s3_path}" \
        ${endpoint_url} \
        ${path_style} \
        --region "${S3_REGION:-eu-central-1}" \
        --quiet; then
        log_success "Uploaded to S3: ${s3_path}"
        return 0
    else
        log_error "Failed to upload to S3: ${s3_path}"
        return 1
    fi
}

s3_download() {
    local s3_path="$1"
    local local_file="$2"
    
    # Security: Validate S3 path before use
    if ! validate_s3_path "$s3_path"; then
        log_error "Invalid S3 path: ${s3_path}"
        return 1
    fi
    
    # Security: Validate local file path (must be in /tmp or backup directory)
    local file_dir=$(dirname "$local_file")
    if [[ "$file_dir" != "/tmp" ]] && [[ "$file_dir" != "$BACKUP_DIR"* ]] && [[ "$file_dir" != "$BASE_DIR"* ]]; then
        log_error "Invalid local file path (security check): ${local_file}"
        return 1
    fi
    
    if [[ -z "${S3_ENABLED:-}" ]] || [[ "${S3_ENABLED}" != "true" ]]; then
        log_error "S3 is not enabled"
        return 1
    fi
    
    if ! command_exists aws; then
        log_error "AWS CLI is not installed"
        return 1
    fi
    
    local endpoint_url=""
    if [[ -n "${S3_ENDPOINT:-}" ]]; then
        # Security: Validate endpoint URL format
        if [[ ! "${S3_ENDPOINT}" =~ ^https?:// ]]; then
            log_error "Invalid S3 endpoint format: ${S3_ENDPOINT}"
            return 1
        fi
        endpoint_url="--endpoint-url ${S3_ENDPOINT}"
    fi
    
    # Configure path-style for Contabo S3 compatibility
    local path_style=""
    if [[ -n "${S3_FORCE_PATH_STYLE:-}" ]] && [[ "${S3_FORCE_PATH_STYLE}" == "true" ]]; then
        # AWS CLI v2 uses --force-path-style flag
        path_style="--force-path-style"
    fi
    
    log_info "Downloading s3://${S3_BUCKET}/${s3_path} to ${local_file}..."
    
    if aws s3 cp "s3://${S3_BUCKET}/${s3_path}" "$local_file" \
        ${endpoint_url} \
        ${path_style} \
        --region "${S3_REGION:-eu-central-1}" \
        --quiet; then
        log_success "Downloaded from S3: ${s3_path}"
        return 0
    else
        log_error "Failed to download from S3: ${s3_path}"
        return 1
    fi
}

s3_exists() {
    local s3_path="$1"
    
    # Security: Validate S3 path before use
    if ! validate_s3_path "$s3_path"; then
        return 1
    fi
    
    if [[ -z "${S3_ENABLED:-}" ]] || [[ "${S3_ENABLED}" != "true" ]]; then
        return 1
    fi
    
    if ! command_exists aws; then
        return 1
    fi
    
    local endpoint_url=""
    if [[ -n "${S3_ENDPOINT:-}" ]]; then
        # Security: Validate endpoint URL format
        if [[ ! "${S3_ENDPOINT}" =~ ^https?:// ]]; then
            return 1
        fi
        endpoint_url="--endpoint-url ${S3_ENDPOINT}"
    fi
    
    # Configure path-style for Contabo S3 compatibility
    local path_style=""
    if [[ -n "${S3_FORCE_PATH_STYLE:-}" ]] && [[ "${S3_FORCE_PATH_STYLE}" == "true" ]]; then
        # AWS CLI v2 uses --force-path-style flag
        path_style="--force-path-style"
    fi
    
    aws s3 ls "s3://${S3_BUCKET}/${s3_path}" \
        ${endpoint_url} \
        ${path_style} \
        --region "${S3_REGION:-eu-central-1}" \
        >/dev/null 2>&1
}

# ============================================================================
# EDGE CASE HANDLERS
# ============================================================================

# 1. Disk Space Management
check_disk_space_before_backup() {
    local required_space_gb="${1:-20}"  # Minimum required space in GB
    local available=$(check_disk_space "$BACKUP_DIR")
    
    if [[ "$available" -lt "$required_space_gb" ]]; then
        log_warning "Low disk space: ${available}GB available (required: ${required_space_gb}GB)"
        
        # Try aggressive cleanup
        cleanup_old_backups_aggressive
        
        # Re-check
        available=$(check_disk_space "$BACKUP_DIR")
        if [[ "$available" -lt "$required_space_gb" ]]; then
            log_error "Insufficient disk space even after cleanup: ${available}GB available"
            send_alert "CRITICAL" "Disk space exhausted on backup server: ${available}GB available"
            return 1
        fi
        
        log_success "Freed up space, now have ${available}GB available"
    fi
    
    return 0
}

cleanup_old_backups_aggressive() {
    log_info "Running aggressive backup cleanup..."
    
    # Remove hourly backups older than 24 hours
    find "${BACKUP_DIR}/postgres/hourly" -type f -mtime +1 -delete 2>/dev/null || true
    find "${BACKUP_DIR}/dragonfly/hourly" -type f -mtime +1 -delete 2>/dev/null || true
    
    # Remove daily backups older than 7 days
    find "${BACKUP_DIR}/postgres/daily" -type f -mtime +7 -delete 2>/dev/null || true
    find "${BACKUP_DIR}/dragonfly/daily" -type f -mtime +7 -delete 2>/dev/null || true
    
    # Remove weekly backups older than 28 days
    find "${BACKUP_DIR}/postgres/weekly" -type f -mtime +28 -delete 2>/dev/null || true
    find "${BACKUP_DIR}/dragonfly/weekly" -type f -mtime +28 -delete 2>/dev/null || true
    
    # Keep only last 3 pre-deployment backups
    cleanup_backup_type "pre-deployment" 3
    
    # Keep only last 5 success backups
    cleanup_backup_type "success" 5
    
    log_success "Aggressive cleanup completed"
}

cleanup_backup_type() {
    local backup_type="$1"
    local keep_count="$2"
    
    # Find and remove old backups of this type
    local postgres_dir="${BACKUP_DIR}/postgres/${backup_type}"
    local dragonfly_dir="${BACKUP_DIR}/dragonfly/${backup_type}"
    
    if [[ -d "$postgres_dir" ]]; then
        ls -t "$postgres_dir"/*.sql.gz 2>/dev/null | tail -n +$((keep_count + 1)) | xargs rm -f 2>/dev/null || true
    fi
    
    if [[ -d "$dragonfly_dir" ]]; then
        ls -t "$dragonfly_dir"/*.rdb.gz 2>/dev/null | tail -n +$((keep_count + 1)) | xargs rm -f 2>/dev/null || true
    fi
}

# 2. S3 Upload with Retry Logic
s3_upload_with_retry() {
    local file="$1"
    local s3_path="$2"
    local max_retries="${3:-3}"
    local retry_delay="${4:-5}"
    
    for i in $(seq 1 $max_retries); do
        if s3_upload "$file" "$s3_path"; then
            return 0
        fi
        
        if [[ $i -lt $max_retries ]]; then
            log_warning "S3 upload failed (attempt $i/$max_retries), retrying in ${retry_delay}s..."
            sleep $retry_delay
            retry_delay=$((retry_delay * 2))  # Exponential backoff
        fi
    done
    
    # Store failed upload for later retry
    local failed_uploads_log="/var/log/backups/failed-uploads.txt"
    mkdir -p "$(dirname "$failed_uploads_log")"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$file|$s3_path" >> "$failed_uploads_log"
    
    log_error "S3 upload failed after $max_retries attempts"
    send_alert "WARNING" "S3 upload failed for: $s3_path"
    return 1
}

# 3. Deployment Lock Management
acquire_deployment_lock() {
    local lock_file="/var/lock/healthcare-deployment.lock"
    local max_wait="${1:-300}"  # 5 minutes default
    local waited=0
    
    # Create lock directory if it doesn't exist
    mkdir -p "$(dirname "$lock_file")"
    
    while [[ -f "$lock_file" ]]; then
        if [[ $waited -ge $max_wait ]]; then
            local lock_pid=$(cat "$lock_file" 2>/dev/null || echo "unknown")
            log_error "Another deployment is running (PID: $lock_pid, timeout after ${max_wait}s)"
            send_alert "ERROR" "Deployment blocked: concurrent deployment detected"
            return 1
        fi
        
        log_info "Waiting for concurrent deployment to finish..."
        sleep 10
        waited=$((waited + 10))
    done
    
    # Create lock with PID and timestamp
    echo "$$|$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$lock_file"
    
    # Set trap to remove lock on exit
    trap "release_deployment_lock" EXIT INT TERM
    
    log_success "Deployment lock acquired (PID: $$)"
    return 0
}

release_deployment_lock() {
    local lock_file="/var/lock/healthcare-deployment.lock"
    if [[ -f "$lock_file" ]]; then
        local lock_pid=$(cat "$lock_file" 2>/dev/null | cut -d'|' -f1)
        if [[ "$lock_pid" == "$$" ]]; then
            rm -f "$lock_file"
            log_info "Deployment lock released"
        fi
    fi
}

# 4. Backup Verification
verify_backup() {
    local backup_file="$1"
    local metadata_file="$2"
    
    log_info "Verifying backup: $(basename "$backup_file")"
    
    # Check file exists and is not empty
    if [[ ! -s "$backup_file" ]]; then
        log_error "Backup file is empty or missing: $backup_file"
        return 1
    fi
    
    # Verify checksum if metadata exists
    if [[ -f "$metadata_file" ]]; then
        if command_exists jq; then
            local stored_checksum=$(jq -r '.checksum' "$metadata_file" 2>/dev/null | cut -d: -f2)
            local actual_checksum=$(calculate_checksum "$backup_file")
            
            if [[ -n "$stored_checksum" ]] && [[ "$stored_checksum" != "$actual_checksum" ]]; then
                log_error "Backup checksum mismatch - file may be corrupted"
                log_error "Expected: $stored_checksum"
                log_error "Actual: $actual_checksum"
                send_alert "CRITICAL" "Backup corruption detected: $(basename "$backup_file")"
                return 1
            fi
        fi
    fi
    
    # Test file integrity (can it be decompressed?)
    if [[ "$backup_file" == *.gz ]]; then
        if ! gzip -t "$backup_file" 2>/dev/null; then
            log_error "Backup file is corrupted (gzip test failed)"
            return 1
        fi
    fi
    
    log_success "Backup verification passed"
    return 0
}

# 5. Network Connectivity Verification
verify_container_networking() {
    log_info "Verifying container networking..."
    
    local tests_passed=0
    local tests_failed=0
    
    # Test postgres -> dragonfly
    if docker exec postgres ping -c 1 -W 2 dragonfly > /dev/null 2>&1; then
        log_success "✓ postgres can reach dragonfly"
        tests_passed=$((tests_passed + 1))
    else
        log_error "✗ postgres cannot reach dragonfly"
        tests_failed=$((tests_failed + 1))
    fi
    
    # Test api -> postgres (if api is running)
    if container_running "latest-api"; then
        if docker exec latest-api sh -c "nc -zv postgres 5432" > /dev/null 2>&1; then
            log_success "✓ api can reach postgres:5432"
            tests_passed=$((tests_passed + 1))
        else
            log_error "✗ api cannot reach postgres:5432"
            tests_failed=$((tests_failed + 1))
        fi
    fi
    
    # Test api -> dragonfly (if api is running)
    if container_running "latest-api"; then
        if docker exec latest-api sh -c "nc -zv dragonfly 6379" > /dev/null 2>&1; then
            log_success "✓ api can reach dragonfly:6379"
            tests_passed=$((tests_passed + 1))
        else
            log_error "✗ api cannot reach dragonfly:6379"
            tests_failed=$((tests_failed + 1))
        fi
    fi
    
    if [[ $tests_failed -gt 0 ]]; then
        log_error "Network connectivity issues detected ($tests_failed failed, $tests_passed passed)"
        return 1
    fi
    
    log_success "Container networking verified ($tests_passed tests passed)"
    return 0
}

# 6. Container Resource Monitoring
check_container_resources() {
    local container="$1"
    local mem_threshold="${2:-90}"  # Default 90%
    local cpu_threshold="${3:-90}"  # Default 90%
    
    if ! container_running "$container"; then
        return 0
    fi
    
    # Check memory usage
    local mem_usage=$(docker stats --no-stream --format "{{.MemPerc}}" "$container" 2>/dev/null | sed 's/%//')
    if [[ -n "$mem_usage" ]] && (( $(echo "$mem_usage > $mem_threshold" | bc -l 2>/dev/null || echo 0) )); then
        log_warning "Container $container memory usage: ${mem_usage}% (threshold: ${mem_threshold}%)"
        send_alert "WARNING" "High memory usage on $container: ${mem_usage}%"
    fi
    
    # Check CPU usage
    local cpu_usage=$(docker stats --no-stream --format "{{.CPUPerc}}" "$container" 2>/dev/null | sed 's/%//')
    if [[ -n "$cpu_usage" ]] && (( $(echo "$cpu_usage > $cpu_threshold" | bc -l 2>/dev/null || echo 0) )); then
        log_warning "Container $container CPU usage: ${cpu_usage}% (threshold: ${cpu_threshold}%)"
    fi
}

# 7. Zombie Container Cleanup
cleanup_zombie_containers() {
    log_info "Checking for zombie containers..."
    
    # Find containers with old prefixes or stopped containers
    local zombies=$(docker ps -a --filter "status=exited" --filter "name=${CONTAINER_PREFIX:-latest-}" --format "{{.Names}}" 2>/dev/null)
    
    if [[ -n "$zombies" ]]; then
        log_warning "Found zombie containers:"
        echo "$zombies" | while read container; do
            log_info "  - $container"
            docker rm -f "$container" 2>/dev/null || log_warning "Failed to remove $container"
        done
        log_success "Zombie container cleanup completed"
    else
        log_info "No zombie containers found"
    fi
}

# 8. Alert System (placeholder - can be extended with Slack/Email)
send_alert() {
    local severity="$1"  # INFO, WARNING, ERROR, CRITICAL
    local message="$2"
    
    # Log the alert
    log_warning "ALERT [$severity]: $message"
    
    # TODO: Implement Slack/Email notifications
    # Example: curl -X POST -H 'Content-type: application/json' \
    #   --data "{\"text\":\"[$severity] $message\"}" \
    #   "$SLACK_WEBHOOK_URL"
    
    # Write to alert log
    local alert_log="/var/log/deployments/alerts.log"
    mkdir -p "$(dirname "$alert_log")"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$severity|$message" >> "$alert_log"
}

# 9. Find Last Backup by Type
find_last_backup() {
    local backup_type="$1"  # success, pre-deployment, daily, weekly, hourly
    
    # Look for metadata files
    local metadata_dir="${BACKUP_DIR}/metadata"
    
    if [[ ! -d "$metadata_dir" ]]; then
        return 1
    fi
    
    # Find most recent backup of this type
    local last_backup=$(ls -t "$metadata_dir"/${backup_type}-*.json 2>/dev/null | head -1)
    
    if [[ -n "$last_backup" ]]; then
        # Extract backup ID from filename
        basename "$last_backup" .json
        return 0
    fi
    
    return 1
}

# 10. Restore Backup (wrapper with validation)
restore_backup() {
    local backup_id="$1"
    
    if ! validate_backup_id "$backup_id"; then
        log_error "Invalid backup ID: $backup_id"
        return 1
    fi
    
    log_info "Restoring backup: $backup_id"
    
    # Find restore script
    local restore_script="${SCRIPT_DIR}/restore.sh"
    if [[ ! -f "$restore_script" ]]; then
        restore_script="${BASE_DIR}/devops/scripts/docker-infra/restore.sh"
    fi
    
    if [[ ! -f "$restore_script" ]]; then
        log_error "restore.sh not found"
        return 1
    fi
    
    # Execute restore
    if "$restore_script" "$backup_id"; then
        log_success "Backup restored successfully: $backup_id"
        return 0
    else
        log_error "Backup restore failed: $backup_id"
        return 1
    fi
}

# Initialize on source
ensure_directories
# Load environment variables (with validation warnings but no auto-fix by default)
# Scripts can call validate_and_fix_env_file() or validate_env_file() manually if needed
load_env

