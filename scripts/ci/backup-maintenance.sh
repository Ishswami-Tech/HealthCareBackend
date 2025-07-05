#!/bin/bash
set -e

# Backup and maintenance script
# This script runs backup operations and maintenance tasks after successful deployment

# Source shared configuration for consistent logging and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../backup-config.sh"

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/healthcare/backend}"
GITHUB_SHA="${GITHUB_SHA}"

# Function to log messages with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to handle errors gracefully
handle_error() {
    local exit_code=$?
    local line_number=$1
    log_message "ERROR: Script failed at line $line_number with exit code $exit_code"
    exit $exit_code
}

# Set up error handling
trap 'handle_error $LINENO' ERR

# Change to deployment directory
cd "$DEPLOY_PATH/releases/$GITHUB_SHA" || {
    log_message "ERROR: Failed to change to deployment directory"
    exit 1
}

log_message "Starting backup and maintenance operations..."

# Run backup operations with better error handling
echo "Running backup operations..."

# Database backup
log_message "Creating database backup..."
if [ -f "scripts/backup-database.sh" ]; then
    chmod +x scripts/backup-database.sh
    if ./scripts/backup-database.sh; then
        log_message "Database backup completed successfully"
    else
        log_message "WARNING: Database backup failed, but continuing..."
    fi
else
    log_message "WARNING: backup-database.sh not found, skipping database backup..."
fi

# Offsite backup - use the main scripts directory version
log_message "Creating offsite backup..."
if [ -f "scripts/offsite-backup.sh" ]; then
    chmod +x scripts/offsite-backup.sh
    if ./scripts/offsite-backup.sh; then
        log_message "Offsite backup completed successfully"
    else
        log_message "WARNING: Offsite backup failed, but continuing..."
    fi
else
    log_message "WARNING: offsite-backup.sh not found, skipping offsite backup..."
fi

# Server maintenance
log_message "Running server maintenance..."
if [ -f "scripts/server-maintenance.sh" ]; then
    chmod +x scripts/server-maintenance.sh
    if ./scripts/server-maintenance.sh; then
        log_message "Server maintenance completed successfully"
    else
        log_message "WARNING: Server maintenance failed, but continuing..."
    fi
else
    log_message "WARNING: server-maintenance.sh not found, skipping server maintenance..."
fi

# Database performance monitoring
log_message "Running database performance monitoring..."
if [ -f "scripts/database-performance-monitor.sh" ]; then
    chmod +x scripts/database-performance-monitor.sh
    if ./scripts/database-performance-monitor.sh; then
        log_message "Database performance monitoring completed successfully"
    else
        log_message "WARNING: Database performance monitoring failed, but continuing..."
    fi
else
    log_message "WARNING: database-performance-monitor.sh not found, skipping performance monitoring..."
fi

# Clean up old releases (keep last 5)
log_message "Cleaning up old releases..."
cd "$DEPLOY_PATH/releases" || {
    log_message "ERROR: Failed to change to releases directory"
    exit 1
}

# Use find instead of ls for better reliability
find . -maxdepth 1 -type d -name "*" | sort -r | tail -n +6 | while read -r dir; do
    if [ -n "$dir" ] && [ "$dir" != "." ]; then
        log_message "Removing old release: $dir"
        rm -rf "$dir" || log_message "WARNING: Failed to remove old release: $dir"
    fi
done

# Clean up Docker resources with better error handling
log_message "Cleaning up Docker resources..."

# Clean up old Docker images
if docker image prune -f >/dev/null 2>&1; then
    log_message "Docker images cleaned up successfully"
else
    log_message "WARNING: Failed to clean up Docker images"
fi

# Clean up old Docker containers
if docker container prune -f >/dev/null 2>&1; then
    log_message "Docker containers cleaned up successfully"
else
    log_message "WARNING: Failed to clean up Docker containers"
fi

# Clean up old Docker volumes
if docker volume prune -f >/dev/null 2>&1; then
    log_message "Docker volumes cleaned up successfully"
else
    log_message "WARNING: Failed to clean up Docker volumes"
fi

# Clean up old Docker networks
if docker network prune -f >/dev/null 2>&1; then
    log_message "Docker networks cleaned up successfully"
else
    log_message "WARNING: Failed to clean up Docker networks"
fi

log_message "✅ Backup and maintenance completed successfully" 