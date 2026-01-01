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
    
    if [[ ! -d "${LOG_DIR}" ]]; then
        mkdir -p "${LOG_DIR}"
        log_info "Created directory: ${LOG_DIR}"
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
    chmod 755 "${LOG_DIR}" 2>/dev/null || true
    chmod 755 "${BASE_DIR}/data" 2>/dev/null || true
}

# Load environment variables
load_env() {
    if [[ -f "${ENV_FILE}" ]]; then
        set -a
        source "${ENV_FILE}"
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
    docker ps --format '{{.Names}}' | grep -q "^${container}$" >/dev/null 2>&1
}

# Get container status
get_container_status() {
    local container="$1"
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

# S3 helper functions (using AWS CLI or direct API)
s3_upload() {
    local local_file="$1"
    local s3_path="$2"
    
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
    
    if [[ -z "${S3_ENABLED:-}" ]] || [[ "${S3_ENABLED}" != "true" ]]; then
        return 1
    fi
    
    if ! command_exists aws; then
        return 1
    fi
    
    local endpoint_url=""
    if [[ -n "${S3_ENDPOINT:-}" ]]; then
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

# Initialize on source
ensure_directories
load_env

