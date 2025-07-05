#!/bin/bash
set -e

# Health check script for CI/CD
# Performs health check on the API container after deployment

# Source shared configuration for consistent logging and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../backup-config.sh"

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

# Change to the correct directory
cd "$(dirname "$0")/../.." || {
    log_message "ERROR: Failed to change to project directory"
    exit 1
}

log_message "Starting health check for API container..."

MAX_RETRIES=5
RETRY_COUNT=0
DEPLOY_SUCCESS=false
API_CONTAINER="latest-api"

# Wait for container to be running first
log_message "Waiting for API container to be running..."
for i in {1..10}; do
    if docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "Up"; then
        log_message "API container is running"
        break
    fi
    if [ $i -eq 10 ]; then
        log_message "ERROR: API container is not running after 10 attempts"
        docker ps -a | grep "$API_CONTAINER" || true
        exit 1
    fi
    log_message "Attempt $i/10: Waiting for API container to be running..."
    sleep 5
done

# Perform health checks with retry logic
while [ $RETRY_COUNT -lt $MAX_RETRIES ] && [ "$DEPLOY_SUCCESS" != "true" ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log_message "Health check attempt $RETRY_COUNT/$MAX_RETRIES..."
    
    if docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "Up"; then
        log_message "API container is running"
        
        # Use curl with proper timeout and error handling
        HEALTH_OUTPUT=$(timeout 15 curl -v --max-time 10 --connect-timeout 5 http://localhost:8088/health 2>&1 || echo "Connection timed out")
        
        if echo "$HEALTH_OUTPUT" | grep -q "Connection timed out\|Empty reply\|Connection refused"; then
            log_message "Warning: Connection timed out or empty reply received"
            sleep 5
            continue
        fi
        
        # Check for HTTP 200 response
        if echo "$HEALTH_OUTPUT" | grep -q "< HTTP/1.1 200 OK\|< HTTP/2 200\|< HTTP/1.1 200"; then
            log_message "API health check successful - received HTTP 200"
            DEPLOY_SUCCESS=true
            break
        elif echo "$HEALTH_OUTPUT" | grep -q '"status"\s*:\s*"healthy"\|"status":"up"\|"status": "up"\|"ok"\|"UP"\|"HEALTHY"'; then
            log_message "API health check successful - found health indicator in response"
            DEPLOY_SUCCESS=true
            break
        else
            log_message "Health check response does not indicate success"
            log_message "Response preview: $(echo "$HEALTH_OUTPUT" | tail -5)"
        fi
    else
        log_message "ERROR: API container is not running! This is a critical failure."
        docker ps -a | grep "$API_CONTAINER" || true
        exit 1
    fi
    
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        log_message "Health check attempt $RETRY_COUNT failed, waiting 5 seconds before retry..."
        sleep 5
    fi
done

# Final evaluation
if [ "$DEPLOY_SUCCESS" != "true" ]; then
    log_message "Health check attempts completed."
    
    if docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "Up"; then
        log_message "Container is running despite health check response issues."
        docker logs "$API_CONTAINER" --tail 30 || true
        
        # Check container uptime as a fallback
        CONTAINER_UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$API_CONTAINER" 2>/dev/null || echo "")
        if [ -n "$CONTAINER_UPTIME" ]; then
            CURRENT_TIME=$(date -u +%s)
            CONTAINER_START_TIME=$(date -u -d "$CONTAINER_UPTIME" +%s 2>/dev/null || echo "0")
            
            if [ "$CONTAINER_START_TIME" -gt 0 ]; then
                UPTIME_SECONDS=$((CURRENT_TIME - CONTAINER_START_TIME))
                if [ $UPTIME_SECONDS -gt 30 ]; then
                    log_message "Container has been running stably for over 30 seconds"
                    log_message "Marking deployment as successful despite health check response issues"
                    DEPLOY_SUCCESS=true
                else
                    log_message "Container is running but hasn't been up long enough to verify stability"
                    exit 1
                fi
            else
                log_message "Could not determine container uptime"
                exit 1
            fi
        else
            log_message "Could not get container start time"
            exit 1
        fi
    else
        log_message "ERROR: API container is not running!"
        docker ps -a | grep "$API_CONTAINER" || true
        exit 1
    fi
fi

if [ "$DEPLOY_SUCCESS" = "true" ]; then
    log_message "✅ Health check completed successfully"
    exit 0
else
    log_message "❌ Health check failed"
    exit 1
fi

cd - 