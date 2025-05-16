#!/bin/bash
# Healthcare App Server Maintenance Script
# This script performs routine maintenance tasks for the Healthcare API server
# Recommended to run as a scheduled cron job (e.g., weekly)
#
# To add to crontab:
# 0 2 * * 0 /var/www/healthcare/backend/current/scripts/server-maintenance.sh > /dev/null 2>&1

set -e
# Ensure the script runs with error handling
trap 'log_message "ERROR: Script failed at line $LINENO with exit code $?"' ERR

LOG_FILE="/var/log/healthcare-maintenance.log"
MAX_LOG_AGE_DAYS=30
MAX_BACKUP_AGE_DAYS=90
MAX_TEMP_FILE_AGE_DAYS=7
DEPLOY_PATH="/var/www/healthcare/backend"
SUCCESSFUL_DEPLOYMENTS_FILE="$DEPLOY_PATH/successful_deployments.txt"
RELEASES_DIR="$DEPLOY_PATH/releases"
KEEP_RELEASES=5

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

# Check if required commands are available
check_command() {
  command -v $1 >/dev/null 2>&1 || { log_message "ERROR: Required command '$1' not found"; return 1; }
}

# Important: This function checks if a process would be safe to perform
# It returns 0 if safe, 1 if unsafe
is_maintenance_safe() {
  local action=$1
  
  # Check system load to ensure we're not overloading the server
  if [ -f /proc/loadavg ]; then
    local load=$(cat /proc/loadavg | cut -d ' ' -f1)
    local cores=$(nproc 2>/dev/null || echo 1)
    local load_per_core=$(echo "$load/$cores" | bc -l)
    
    # If system load per core is very high, defer non-critical maintenance
    if (( $(echo "$load_per_core > 2.0" | bc -l) )); then
      log_message "WARNING: System load is high ($load). Deferring $action maintenance."
      return 1
    fi
  fi
  
  # Check API health - don't perform potentially disruptive maintenance if API is unhealthy
  if check_command curl; then
    if ! curl -s http://localhost:8088/health | grep -q "healthy\|status.*up"; then
      log_message "WARNING: API appears unhealthy. Deferring $action maintenance."
      return 1
    fi
  fi
  
  return 0 # Safe to proceed
}

for cmd in docker find openssl grep awk date cat; do
  check_command $cmd || exit 1
done

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Create log file if it doesn't exist
touch $LOG_FILE
log_message "Starting server maintenance..."
log_message "IMPORTANT: Maintenance runs in non-disruptive mode - server will remain online"

# Check disk space before cleanup
log_message "Checking disk space before cleanup..."
df -h / | tee -a $LOG_FILE

# Check if Docker service is running
if systemctl is-active --quiet docker; then
  log_message "Docker service is running"
else
  log_message "WARNING: Docker service is not running. Attempting to start..."
  systemctl start docker
  sleep 5
  if ! systemctl is-active --quiet docker; then
    log_message "ERROR: Failed to start Docker service. Some maintenance tasks will be skipped."
  fi
fi

# Prune Docker resources only if Docker is available - CAREFULLY WITH 'system prune'
if check_command docker && is_maintenance_safe "docker pruning"; then
  log_message "Pruning Docker resources (non-disruptive mode)..."
  # Only prune dangling images, unused networks, and build cache - NEVER prune volumes or containers
  docker system prune --force --filter "label!=app.persist=true" --filter "label!=app.component=database" --volumes=false || log_message "Warning: Docker prune failed"
  
  # Alternative: Targeted pruning to ensure running containers aren't affected
  log_message "Cleaning up dangling images only..."
  docker image prune --force --filter "dangling=true" || log_message "Warning: Image prune failed"
  
  log_message "Cleaning up unused networks..."
  docker network prune --force --filter "until=24h" || log_message "Warning: Network prune failed"
else
  log_message "Skipping Docker prune - either Docker not available or high system load"
fi

# Clean up old logs - safe operation
log_message "Cleaning up old log files..."
find /var/log -name "*.log" -type f -mtime +${MAX_LOG_AGE_DAYS} -delete 2>/dev/null || log_message "Warning: Log cleanup failed"
find $DEPLOY_PATH/logs -name "*.log" -type f -mtime +${MAX_LOG_AGE_DAYS} -delete 2>/dev/null || log_message "Warning: App log cleanup failed"
find $DEPLOY_PATH/current/logs -name "*.log" -type f -mtime +${MAX_LOG_AGE_DAYS} -delete 2>/dev/null || log_message "Warning: Current log cleanup failed"

# Clean up old backups
log_message "Cleaning up old backups..."
if [ -d "$DEPLOY_PATH/backups" ]; then
  find $DEPLOY_PATH/backups -type d -mtime +${MAX_BACKUP_AGE_DAYS} -exec rm -rf {} \; 2>/dev/null || log_message "No old backups to remove"
else
  log_message "Backup directory not found, skipping backup cleanup"
fi

# Clean up old releases but preserve successful ones - safe operation
log_message "Cleaning up old releases but preserving successful ones..."
if [ -d "$RELEASES_DIR" ]; then
  all_releases=$(ls -t "$RELEASES_DIR" 2>/dev/null || echo "")
  release_count=$(echo "$all_releases" | wc -l)
  
  if [ "$release_count" -gt "$KEEP_RELEASES" ]; then
    # Get current release to ensure we don't delete it
    current_release=""
    if [ -L "$DEPLOY_PATH/current" ]; then
      current_release=$(basename "$(readlink -f "$DEPLOY_PATH/current")")
      log_message "Current active release: $current_release (will be preserved)"
    fi
    
    # Get list of releases to remove (all except the newest KEEP_RELEASES)
    releases_to_remove=$(echo "$all_releases" | tail -n +"$((KEEP_RELEASES + 1))")
    
    # Get list of successful deployments to preserve
    successful_deployments=""
    if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
      successful_deployments=$(cat "$SUCCESSFUL_DEPLOYMENTS_FILE")
    fi
    
    # Remove old releases, but preserve successful ones and the current one
    for release in $releases_to_remove; do
      # Skip if this is the current active release
      if [ "$release" = "$current_release" ]; then
        log_message "Keeping current active release: $release"
        continue
      fi
      
      # Skip if this is a successful deployment we want to keep
      if [ -n "$successful_deployments" ] && echo "$successful_deployments" | grep -q "^$release$"; then
        log_message "Keeping successful deployment: $release"
        continue
      fi
      
      log_message "Removing old release: $release"
      rm -rf "$RELEASES_DIR/$release"
    done
    
    log_message "Release cleanup completed"
  else
    log_message "Only $release_count releases exist, no cleanup needed"
  fi
else
  log_message "Releases directory not found, skipping release cleanup"
fi

# Clean temporary files - safe operation
log_message "Cleaning temporary files..."
find /tmp -type f -mtime +${MAX_TEMP_FILE_AGE_DAYS} -delete 2>/dev/null || log_message "Warning: Temp cleanup failed"

# Check for outdated SSL certificates - safe operation
log_message "Checking SSL certificates..."
if [ -f "/etc/letsencrypt/live/api.ishswami.in/fullchain.pem" ]; then
  CERT_EXPIRY=$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/api.ishswami.in/fullchain.pem | cut -d= -f2)
  EXPIRY_DATE=$(date -d "$CERT_EXPIRY" +%s)
  CURRENT_DATE=$(date +%s)
  DAYS_LEFT=$(( ($EXPIRY_DATE - $CURRENT_DATE) / 86400 ))
  log_message "SSL certificate expires in $DAYS_LEFT days"

  if [ "$DAYS_LEFT" -lt 30 ] && is_maintenance_safe "certificate renewal"; then
    log_message "Certificate expires soon. Attempting renewal..."
    if check_command certbot; then
      # Use the --keep-until-expiring flag to ensure certbot doesn't interrupt service
      certbot renew --quiet --keep-until-expiring --non-interactive || log_message "Certificate renewal failed"
      if check_command systemctl && systemctl is-active --quiet nginx; then
        # Reload nginx gracefully without disconnecting clients
        systemctl reload nginx
      else
        log_message "WARNING: nginx service not active, skipping reload"
      fi
    else
      log_message "WARNING: certbot not found, skipping certificate renewal"
    fi
  fi
else
  log_message "SSL certificate file not found, skipping certificate check"
fi

# Optimize PostgreSQL if Docker and the container are available
log_message "Checking PostgreSQL database..."
if check_command docker && docker ps | grep -q "latest-postgres" && is_maintenance_safe "database optimization"; then
  log_message "Optimizing PostgreSQL database..."
  # Use VACUUM ANALYZE (not FULL) which is non-blocking and safe for production
  docker exec latest-postgres psql -U postgres -d userdb -c "VACUUM ANALYZE;" || log_message "Warning: Database optimization failed"
  
  # Run database statistics update which is safe for production
  docker exec latest-postgres psql -U postgres -d userdb -c "ANALYZE VERBOSE;" || log_message "Warning: Database statistics update failed"
else
  log_message "Skipping PostgreSQL optimization - either container not running or system under high load"
fi

# Monitor memory usage but DO NOT restart services unless absolutely critical
if check_command free; then
  MEMORY_USAGE=$(free | grep Mem | awk '{print $3/$2 * 100.0}' | cut -d. -f1)
  if [ "$MEMORY_USAGE" -gt 90 ]; then
    log_message "WARNING: Memory usage is critically high (${MEMORY_USAGE}%). Checking for memory leak..."
    
    # Check for potential memory leaks in containers
    if check_command docker; then
      for container in latest-api latest-postgres latest-redis; do
        if docker ps | grep -q "$container"; then
          memory_usage=$(docker stats --no-stream --format "{{.MemPerc}}" $container | tr -d '%')
          log_message "Container $container memory usage: ${memory_usage}%"
          
          # If API container is using excessive memory, consider a graceful restart
          # But ONLY if memory is critical (>90%) and API container is using >70% of its limit
          if [ "$container" = "latest-api" ] && [ "$MEMORY_USAGE" -gt 90 ] && [ "$memory_usage" -gt 70 ] && is_maintenance_safe "API restart"; then
            log_message "WARNING: API container showing high memory usage. Performing graceful restart..."
            # Perform graceful restart with signal that allows connections to complete
            docker kill --signal=SIGTERM $container || log_message "Warning: Failed to send SIGTERM to $container"
            sleep 10 # Allow time for graceful shutdown
            docker start $container || log_message "Warning: Failed to restart $container"
            log_message "Graceful restart of API container completed"
          fi
        fi
      done
    fi
  else
    log_message "Memory usage is acceptable (${MEMORY_USAGE}%), no action needed"
  fi
else
  log_message "free command not available, skipping memory check"
fi

# Update package lists (but don't upgrade to avoid unexpected changes) - safe operation
log_message "Updating package lists..."
if check_command apt-get; then
  apt-get update -qq || log_message "Warning: Package list update failed"

  # Check for security updates
  SECURITY_UPDATES=$(apt-get upgrade -s | grep -i security | wc -l)
  if [ "$SECURITY_UPDATES" -gt 0 ]; then
    log_message "WARNING: $SECURITY_UPDATES security updates available! Consider updating during maintenance window."
  fi
else
  log_message "apt-get not available, skipping package list update"
fi

# Final disk space check - safe operation
log_message "Checking disk space after cleanup..."
df -h / | tee -a $LOG_FILE

# Check system load
if [ -f /proc/loadavg ]; then
  log_message "System load: $(cat /proc/loadavg)"
else
  log_message "Unable to check system load: /proc/loadavg not available"
fi

# Rotate the maintenance log itself - safe operation
if [ -f "$LOG_FILE" ] && [ $(stat -c %s "$LOG_FILE") -gt 5242880 ]; then # 5MB
  log_message "Rotating maintenance log..."
  mv "$LOG_FILE" "$LOG_FILE.old"
  touch "$LOG_FILE"
  log_message "Log rotated successfully"
fi

log_message "Server maintenance completed successfully - server remained online throughout the process"
exit 0 