#!/bin/bash
# Fix Missing Files Script
# Wrapper script that uses utility functions from utils.sh to restore missing files
# This script can be run standalone or called by other scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source utils.sh - handle both normal directory structure and /tmp/ execution
if ! command -v log_info &>/dev/null; then
    if [[ -f "${SCRIPT_DIR}/../shared/utils.sh" ]]; then
        source "${SCRIPT_DIR}/../shared/utils.sh"
    elif [[ -f "/tmp/utils.sh" ]]; then
        source "/tmp/utils.sh"
    elif [[ -f "/opt/healthcare-backend/devops/scripts/shared/utils.sh" ]]; then
        source "/opt/healthcare-backend/devops/scripts/shared/utils.sh"
    else
        echo "ERROR: Cannot find utils.sh" >&2
        exit 1
    fi
fi

# Ensure BASE_DIR is set
BASE_DIR="${BASE_DIR:-/opt/healthcare-backend}"

log_info "=== Fixing Missing Files ==="
log_info "BASE_DIR: ${BASE_DIR}"

# Main function - uses utility functions from utils.sh
main() {
    local fixes_applied=0
    local fixes_failed=0
    
    log_info "Checking critical files..."
    
    # Fix docker-compose.prod.yml (uses ensure_compose_file from utils.sh)
    if ensure_compose_file; then
        fixes_applied=$((fixes_applied + 1))
        log_success "✓ docker-compose.prod.yml is present"
    else
        fixes_failed=$((fixes_failed + 1))
    fi
    
    # Fix .env.production (uses ensure_env_file from utils.sh)
    # Note: Non-critical for infrastructure-only operations
    if ensure_env_file; then
        fixes_applied=$((fixes_applied + 1))
        log_success "✓ .env.production is present"
    else
        # Don't count this as a failure since it requires manual intervention
        log_warning ".env.production requires manual creation with sensitive data"
    fi
    
    # Summary
    log_info ""
    log_info "=== Fix Summary ==="
    log_info "Files restored: ${fixes_applied}"
    if [[ $fixes_failed -gt 0 ]]; then
        log_warning "Files that need manual attention: ${fixes_failed}"
        return 1
    else
        log_success "All critical files are present"
        return 0
    fi
}

# Run main function
main "$@"

