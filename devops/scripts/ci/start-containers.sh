#!/bin/bash
set -e

# Start containers script
# This script starts database and API containers with retry logic

# Source shared configuration for consistent logging and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../backup-config.sh"

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/healthcare/backend}"
GITHUB_SHA="${GITHUB_SHA}"
WORKER_COUNT="${WORKER_COUNT:-2}"

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

log_message "Starting container deployment..."
log_message "Current directory: $(pwd)"
log_message "Directory contents:"
ls -la || true

# Verify docker-compose.prod.yml exists
if [ ! -f "docker-compose.prod.yml" ]; then
    log_message "ERROR: docker-compose.prod.yml not found in $(pwd)"
    log_message "Available files:"
    ls -la || true
    exit 1
fi

log_message "✅ docker-compose.prod.yml found"

# Export the environment variables
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}"
export WORKER_COUNT="${WORKER_COUNT}"

# Check database container status again (since variables don't persist between steps)
log_message "Checking database containers status..."

# Find postgres container regardless of exact name
POSTGRES_CONTAINER_ID=$(docker ps --format "{{.ID}}" --filter "ancestor=postgres" | head -n 1)
if [ -n "$POSTGRES_CONTAINER_ID" ]; then
    log_message "PostgreSQL container is running with ID: $POSTGRES_CONTAINER_ID"
    if docker inspect --format="{{.State.Status}}" "$POSTGRES_CONTAINER_ID" | grep -q "running"; then
        log_message "PostgreSQL container is already running and appears healthy. Keeping it as is."
        POSTGRES_RUNNING=true
        REAL_POSTGRES_CONTAINER=$(docker inspect --format="{{.Name}}" "$POSTGRES_CONTAINER_ID" | sed 's/^\///')
        log_message "Detected actual PostgreSQL container name: $REAL_POSTGRES_CONTAINER"
    else
        log_message "PostgreSQL container exists but may not be running. Will attempt to keep it anyway."
        POSTGRES_RUNNING=true
        REAL_POSTGRES_CONTAINER=$(docker inspect --format="{{.Name}}" "$POSTGRES_CONTAINER_ID" | sed 's/^\///')
    fi
else
    log_message "No running PostgreSQL container found. Will create it."
    POSTGRES_RUNNING=false
    REAL_POSTGRES_CONTAINER=""
fi

# Find redis container regardless of exact name, excluding redis-commander
REDIS_CONTAINER_ID=$(docker ps --format "{{.ID}}" --filter "ancestor=redis" | head -n 1)
if [ -n "$REDIS_CONTAINER_ID" ]; then
    log_message "Redis container is running with ID: $REDIS_CONTAINER_ID"
    if docker inspect --format="{{.State.Status}}" "$REDIS_CONTAINER_ID" | grep -q "running"; then
        log_message "Redis container is already running and appears healthy. Keeping it as is."
        REDIS_RUNNING=true
        REAL_REDIS_CONTAINER=$(docker inspect --format="{{.Name}}" "$REDIS_CONTAINER_ID" | sed 's/^\///')
        log_message "Detected actual Redis container name: $REAL_REDIS_CONTAINER"
    else
        log_message "Redis container exists but may not be running. Will attempt to keep it anyway."
        REDIS_RUNNING=true
        REAL_REDIS_CONTAINER=$(docker inspect --format="{{.Name}}" "$REDIS_CONTAINER_ID" | sed 's/^\///')
    fi
else
    log_message "No running Redis container found. Will create it."
    REDIS_RUNNING=false
    REAL_REDIS_CONTAINER=""
fi

# Selective container start based on status
DEPLOY_SUCCESS=false

if [ "$POSTGRES_RUNNING" = true ] && [ "$REDIS_RUNNING" = true ]; then
    log_message "Database containers are healthy. Only rebuilding and restarting API container..."
    # Build and start only the API container with --no-deps to avoid touching database containers
    if docker compose -f docker-compose.prod.yml up -d --build --no-deps --scale worker=$WORKER_COUNT api worker; then
        log_message "API container started successfully"
    else
        log_message "ERROR: Failed to start API container"
        exit 1
    fi
else
    log_message "Some database containers need to be created or recreated..."
    
    # Handle each container separately for better control
    # First, make sure the network exists
    if ! docker network inspect app-network >/dev/null 2>&1; then
        log_message "Creating app-network..."
        docker network create app-network || log_message "WARNING: Failed to create app-network"
    fi
    
    # Start/create PostgreSQL if needed
    if [ "$POSTGRES_RUNNING" = false ]; then
        log_message "Creating PostgreSQL container..."
        log_message "Current directory: $(pwd)"
        log_message "Checking docker-compose.prod.yml:"
        ls -la docker-compose.prod.yml || log_message "ERROR: docker-compose.prod.yml not found"
        
        if docker compose -f docker-compose.prod.yml up -d --no-recreate postgres; then
            log_message "PostgreSQL container started successfully"
        else
            log_message "WARNING: Issue starting PostgreSQL container, but continuing..."
            log_message "Docker compose error details:"
            docker compose -f docker-compose.prod.yml config || log_message "ERROR: docker-compose config failed"
        fi
    fi
    
    # Start/create Redis if needed
    if [ "$REDIS_RUNNING" = false ]; then
        log_message "Creating Redis container..."
        if docker compose -f docker-compose.prod.yml up -d --no-recreate redis; then
            log_message "Redis container started successfully"
        else
            log_message "WARNING: Issue starting Redis container, but continuing..."
        fi
    fi
    
    # Now build and start the API container with retry logic
    log_message "Building and starting API container with retry logic..."
    MAX_RETRIES=3
    RETRY_COUNT=0
    API_STARTED=false
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ] && [ "$API_STARTED" != "true" ]; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_message "API container start attempt $RETRY_COUNT/$MAX_RETRIES..."
        
        # Additional cleanup before each retry
        if [ $RETRY_COUNT -gt 1 ]; then
            log_message "Performing cleanup before retry..."
            docker ps -a --format "{{.Names}}" | grep -E "(api|worker)" | while read -r container; do
                docker rm -f "$container" || true
            done
            sleep 3
        fi
        
        if docker compose -f docker-compose.prod.yml up -d --build --no-deps --scale worker=$WORKER_COUNT api worker; then
            log_message "API container started successfully on attempt $RETRY_COUNT"
            API_STARTED=true
        else
            log_message "Failed to start API container on attempt $RETRY_COUNT"
            if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
                log_message "ERROR: All retry attempts failed. Exiting..."
                exit 1
            fi
            log_message "Waiting 10 seconds before retry..."
            sleep 10
        fi
    done
fi

# Verify all containers are running
log_message "Verifying all required containers are running..."
if docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"; then
    log_message "Container status verification completed"
else
    log_message "WARNING: Failed to get container status"
fi

log_message "✅ Start containers completed successfully" 