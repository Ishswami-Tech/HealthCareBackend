#!/bin/bash
# Healthcare App Server Maintenance Script
# This script performs routine server maintenance tasks

set -e

# Source shared configuration
source "$(dirname "$0")/backup-config.sh"

# Function to check disk space
check_disk_space() {
  local threshold=$1
  local mount_point=$2
  
  log_message "$MAINTENANCE_LOG" "Checking disk space for $mount_point..."
  
  local disk_usage
  disk_usage=$(df -h "$mount_point" | tail -1 | awk '{print $5}' | tr -d '%')
  
  if [ "$disk_usage" -gt "$threshold" ]; then
    log_error "$MAINTENANCE_LOG" "Disk usage is critical: ${disk_usage}% (threshold: ${threshold}%)"
    return 1
  else
    log_message "$MAINTENANCE_LOG" "Disk usage is normal: ${disk_usage}%"
    return 0
  fi
}

# Function to clean up Docker resources
cleanup_docker() {
  log_message "$MAINTENANCE_LOG" "Cleaning up Docker resources..."
  
  # Remove unused containers
  log_message "$MAINTENANCE_LOG" "Removing unused containers..."
  docker container prune -f
  
  # Remove unused images
  log_message "$MAINTENANCE_LOG" "Removing unused images..."
  docker image prune -f
  
  # Remove unused volumes
  log_message "$MAINTENANCE_LOG" "Removing unused volumes..."
  docker volume prune -f
  
  # Remove unused networks
  log_message "$MAINTENANCE_LOG" "Removing unused networks..."
  docker network prune -f
  
  log_message "$MAINTENANCE_LOG" "Docker cleanup completed"
}

# Function to clean up old logs
cleanup_logs() {
  log_message "$MAINTENANCE_LOG" "Cleaning up old log files..."
  
  # Clean up logs older than 30 days
  find "$LOG_DIR" -name "*.log" -type f -mtime +30 -delete
  
  # Compress logs older than 7 days but younger than 30 days
  find "$LOG_DIR" -name "*.log" -type f -mtime +7 -mtime -30 -exec gzip -f {} \;
  
  log_message "$MAINTENANCE_LOG" "Log cleanup completed"
}

# Function to verify and repair backup integrity
verify_backups() {
  log_message "$MAINTENANCE_LOG" "Verifying backup integrity..."
  
  local error_count=0
  
  # Check local backups
  log_message "$MAINTENANCE_LOG" "Checking local backups..."
  
  # Verify application backups
  if [ -d "$BACKUP_DIR" ]; then
    for backup in "$BACKUP_DIR"/*; do
      if [ -d "$backup" ] && [ "$(basename "$backup")" != "." ] && [ "$(basename "$backup")" != ".." ]; then
        if [ -f "$backup.tar.gz" ]; then
          if ! tar -tzf "$backup.tar.gz" >/dev/null 2>&1; then
            log_error "$MAINTENANCE_LOG" "Corrupted application backup: $backup"
            error_count=$((error_count + 1))
          fi
        fi
      fi
    done
  fi
  
  # Verify database backups
  if [ -d "$DB_BACKUP_DIR" ]; then
    for backup in "$DB_BACKUP_DIR"/*.sql.gz; do
      if [ -f "$backup" ]; then
        if ! gzip -t "$backup" 2>/dev/null; then
          log_error "$MAINTENANCE_LOG" "Corrupted database backup: $backup"
          error_count=$((error_count + 1))
        fi
      fi
    done
  fi
  
  # Check Google Drive backups
  log_message "$MAINTENANCE_LOG" "Checking Google Drive backups..."
  
  # Verify application backups in Google Drive
  local gdrive_app_backups
  gdrive_app_backups=$(rclone lsf "gdrive:$GDRIVE_APP_BACKUP_DIR")
  for backup in $gdrive_app_backups; do
    if ! rclone cat "gdrive:$GDRIVE_APP_BACKUP_DIR/$backup" 2>/dev/null | tar -tz >/dev/null 2>&1; then
      log_error "$MAINTENANCE_LOG" "Corrupted application backup in Google Drive: $backup"
      error_count=$((error_count + 1))
    fi
  done
  
  # Verify database backups in Google Drive
  local gdrive_db_backups
  gdrive_db_backups=$(rclone lsf "gdrive:$GDRIVE_DB_BACKUP_DIR")
  for backup in $gdrive_db_backups; do
    if ! rclone cat "gdrive:$GDRIVE_DB_BACKUP_DIR/$backup" 2>/dev/null | gzip -t 2>/dev/null; then
      log_error "$MAINTENANCE_LOG" "Corrupted database backup in Google Drive: $backup"
      error_count=$((error_count + 1))
    fi
  done
  
  if [ "$error_count" -gt 0 ]; then
    log_error "$MAINTENANCE_LOG" "Found $error_count corrupted backup(s)"
    return 1
  else
    log_message "$MAINTENANCE_LOG" "All backups verified successfully"
    return 0
  fi
}

# Function to sync backups between local and Google Drive
sync_backups() {
  log_message "$MAINTENANCE_LOG" "Syncing backups between local and Google Drive..."
  
  # Sync application backups
  log_message "$MAINTENANCE_LOG" "Syncing application backups..."
  if [ -d "$BACKUP_DIR" ]; then
    for backup in "$BACKUP_DIR"/*; do
      if [ -d "$backup" ] && [ "$(basename "$backup")" != "." ] && [ "$(basename "$backup")" != ".." ]; then
        local backup_name=$(basename "$backup")
        if ! verify_backup_exists "$backup_name" "application"; then
          log_message "$MAINTENANCE_LOG" "Syncing missing application backup: $backup_name"
          sync_backup "$backup_name" "application" "to_gdrive"
        fi
      fi
    done
  fi
  
  # Sync database backups
  log_message "$MAINTENANCE_LOG" "Syncing database backups..."
  if [ -d "$DB_BACKUP_DIR" ]; then
    for backup in "$DB_BACKUP_DIR"/*.sql.gz; do
      if [ -f "$backup" ]; then
        local backup_name=$(basename "$backup")
        if ! verify_backup_exists "$backup_name" "database"; then
          log_message "$MAINTENANCE_LOG" "Syncing missing database backup: $backup_name"
          sync_backup "$backup_name" "database" "to_gdrive"
        fi
      fi
    done
  fi
  
  log_message "$MAINTENANCE_LOG" "Backup sync completed"
}

# Function to check and repair file permissions
check_permissions() {
  log_message "$MAINTENANCE_LOG" "Checking and repairing file permissions..."
  
  # Fix backup directory permissions
  if [ -d "$BACKUP_DIR" ]; then
    chmod 755 "$BACKUP_DIR"
    chown -R www-data:www-data "$BACKUP_DIR"
  fi
  
  # Fix database backup directory permissions
  if [ -d "$DB_BACKUP_DIR" ]; then
    chmod 700 "$DB_BACKUP_DIR"
    chown -R www-data:www-data "$DB_BACKUP_DIR"
  fi
  
  # Fix log directory permissions
  if [ -d "$LOG_DIR" ]; then
    chmod 755 "$LOG_DIR"
    chown -R www-data:www-data "$LOG_DIR"
    find "$LOG_DIR" -type f -exec chmod 644 {} \;
  fi
  
  log_message "$MAINTENANCE_LOG" "File permissions check completed"
}

# Main execution
log_message "$MAINTENANCE_LOG" "====================== SERVER MAINTENANCE STARTED ======================"

# Initialize error flag
ERROR_FLAG=0

# Check disk space
if ! check_disk_space 80 "/"; then
  ERROR_FLAG=1
fi

# Clean up Docker resources
cleanup_docker || ERROR_FLAG=1

# Clean up logs
cleanup_logs || ERROR_FLAG=1

# Verify backups
verify_backups || ERROR_FLAG=1

# Sync backups
sync_backups || ERROR_FLAG=1

# Check permissions
check_permissions || ERROR_FLAG=1

if [ $ERROR_FLAG -eq 0 ]; then
  log_message "$MAINTENANCE_LOG" "✅ Server maintenance completed successfully"
  exit 0
else
  log_error "$MAINTENANCE_LOG" "❌ Server maintenance completed with errors"
  exit 1
fi 