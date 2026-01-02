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
            # For /var/log directories, use sudo if available
            if [[ "$dir" == /var/log* ]]; then
                if sudo -n true 2>/dev/null; then
                    sudo chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
                else
                    chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir} (sudo required)"
                fi
            else
                chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
            fi
        fi
        return 0
    fi
    
    # Check if directory is in /var/log (requires sudo if not root)
    local needs_sudo=false
    local sudo_available=false
    if [[ "$dir" == /var/log* ]] && ! $IS_ROOT; then
        needs_sudo=true
        # Check if sudo is available without password (NOPASSWD)
        if sudo -n true 2>/dev/null; then
            sudo_available=true
        else
            # Sudo requires password - try anyway but don't fail if it doesn't work
            sudo_available=false
        fi
    fi
    
    # Create parent directories if needed
    local parent=$(dirname "$dir")
    if [[ ! -d "$parent" ]]; then
        log_info "Creating parent directory: ${parent}"
        if [[ "$parent" == /var/log* ]] && ! $IS_ROOT; then
            if $sudo_available; then
                sudo mkdir -p "$parent" 2>/dev/null || log_warning "Could not create parent directory with sudo: ${parent}"
            else
                # Try without sudo - might work if directory already exists or permissions allow
                mkdir -p "$parent" 2>/dev/null || log_warning "Could not create parent directory: ${parent} (sudo required but not available)"
            fi
        else
            mkdir -p "$parent" || log_error "Failed to create parent directory: ${parent}"
        fi
    fi
    
    # Create directory
    log_info "Creating directory: ${dir}"
    if $needs_sudo; then
        if $sudo_available; then
            sudo mkdir -p "$dir" 2>/dev/null || log_warning "Could not create directory with sudo: ${dir}"
            sudo chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
        else
            # Try without sudo - might work if directory already exists
            if mkdir -p "$dir" 2>/dev/null; then
                chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
            else
                log_warning "Could not create ${dir} - sudo required but password not available. Directory may already exist."
            fi
        fi
    else
        mkdir -p "$dir" || log_error "Failed to create directory: ${dir}"
        chmod "$mode" "$dir" 2>/dev/null || log_warning "Could not set permissions on ${dir}"
    fi
    
    # Check if directory exists (even if creation failed, it might already exist)
    if [[ -d "$dir" ]]; then
        log_success "Directory created/exists: ${dir}"
    else
        log_warning "Directory may not exist: ${dir} (check permissions or create manually)"
    fi
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
    local critical_missing=false
    
    for dir in "${DIRECTORIES[@]}"; do
        if [[ ! -d "$dir" ]]; then
            # /var/log directories are optional if sudo is not available
            if [[ "$dir" == /var/log* ]] && ! $IS_ROOT && ! sudo -n true 2>/dev/null; then
                log_warning "Directory missing (sudo required): ${dir} - This is optional if sudo is not configured"
                # Don't mark as critical failure for /var/log if sudo is not available
            else
                log_error "Directory missing: ${dir}"
                critical_missing=true
                all_ok=false
            fi
        else
            log_success "Verified: ${dir}"
        fi
    done
    
    if ! $critical_missing; then
        log_success "All critical directories are set up correctly"
        
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
        if [[ -d "${LOG_DIR}" ]]; then
            log_info "Log directory: ${LOG_DIR}"
        else
            log_warning "Log directory not available: ${LOG_DIR} (sudo required)"
        fi
        
        exit 0
    else
        log_error "Some critical directories are missing"
        exit 1
    fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

