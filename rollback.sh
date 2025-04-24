#!/bin/bash

# Rollback script for Healthcare App

set -e

APP_DIR="/var/www/healthcare"
DEPLOYMENTS_DIR="$APP_DIR/deployments"
CURRENT_FILE="$APP_DIR/current_deployment"

# Function to log messages
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check container health
check_container_health() {
    if docker-compose -f docker-compose.prod.yml ps | grep -q "health: healthy"; then
        # Check if all required containers are running
        running_containers=$(docker-compose -f docker-compose.prod.yml ps --services | wc -l)
        expected_containers=3  # api, postgres, redis
        if [ "$running_containers" -eq "$expected_containers" ]; then
            log "All containers are running and healthy"
            return 0
        fi
    fi
    return 1
}

# Function to check application health
check_app_health() {
    health_status=$(curl -s http://localhost:8088/health)
    if [ $? -eq 0 ]; then
        status=$(echo $health_status | jq -r '.status')
        if [ "$status" = "healthy" ]; then
            log "Application is healthy"
            log "System metrics:"
            echo $health_status | jq '.systemMetrics'
            log "Services status:"
            echo $health_status | jq '.services'
            return 0
        fi
    fi
    return 1
}

# Function to get current deployment
get_current_deployment() {
    if [ -f "$CURRENT_FILE" ]; then
        cat "$CURRENT_FILE"
    else
        log "No current deployment file found"
        exit 1
    fi
}

# Function to get previous deployment
get_previous_deployment() {
    current=$1
    ls -1 "$DEPLOYMENTS_DIR" | grep -v "$current" | tail -n 1
}

# Function to perform rollback
do_rollback() {
    current=$(get_current_deployment)
    previous=$(get_previous_deployment "$current")

    if [ -z "$previous" ]; then
        log "No previous deployment found to rollback to"
        exit 1
    fi

    log "Rolling back from $current to $previous"

    # Stop current deployment
    cd "$APP_DIR/current"
    log "Stopping current deployment..."
    docker-compose -f docker-compose.prod.yml down || true

    # Switch to previous deployment
    log "Switching to previous deployment..."
    ln -sfn "$DEPLOYMENTS_DIR/$previous" "$APP_DIR/current"
    echo "$previous" > "$CURRENT_FILE"

    # Start previous deployment
    cd "$APP_DIR/current"
    log "Starting previous deployment..."
    docker-compose -f docker-compose.prod.yml up -d

    # Phase 1: Check container health
    log "Phase 1: Checking container health..."
    max_retries=30
    counter=0
    while [ $counter -lt $max_retries ]; do
        if check_container_health; then
            break
        fi
        log "Waiting for containers to be healthy (attempt $counter of $max_retries)"
        counter=$((counter + 1))
        sleep 2
        
        if [ $counter -eq $max_retries ]; then
            log "Container health check failed"
            return 1
        fi
    done

    # Phase 2: Check application health
    log "Phase 2: Checking application health..."
    max_retries=30
    counter=0
    while [ $counter -lt $max_retries ]; do
        if check_app_health; then
            return 0
        fi
        log "Waiting for application to be healthy (attempt $counter of $max_retries)"
        counter=$((counter + 1))
        sleep 2
    done

    log "Application health check failed"
    return 1
}

# Function to cleanup old deployments
cleanup_old_deployments() {
    # Keep last 5 deployments
    cd "$DEPLOYMENTS_DIR"
    ls -1t | tail -n +6 | xargs -r rm -rf
    log "Cleaned up old deployments"
}

# Main execution
log "Starting rollback process..."

if do_rollback; then
    cleanup_old_deployments
    log "Rollback completed successfully"
    exit 0
else
    log "Rollback failed"
    exit 1
fi 