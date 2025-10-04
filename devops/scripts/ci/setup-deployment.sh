#!/bin/bash
set -e

# Setup deployment environment script
# This script configures the deployment environment, checks database containers, and performs cleanup

# Source shared configuration for consistent logging and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../backup-config.sh"

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/healthcare/backend}"
GITHUB_SHA="${GITHUB_SHA}"
SERVER_IP="${SERVER_IP}"

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

log_message "Starting setup deployment environment..."

# Export the environment variables
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}"
export WORKER_COUNT="${WORKER_COUNT:-2}"

# Make scripts executable in the release directory
if [ -d "scripts" ]; then
    log_message "Making scripts executable..."
    chmod +x scripts/*.sh || log_message "WARNING: Failed to make some scripts executable"
fi

# Configure host to resolve api.ishswami.in to localhost
log_message "Configuring hosts file for api.ishswami.in..."
if ! grep -q "api.ishswami.in" /etc/hosts; then
    if echo "127.0.0.1 api.ishswami.in" | sudo tee -a /etc/hosts >/dev/null 2>&1; then
        log_message "Hosts file configured successfully"
    else
        log_message "WARNING: Failed to configure hosts file"
    fi
fi

# Make sure api.ishswami.in is also registered on the server's public IP
log_message "Ensuring domain is properly configured on server..."
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "127.0.0.1")
if [ -n "$SERVER_IP" ] && ! grep -q "$SERVER_IP api.ishswami.in" /etc/hosts; then
    if echo "$SERVER_IP api.ishswami.in" | sudo tee -a /etc/hosts >/dev/null 2>&1; then
        log_message "Server IP configured in hosts file"
    else
        log_message "WARNING: Failed to configure server IP in hosts file"
    fi
fi

# Handle Docker network
log_message "Setting up Docker network..."
if ! docker network inspect app-network >/dev/null 2>&1; then
    log_message "Creating Docker network app-network..."
    if docker network create app-network --subnet=172.18.0.0/16; then
        log_message "Docker network created successfully"
    else
        log_message "WARNING: Failed to create Docker network"
    fi
fi

# Check and manage database containers with improved detection
log_message "Checking database containers..."

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

# Additional verification of database containers with dynamic names
if [ "$POSTGRES_RUNNING" = true ] && [ -n "$REAL_POSTGRES_CONTAINER" ]; then
    log_message "Verifying PostgreSQL container is responsive..."
    if docker exec "$REAL_POSTGRES_CONTAINER" pg_isready -q 2>/dev/null; then
        log_message "PostgreSQL container is responsive."
    else
        log_message "Warning: PostgreSQL container exists but isn't responding to connection tests."
    fi
fi

if [ "$REDIS_RUNNING" = true ] && [ -n "$REAL_REDIS_CONTAINER" ]; then
    log_message "Verifying Redis container is responsive..."
    if docker exec "$REAL_REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q "PONG"; then
        log_message "Redis container is responsive."
    else
        log_message "Warning: Redis container exists but isn't responding to ping tests."
    fi
fi

# Install any required build dependencies for bcrypt
log_message "Installing build dependencies for native modules..."
if ! command -v python3 &> /dev/null || ! command -v g++ &> /dev/null || ! command -v make &> /dev/null; then
    log_message "Installing build dependencies..."
    if sudo apt-get update && sudo apt-get install -y python3 make g++ build-essential; then
        log_message "Build dependencies installed successfully"
    else
        log_message "WARNING: Failed to install build dependencies"
    fi
fi

# Final cleanup before starting containers to prevent port conflicts
log_message "Performing final cleanup before starting containers..."

# Stop any containers that might be using port 8088
log_message "Stopping any containers using port 8088..."
docker ps --format "{{.Names}}" | while read -r container; do
    if docker port "$container" 2>/dev/null | grep -q ":8088"; then
        log_message "Stopping container using port 8088: $container"
        docker stop "$container" || true
        docker rm "$container" || true
    fi
done

# Force remove any API or worker containers
log_message "Force removing any existing API or worker containers..."
docker ps -a --format "{{.Names}}" | grep -E "(api|worker)" | while read -r container; do
    log_message "Force removing container: $container"
    docker rm -f "$container" || true
done

# Wait a moment for cleanup to complete
sleep 5

# Verify port 8088 is free
log_message "Final verification that port 8088 is available..."
if command -v netstat &> /dev/null && netstat -tuln 2>/dev/null | grep -q ":8088 "; then
    log_message "ERROR: Port 8088 is still in use after cleanup!"
    netstat -tuln | grep ":8088 " || true
    log_message "Attempting to kill any processes using port 8088..."
    if command -v lsof &> /dev/null; then
        lsof -ti:8088 | xargs kill -9 2>/dev/null || true
        sleep 2
    fi
else
    log_message "Port 8088 is available for new containers"
fi

log_message "✅ Setup deployment environment completed successfully" 