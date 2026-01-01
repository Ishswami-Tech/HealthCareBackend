#!/bin/bash
# Server Directory Setup Script
# Ensures all required directories exist with proper permissions
# Safe to run multiple times - checks if directories exist before creating

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Base directories
BASE_DIR="/opt/healthcare-backend"
BACKUP_DIR="${BASE_DIR}/backups"
DATA_DIR="${BASE_DIR}/data"
LOG_DIR="/var/log/deployments"

# Global flag for root check
IS_ROOT=false

# Directories to create
declare -a DIRECTORIES=(
    "${BASE_DIR}"
    "${BACKUP_DIR}/postgres"
    "${BACKUP_DIR}/dragonfly"
    "${BACKUP_DIR}/metadata"
    "${DATA_DIR}/postgres"
    "${DATA_DIR}/dragonfly"
    "${DATA_DIR}/openvidu_recordings"
    "${LOG_DIR}"
)

# Function to ensure directory exists
ensure_directory() {
    local dir="$1"
    local mode="${2:-755}"
    
    if [[ -d "$dir" ]]; then
        log_info "Directory already exists: ${dir}"
        # Update permissions if needed
        if $IS_ROOT; then
            chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
        else
            # For /var/log directories, use sudo even if directory exists
            if [[ "$dir" == /var/log* ]]; then
                sudo chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
            else
        chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
            fi
        fi
        return 0
    fi
    
    # Check if directory is in /var/log (requires sudo if not root)
    local needs_sudo=false
    if [[ "$dir" == /var/log* ]] && ! $IS_ROOT; then
        needs_sudo=true
    fi
    
    # Create parent directories if needed
    local parent=$(dirname "$dir")
    if [[ ! -d "$parent" ]]; then
        log_info "Creating parent directory: ${parent}"
        if [[ "$parent" == /var/log* ]] && ! $IS_ROOT; then
            sudo mkdir -p "$parent" || log_error "Failed to create parent directory: ${parent}"
        else
            mkdir -p "$parent" || log_error "Failed to create parent directory: ${parent}"
        fi
    fi
    
    # Create directory
    log_info "Creating directory: ${dir}"
    if $needs_sudo; then
        sudo mkdir -p "$dir" || log_error "Failed to create directory: ${dir}"
        sudo chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
    else
        mkdir -p "$dir" || log_error "Failed to create directory: ${dir}"
    chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
    fi
    
    log_success "Directory created: ${dir}"
}

# Function to set ownership (if running as root)
set_ownership() {
    local dir="$1"
    local user="${2:-}"
    local group="${3:-}"
    
    if [[ -z "$user" ]]; then
        # Try to detect current user
        user=$(whoami 2>/dev/null || echo "")
    fi
    
    if [[ -z "$user" ]] || [[ "$(id -u)" != "0" ]]; then
        # Not running as root, skip ownership change
        return 0
    fi
    
    if [[ -n "$user" ]] && id "$user" &>/dev/null; then
        log_info "Setting ownership of ${dir} to ${user}:${group:-$user}"
        chown -R "${user}:${group:-$user}" "$dir" 2>/dev/null || log_warning "Could not set ownership on ${dir}"
    fi
}

# Main execution
main() {
    log_info "Setting up server directories..."
    
    # Check if running as root (optional)
    if [[ "$(id -u)" == "0" ]]; then
        IS_ROOT=true
        log_info "Running as root - will set proper ownership"
    else
        IS_ROOT=false
        log_info "Not running as root - will use sudo for /var/log directories"
    fi
    
    # Create all directories
    for dir in "${DIRECTORIES[@]}"; do
        # Set appropriate permissions
        local mode="755"
        if [[ "$dir" == "$BACKUP_DIR" ]] || [[ "$dir" == "$BACKUP_DIR"* ]]; then
            # Backup directories should be more restrictive
            mode="700"
        elif [[ "$dir" == "$DATA_DIR"* ]]; then
            # Data directories
            mode="755"
        elif [[ "$dir" == "$LOG_DIR" ]]; then
            # Log directory
            mode="755"
        fi
        
        ensure_directory "$dir" "$mode"
        
        # Set ownership if root
        if $IS_ROOT; then
            # Try to find the appropriate user (common: docker, root, or current user)
            local owner_user=""
            if id "docker" &>/dev/null; then
                owner_user="docker"
            elif id "www-data" &>/dev/null; then
                owner_user="www-data"
            else
                owner_user=$(stat -c '%U' "$BASE_DIR" 2>/dev/null || echo "")
            fi
            
            if [[ -n "$owner_user" ]]; then
                set_ownership "$dir" "$owner_user"
            fi
        fi
    done
    
    # Verify critical directories
    log_info "Verifying directory structure..."
    local all_ok=true
    
    for dir in "${DIRECTORIES[@]}"; do
        if [[ ! -d "$dir" ]]; then
            log_error "Directory missing: ${dir}"
            all_ok=false
        else
            log_success "Verified: ${dir}"
        fi
    done
    
    if $all_ok; then
        log_success "All directories are set up correctly"
        
        # Display directory structure
        echo ""
        log_info "Directory structure:"
        echo "  ${BASE_DIR}/"
        echo "    ├── backups/"
        echo "    │   ├── postgres/"
        echo "    │   ├── dragonfly/"
        echo "    │   └── metadata/"
        echo "    └── data/"
        echo "        ├── postgres/"
        echo "        ├── dragonfly/"
        echo "        └── openvidu_recordings/"
        echo ""
        log_info "Log directory: ${LOG_DIR}"
        
        exit 0
    else
        log_error "Some directories are missing"
        exit 1
    fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

