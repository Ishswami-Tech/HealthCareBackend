#!/bin/bash
# Healthcare App Rollback Script
# This script rolls back to the previous successful deployment if the current one fails

set -e

APP_DIR="/var/www/healthcare/backend"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
SUCCESSFUL_DEPLOYMENTS_FILE="$APP_DIR/successful_deployments.txt"
LOG_FILE="/var/log/healthcare/rollback.log"
BACKUP_DIR="$APP_DIR/backups"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check container health
check_container_health() {
  local container=$1
  local max_attempts=$2
  local delay=$3
  local attempt=1

  log_message "Checking health for container: $container (max attempts: $max_attempts)"
  
  while [ $attempt -le $max_attempts ]; do
    if docker ps --format '{{.Names}}' | grep -q "^$container$"; then
      if docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null | grep -q "healthy"; then
        log_message "✅ Container $container is healthy (attempt $attempt/$max_attempts)"
        return 0
      fi
    fi
    
    log_message "⏳ Waiting for container $container to be healthy (attempt $attempt/$max_attempts)"
    attempt=$((attempt + 1))
    sleep $delay
  done
  
  log_message "❌ Container $container failed health check after $max_attempts attempts"
  return 1
}

# Function to check API health
check_api_health() {
  local max_attempts=$1
  local delay=$2
  local attempt=1
  local endpoint="http://localhost:8088/health"
  
  log_message "Checking API health at $endpoint (max attempts: $max_attempts)"
  
  while [ $attempt -le $max_attempts ]; do
    local health_response
    health_response=$(curl -s "$endpoint" || echo "connection failed")
    
    # Check for successful response with healthy status
    if echo "$health_response" | grep -q '"status"\s*:\s*"healthy"\|"status":"up"'; then
      log_message "✅ API health check successful (attempt $attempt/$max_attempts)"
      return 0
    fi
    
    log_message "⏳ Waiting for API to become healthy (attempt $attempt/$max_attempts): $health_response"
    attempt=$((attempt + 1))
    sleep $delay
  done
  
  log_message "❌ API health check failed after $max_attempts attempts"
  return 1
}

# Function to get the current deployment
get_current_deployment() {
  if [ -L "$CURRENT_LINK" ]; then
    basename "$(readlink -f "$CURRENT_LINK")"
  else
    log_message "❌ No current deployment link found"
    return 1
  fi
}

# Function to get last successful deployment
get_last_successful_deployment() {
  if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
    # Get the last line of the successful deployments file (most recent)
    tail -n 1 "$SUCCESSFUL_DEPLOYMENTS_FILE"
  else
    log_message "❌ No successful deployments record found"
    return 1
  fi
}

# Get the latest release that's not the current one
get_latest_release() {
  local current=$1
  local latest
  
  # Find all release directories
  latest=$(ls -t "$RELEASES_DIR" | grep -v "^$current$" | head -n 1)
  
  if [ -n "$latest" ]; then
    echo "$latest"
  else
    log_message "❌ No other releases found to roll back to"
    return 1
  fi
}

# Function to mark a deployment as successful
mark_deployment_successful() {
  local deployment=$1
  
  # Ensure parent directory exists
  mkdir -p "$(dirname "$SUCCESSFUL_DEPLOYMENTS_FILE")"
  
  # Add to successful deployments file, create if it doesn't exist
  echo "$deployment" >> "$SUCCESSFUL_DEPLOYMENTS_FILE"
  log_message "✅ Marked deployment $deployment as successful"
}

# Function to create a backup of the current deployment
backup_current_deployment() {
  local current=$1
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_path="$BACKUP_DIR/$timestamp"
  
  log_message "Creating backup of current deployment: $current → $backup_path"
  
  mkdir -p "$backup_path"
  if [ -d "$RELEASES_DIR/$current" ]; then
    cp -r "$RELEASES_DIR/$current"/* "$backup_path"/ 2>/dev/null || true
    echo "$current" > "$BACKUP_DIR/latest_backup"
    log_message "✅ Backup created successfully"
  else
    log_message "❌ Could not create backup - release directory not found"
    return 1
  fi
}

# Function to perform rollback
perform_rollback() {
  local current_deployment
  local target_deployment
  local rollback_type=$1  # 'auto' or 'manual'
  
  # Get current deployment
  current_deployment=$(get_current_deployment)
  if [ $? -ne 0 ]; then
    log_message "❌ Cannot determine current deployment, aborting rollback"
    return 1
  fi
  
  log_message "Current deployment: $current_deployment"
  
  # Create backup of current deployment
  backup_current_deployment "$current_deployment"
  
  # Determine rollback target
  if [ "$rollback_type" = "auto" ]; then
    # Try to get last successful deployment
    target_deployment=$(get_last_successful_deployment)
    
    # If no successful deployment record exists, fall back to latest release
    if [ $? -ne 0 ]; then
      log_message "No record of successful deployments, falling back to latest release"
      target_deployment=$(get_latest_release "$current_deployment")
    fi
  else
    # For manual rollback, always use the latest release
    target_deployment=$(get_latest_release "$current_deployment")
  fi
  
  if [ $? -ne 0 ] || [ -z "$target_deployment" ]; then
    log_message "❌ No valid rollback target found, cannot proceed"
    return 1
  fi
  
  log_message "Rolling back from $current_deployment to $target_deployment"
  
  # Stop only the API container
  log_message "Stopping current API container..."
  docker stop latest-api 2>/dev/null || true
  docker rm latest-api 2>/dev/null || true
  
  # Update current symlink to point to rollback target
  log_message "Updating current deployment link to $target_deployment"
  ln -sfn "$RELEASES_DIR/$target_deployment" "$CURRENT_LINK"
  
  # Start the API container from the rollback target
  log_message "Starting API from previous successful deployment..."
  cd "$CURRENT_LINK"
  
  # Determine if database containers are healthy
  local postgres_healthy=false
  local redis_healthy=false
  
  if docker ps | grep -q "latest-postgres" && docker inspect --format='{{.State.Health.Status}}' latest-postgres 2>/dev/null | grep -q "healthy"; then
    postgres_healthy=true
    log_message "PostgreSQL container is healthy, keeping it running"
  fi
  
  if docker ps | grep -q "latest-redis" && docker inspect --format='{{.State.Health.Status}}' latest-redis 2>/dev/null | grep -q "healthy"; then
    redis_healthy=true
    log_message "Redis container is healthy, keeping it running"
  fi
  
  # Start containers based on health status
  if [ "$postgres_healthy" = true ] && [ "$redis_healthy" = true ]; then
    log_message "Database containers are healthy, only starting API"
    docker-compose -f docker-compose.prod.yml up -d --no-deps api
  else
    log_message "Some database containers need to be recreated"
    docker-compose -f docker-compose.prod.yml up -d
  fi
  
  # Verify health of containers
  if ! check_container_health "latest-api" 30 5; then
    log_message "❌ API container failed to become healthy after rollback"
    return 1
  fi
  
  # Verify API health
  if ! check_api_health 15 5; then
    log_message "❌ API failed to become healthy after rollback"
    return 1
  fi
  
  log_message "✅ Rollback to $target_deployment completed successfully"
  return 0
}

# Function to cleanup old releases
cleanup_old_releases() {
  local keep_count=5
  
  log_message "Cleaning up old releases (keeping the last $keep_count)..."
  
  # Get all releases sorted by time (newest first)
  local all_releases
  all_releases=$(ls -t "$RELEASES_DIR")
  
  # Count the total number of releases
  local release_count
  release_count=$(echo "$all_releases" | wc -l)
  
  if [ "$release_count" -le "$keep_count" ]; then
    log_message "Only $release_count releases exist, no cleanup needed"
    return 0
  fi
  
  # Get list of releases to remove (all except the newest $keep_count)
  local releases_to_remove
  releases_to_remove=$(echo "$all_releases" | tail -n +"$((keep_count + 1))")
  
  # Get list of successful deployments to preserve
  local successful_deployments=""
  if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
    successful_deployments=$(cat "$SUCCESSFUL_DEPLOYMENTS_FILE")
  fi
  
  # Remove old releases, but preserve successful ones
  for release in $releases_to_remove; do
    # Skip if this is a successful deployment we want to keep
    if echo "$successful_deployments" | grep -q "^$release$"; then
      log_message "Keeping successful deployment: $release"
      continue
    fi
    
    log_message "Removing old release: $release"
    rm -rf "$RELEASES_DIR/$release"
  done
  
  log_message "✅ Cleanup completed"
  return 0
}

# Main execution
log_message "====================== ROLLBACK PROCESS STARTED ======================"

# Check for rollback type argument
ROLLBACK_TYPE="auto"
if [ "$1" = "manual" ]; then
  ROLLBACK_TYPE="manual"
  log_message "Manual rollback requested"
fi

# Perform rollback
if perform_rollback "$ROLLBACK_TYPE"; then
  cleanup_old_releases
  log_message "✅ Rollback process completed successfully"
  exit 0
else
  log_message "❌ Rollback process failed"
  exit 1
fi 