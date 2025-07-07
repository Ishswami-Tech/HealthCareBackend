#!/bin/bash
set -e

# Healthcare Backend Rollback Script
# This script handles rollback operations when deployment fails

# Source shared configuration for consistent logging and paths
source "/var/www/healthcare/backend/scripts/backup-config.sh"

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

# Configuration
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/healthcare/backend}"
SUCCESSFUL_DEPLOYMENTS_FILE="$DEPLOY_PATH/successful_deployments.txt"
WORKER_COUNT="${WORKER_COUNT:-2}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to verify container health
check_container_health() {
    local container_name="$1"
    local max_attempts="${2:-10}"
    local attempt=1
    
    log_message "Checking health of container: $container_name"
    
    while [ $attempt -le $max_attempts ]; do
        if docker ps --filter "name=$container_name" --format "{{.Status}}" | grep -q "Up"; then
            log_message "✅ Container $container_name is running"
            return 0
        fi
        
        log_message "Attempt $attempt/$max_attempts: Container $container_name is not running"
        if [ $attempt -lt $max_attempts ]; then
            sleep 5
        fi
        attempt=$((attempt + 1))
    done
    
    log_message "❌ Container $container_name failed to start after $max_attempts attempts"
    return 1
}

# Function to verify API health
check_api_health() {
    local max_attempts="${1:-10}"
    local attempt=1
    
    log_message "Checking API health..."
    
    while [ $attempt -le $max_attempts ]; do
        log_message "Health check attempt $attempt/$max_attempts..."
        
        HEALTH_OUTPUT=$(timeout 10 curl -v --max-time 8 --connect-timeout 5 http://localhost:8088/health 2>&1 || echo "Connection failed")
        
        if echo "$HEALTH_OUTPUT" | grep -q "< HTTP/1.1 200 OK\|< HTTP/2 200"; then
            log_message "✅ API is healthy after rollback (HTTP 200)"
            return 0
        elif echo "$HEALTH_OUTPUT" | grep -q "ok\|status.*up\|\"status\":\"ok\"\|\"status\": \"ok\""; then
            log_message "✅ API is healthy after rollback (status indicators)"
            return 0
        fi
        
        log_message "Health check attempt $attempt failed"
        if [ $attempt -lt $max_attempts ]; then
            sleep 5
        fi
        attempt=$((attempt + 1))
    done
    
    log_message "❌ API health check failed after $max_attempts attempts"
    return 1
}

# Function to get the last successful deployment
get_last_successful_deployment() {
    if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
        # Get the last successful deployment that's not the current one
        local current_deploy=""
        if [ -L "$DEPLOY_PATH/current" ]; then
            current_deploy=$(basename "$(readlink -f "$DEPLOY_PATH/current")")
        fi
        
        if [ -n "$current_deploy" ]; then
            grep -v "$current_deploy" "$SUCCESSFUL_DEPLOYMENTS_FILE" | tail -n 1
        else
            tail -n 1 "$SUCCESSFUL_DEPLOYMENTS_FILE"
        fi
    else
        echo ""
    fi
}

# Function to perform automated rollback
perform_automated_rollback() {
    local last_successful="$1"
    
    log_message "Performing automated rollback to: $last_successful"
    
    if [ -z "$last_successful" ] || [ ! -d "$DEPLOY_PATH/releases/$last_successful" ]; then
        log_message "❌ No valid previous deployment found for rollback"
        return 1
    fi
    
    # Stop current API container
    log_message "Stopping current API container..."
    docker stop latest-api 2>/dev/null || log_message "No API container found to stop"
    docker rm latest-api 2>/dev/null || log_message "No API container found to remove"
    
    # Clean up Docker resources specifically for API only
    log_message "Cleaning up API Docker resources..."
    docker system prune -f --filter "label=com.docker.compose.service=api" 2>/dev/null || log_message "No API resources to prune"
    
    # Update symlink to the last successful deployment
    log_message "Updating symlink to point to releases/$last_successful"
    ln -sfn "$DEPLOY_PATH/releases/$last_successful" "$DEPLOY_PATH/current"
    
    # Start the API from the last successful deployment
    cd "$DEPLOY_PATH/current" || {
        log_message "ERROR: Failed to change to current directory"
        return 1
    }
    
    log_message "Starting API from previous successful deployment in $(pwd)"
    
    # Check if docker-compose.prod.yml exists
    if [ ! -f "docker-compose.prod.yml" ]; then
        log_message "❌ ERROR: docker-compose.prod.yml not found in $(pwd)"
        ls -la
        return 1
    fi
    
    # Create temporary env file for deployment
    log_message "Setting up environment variables..."
    cat > .env.deploy << EOF
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
WORKER_COUNT=${WORKER_COUNT}
EOF
    
    # Using --no-deps ensures database containers are not touched
    log_message "Starting API container with environment variables..."
    if docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d --build --no-deps --scale worker=$WORKER_COUNT api worker; then
        log_message "API container started successfully"
    else
        log_message "❌ Failed to start API container"
        rm -f .env.deploy
        return 1
    fi
    
    # Verify deployment
    log_message "Verifying deployment..."
    if docker exec latest-api env | grep -q "GOOGLE_CLIENT"; then
        log_message "✅ Environment variables verified in container"
    else
        log_message "❌ WARNING: Google environment variables not found in container"
        docker logs latest-api --tail 50 || true
    fi
    
    # Cleanup
    rm -f .env.deploy
    
    # Verify database containers are still running
    log_message "Verifying database containers are still running..."
    
    # Check if any PostgreSQL container is running
    if ! docker ps | grep -q "postgres"; then
        log_message "Warning: No PostgreSQL container appears to be running after rollback. Starting it..."
        docker compose -f docker-compose.prod.yml up -d --no-recreate postgres || log_message "WARNING: Failed to start PostgreSQL"
    else
        log_message "PostgreSQL container appears to be running."
    fi
    
    # Check if any Redis container is running
    if ! docker ps | grep -q "redis" | grep -v "commander"; then
        log_message "Warning: No Redis container appears to be running after rollback. Starting it..."
        docker compose -f docker-compose.prod.yml up -d --no-recreate redis || log_message "WARNING: Failed to start Redis"
    else
        log_message "Redis container appears to be running."
    fi
    
    # Show container status
    log_message "Container status after rollback:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
    
    # Wait for API to be healthy
    if check_api_health 10; then
        log_message "✅ Rollback completed successfully"
        return 0
    else
        log_message "❌ Rollback failed - API is not healthy"
        return 1
    fi
}

# Function to perform manual rollback using backup
perform_manual_rollback() {
    log_message "Performing manual rollback using backup..."
    
    # Check for backup directory
    if [ ! -d "$BACKUP_DIR" ]; then
        log_message "❌ No backup directory found"
        return 1
    fi
    
    # Find the latest backup
    local latest_backup=""
    if [ -f "$LATEST_BACKUP_MARKER" ]; then
        latest_backup=$(cat "$LATEST_BACKUP_MARKER")
    else
        latest_backup=$(find "$BACKUP_DIR" -maxdepth 1 -type d -not -name "." -not -name ".." | sort -r | head -n 1 | xargs basename)
    fi
    
    if [ -z "$latest_backup" ] || [ ! -d "$BACKUP_DIR/$latest_backup" ]; then
        log_message "❌ No valid backup found for rollback"
        return 1
    fi
    
    log_message "Found backup: $latest_backup"
    
    # Stop current containers
    log_message "Stopping current containers..."
    docker stop latest-api 2>/dev/null || true
    docker rm latest-api 2>/dev/null || true
    
    # Restore from backup
    log_message "Restoring from backup..."
    if cp -r "$BACKUP_DIR/$latest_backup"/* "$DEPLOY_PATH/current/"; then
        log_message "✅ Backup restored successfully"
        
        # Start containers from restored backup
        cd "$DEPLOY_PATH/current" || {
            log_message "ERROR: Failed to change to current directory"
            return 1
        }
        
        if docker compose -f docker-compose.prod.yml up -d --build --no-deps --scale worker=$WORKER_COUNT api worker; then
            log_message "✅ Containers started from backup"
            
            # Check health
            if check_api_health 10; then
                log_message "✅ Manual rollback completed successfully using backup"
                return 0
            else
                log_message "❌ Manual rollback failed - API is not healthy"
                return 1
            fi
        else
            log_message "❌ Failed to start containers from backup"
            return 1
        fi
    else
        log_message "❌ Failed to restore from backup"
        return 1
    fi
}

# Main execution
main() {
    local mode="${1:-auto}"
    
    log_message "🚨 ROLLBACK PROCESS STARTED =========="
    log_message "Mode: $mode"
    log_message "Deployment path: $DEPLOY_PATH"
    
    # Check if we're in the right directory
    if [ ! -d "$DEPLOY_PATH" ]; then
        log_message "ERROR: Deployment path does not exist: $DEPLOY_PATH"
        exit 1
    fi
    
    cd "$DEPLOY_PATH" || {
        log_message "ERROR: Failed to change to deployment directory"
        exit 1
    }
    
    log_message "Current directory: $(pwd)"
    log_message "Listing deployment directory contents:"
    ls -la || true
    
    # Check current Docker status
    log_message "Current Docker containers:"
    docker ps -a || true
    log_message "Current Docker volumes:"
    docker volume ls || true
    
    # Perform rollback based on mode
    case "$mode" in
        "auto")
            log_message "Attempting automated rollback..."
            last_successful=$(get_last_successful_deployment)
            
            if [ -n "$last_successful" ]; then
                log_message "Found last successful deployment: $last_successful"
                if perform_automated_rollback "$last_successful"; then
                    log_message "✅ Automated rollback completed successfully"
                    exit 0
                else
                    log_message "❌ Automated rollback failed, attempting manual rollback..."
                    if perform_manual_rollback; then
                        log_message "✅ Manual rollback completed successfully"
                        exit 0
                    else
                        log_message "❌ Manual rollback also failed"
                        exit 1
                    fi
                fi
            else
                log_message "No successful deployment found, attempting manual rollback..."
                if perform_manual_rollback; then
                    log_message "✅ Manual rollback completed successfully"
                    exit 0
                else
                    log_message "❌ Manual rollback failed"
                    exit 1
                fi
            fi
            ;;
        "manual")
            log_message "Performing manual rollback..."
            if perform_manual_rollback; then
                log_message "✅ Manual rollback completed successfully"
                exit 0
            else
                log_message "❌ Manual rollback failed"
                exit 1
            fi
            ;;
        *)
            log_message "Usage: $0 [auto|manual]"
            log_message "  auto   - Attempt automated rollback, fallback to manual"
            log_message "  manual - Perform manual rollback only"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@" 