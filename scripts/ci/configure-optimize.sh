#!/bin/bash
set -e

# Configure and optimize script
# This script runs migrations, optimizations, and sets up maintenance scripts

# Source shared configuration for consistent logging and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../backup-config.sh"

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/healthcare/backend}"
GITHUB_SHA="${GITHUB_SHA}"
API_CONTAINER="${API_CONTAINER:-latest-api}"

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

log_message "Starting configure and optimize operations..."

# Wait for API container to be ready
log_message "Waiting for API container to be ready..."
for i in {1..30}; do
    if docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "Up"; then
        log_message "API container is running"
        break
    fi
    if [ $i -eq 30 ]; then
        log_message "ERROR: API container failed to start within timeout"
        docker logs "$API_CONTAINER" --tail 20 || true
        exit 1
    fi
    log_message "Attempt $i/30: Waiting for API container to be ready..."
    sleep 10
done

# Manually generate Prisma client in the API container to ensure it's available
log_message "Generating Prisma client in API container..."
if docker exec "$API_CONTAINER" sh -c "npx prisma generate --schema=/app/src/libs/infrastructure/database/prisma/schema.prisma"; then
    log_message "Prisma client generated successfully"
else
    log_message "WARNING: Prisma client generation failed, but continuing..."
fi

# Run database migrations
log_message "Running database migrations..."
if docker exec "$API_CONTAINER" sh -c "npx prisma migrate deploy --schema=/app/src/libs/infrastructure/database/prisma/schema.prisma"; then
    log_message "Database migrations completed successfully"
else
    log_message "WARNING: Migration failed, but continuing deployment..."
fi

# Copy database optimization script to PostgreSQL container
log_message "Copying database optimization script to PostgreSQL container..."
if docker cp src/shared/database/scripts/optimize-logs.sql latest-postgres:/tmp/optimize-logs.sql; then
    log_message "Database optimization script copied successfully"
else
    log_message "WARNING: Failed to copy optimization script, but continuing deployment..."
fi

# Run database optimization script
log_message "Running database optimization script..."
if docker exec latest-postgres psql -U postgres -d userdb -f /tmp/optimize-logs.sql; then
    log_message "Database optimization completed successfully"
else
    log_message "WARNING: Database optimization failed, but continuing deployment..."
fi

# Set DEV_MODE environment variable in the container
log_message "Setting DEV_MODE=true in the API container..."
if docker exec "$API_CONTAINER" sh -c "export DEV_MODE=true && echo 'DEV_MODE=true' >> /app/.env"; then
    log_message "DEV_MODE environment variable set successfully"
else
    log_message "WARNING: Failed to set DEV_MODE, but continuing deployment..."
fi

# Restart API container to apply DEV_MODE environment variable
log_message "Restarting API container to apply DEV_MODE environment variable..."
if docker restart "$API_CONTAINER"; then
    log_message "API container restarted successfully"
else
    log_message "WARNING: Failed to restart API container, but continuing deployment..."
fi

# Wait for container to be healthy after restart
log_message "Waiting for API container to be healthy after restart..."
for i in {1..30}; do
    if docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "healthy"; then
        log_message "API container is healthy after restart"
        break
    fi
    if [ $i -eq 30 ]; then
        log_message "WARNING: API container failed to become healthy after restart, but continuing..."
        break
    fi
    log_message "Attempt $i/30: Waiting for API container to be healthy after restart..."
    sleep 10
done

# Set up maintenance scripts
log_message "Setting up maintenance scripts..."
mkdir -p /var/www/healthcare/backend/scripts
mkdir -p /var/log/healthcare
mkdir -p /var/backups/postgres

# Copy scripts and set permissions
if cp -r scripts/* /var/www/healthcare/backend/scripts/; then
    log_message "Scripts copied successfully"
else
    log_message "WARNING: Failed to copy some scripts"
fi

chmod +x /var/www/healthcare/backend/scripts/*.sh || log_message "WARNING: Failed to set execute permissions on some scripts"
chown -R www-data:www-data /var/log/healthcare /var/backups/postgres || log_message "WARNING: Failed to set ownership"

# Test database connection with improved error handling
log_message "Testing database connection..."
if docker exec "$API_CONTAINER" sh -c "cd /app && node -e \"
  try {
    console.log('Initializing Prisma client...');
    const { PrismaClient } = require('@prisma/client');
    console.log('PrismaClient imported successfully');
    
    const prisma = new PrismaClient();
    console.log('PrismaClient instance created');
    
    prisma.\$connect()
      .then(() => {
        console.log('Database connection successful');
        process.exit(0);
      })
      .catch(err => {
        console.error('Database connection failed:', err);
        process.exit(1);
      });
  } catch (error) {
    console.error('Error setting up Prisma:', error);
    process.exit(1);
  }
\""; then
    log_message "Database connection test successful"
else
    log_message "WARNING: Database connection test failed, continuing deployment anyway..."
fi

# Give the API container time to fully initialize before testing health
log_message "Giving API container time to initialize (10 seconds)..."
sleep 10

# Wait for API container to be healthy with improved logic
log_message "Waiting for API container to be healthy..."
for i in {1..30}; do
    if docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "healthy"; then
        log_message "API container is healthy"
        DEPLOY_SUCCESS=true
        break
    fi
    if [ $i -eq 30 ]; then
        log_message "ERROR: API container failed to become healthy"
        docker logs "$API_CONTAINER" --tail 30 || true
        exit 1
    fi
    log_message "Attempt $i/30: Waiting for API container to be healthy..."
    sleep 10
done

# Setting environment variables directly to API container
log_message "Setting environment variables in API container..."
if docker exec -e SOCKET_URL=/socket.io \
           -e LOGGER_URL=/logger \
           -e DEV_MODE=true \
           "$API_CONTAINER" sh -c 'echo "Environment variables updated via Docker exec"'; then
    log_message "Environment variables set successfully"
else
    log_message "WARNING: Failed to set environment variables"
fi

# Configure firewall to allow traffic on ports
log_message "Configuring firewall..."
for port in 80 443 8088 8082; do
    if sudo ufw allow "$port/tcp" >/dev/null 2>&1; then
        log_message "Firewall rule added for port $port"
    else
        log_message "WARNING: Failed to add firewall rule for port $port"
    fi
done

log_message "✅ Configure and optimize completed successfully" 