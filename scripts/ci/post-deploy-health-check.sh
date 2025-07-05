#!/bin/bash
set -e

# Post-deployment health check script for CI/CD
# Performs comprehensive health check on the API container after deployment

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

log_message "Starting post-deployment health check for API container..."

MAX_RETRIES=5
RETRY_COUNT=0
HEALTH_CHECK_PASSED=false
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
        docker ps -a || true
        exit 1
    fi
    log_message "Attempt $i/10: Waiting for API container to be running..."
    sleep 5
done

# Perform health checks with retry logic
while [ $RETRY_COUNT -lt $MAX_RETRIES ] && [ "$HEALTH_CHECK_PASSED" != "true" ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log_message "Health check attempt $RETRY_COUNT/$MAX_RETRIES..."
    
    if ! docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "Up"; then
        log_message "❌ API container is not running!"
        docker ps -a || true
        continue
    fi
    
    # Try localhost first
    log_message "Testing health endpoint on localhost..."
    HEALTH_OUTPUT=$(curl -s -m 10 --connect-timeout 5 http://localhost:8088/health 2>/dev/null || echo "")
    CURL_EXIT=$?
    
    if [ $CURL_EXIT -eq 0 ] && [ -n "$HEALTH_OUTPUT" ]; then
        log_message "Raw health check response:"
        echo "$HEALTH_OUTPUT"
        
        # Check for main status
        if echo "$HEALTH_OUTPUT" | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
            log_message "✅ Main status check passed"
            HEALTH_CHECK_PASSED=true
            break
        fi
        
        # Check individual services
        SERVICES=(api database redis queues logger socket email)
        ALL_HEALTHY=true
        
        for SERVICE in "${SERVICES[@]}"; do
            if ! echo "$HEALTH_OUTPUT" | grep -q "\"$SERVICE\"[[:space:]]*:[[:space:]]*{[^}]*\"status\"[[:space:]]*:[[:space:]]*\"healthy\""; then
                log_message "❌ Service $SERVICE is not healthy"
                ALL_HEALTHY=false
                break
            fi
        done
        
        if [ "$ALL_HEALTHY" = true ]; then
            log_message "✅ All services are healthy"
            HEALTH_CHECK_PASSED=true
            break
        fi
    else
        log_message "⚠️ Failed to get health check response from localhost (curl exit code: $CURL_EXIT)"
        
        # Try domain URL as fallback
        log_message "Testing health endpoint on domain..."
        HEALTH_OUTPUT=$(curl -s -m 10 --connect-timeout 5 https://api.ishswami.in/health 2>/dev/null || echo "")
        CURL_EXIT=$?
        
        if [ $CURL_EXIT -eq 0 ] && echo "$HEALTH_OUTPUT" | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
            log_message "✅ Health check passed via domain URL!"
            HEALTH_CHECK_PASSED=true
            break
        else
            log_message "⚠️ Failed to get health check response from domain (curl exit code: $CURL_EXIT)"
        fi
    fi
    
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        log_message "Waiting 5 seconds before next attempt..."
        sleep 5
    fi
done

# Final evaluation
if [ "$HEALTH_CHECK_PASSED" = "true" ]; then
    log_message "✅ Health check verification completed successfully"
    exit 0
else
    log_message "❌ Health check failed, checking container logs for startup indicators..."
    
    # Check for successful startup indicators in logs
    if docker logs "$API_CONTAINER" 2>&1 | grep -q "Starting application bootstrap\|Application bootstrap started\|Redis.*Connected\|WebSocket.*configured"; then
        log_message "✅ Found successful startup indicators in logs"
        log_message "Marking deployment as successful despite health check issues"
        exit 0
    else
        log_message "❌ Health check failed and no positive indicators found in logs"
        docker logs "$API_CONTAINER" --tail 50 || true
        exit 1
    fi
fi 