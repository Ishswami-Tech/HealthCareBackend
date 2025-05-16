#!/bin/bash
# Shared configuration for backup and rollback scripts

# Base directories
APP_DIR="/var/www/healthcare/backend"
BACKUP_DIR="$APP_DIR/backups"
DB_BACKUP_DIR="/var/backups/postgres"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"

# File paths
SUCCESSFUL_DEPLOYMENTS_FILE="$APP_DIR/successful_deployments.txt"
LATEST_BACKUP_MARKER="$BACKUP_DIR/latest_backup"

# Log files
LOG_DIR="/var/log/healthcare"
BACKUP_LOG="$LOG_DIR/backup.log"
OFFSITE_LOG="$LOG_DIR/offsite-backup.log"
ROLLBACK_LOG="$LOG_DIR/rollback.log"
MAINTENANCE_LOG="$LOG_DIR/maintenance.log"
DEBUG_LOG="$LOG_DIR/debug.log"

# Retention settings
RETENTION_COUNT=5  # Number of backups/releases to keep
DB_RETENTION_DAYS=30  # Days to keep database backups
EMERGENCY_RETENTION=3  # Minimum backups to keep in emergency cleanup

# Google Drive settings
GDRIVE_BACKUP_ROOT="HealthcareBackups"
GDRIVE_APP_BACKUP_DIR="$GDRIVE_BACKUP_ROOT/application"
GDRIVE_DB_BACKUP_DIR="$GDRIVE_BACKUP_ROOT/database"
GDRIVE_REPORTS_DIR="$GDRIVE_BACKUP_ROOT/reports"

# Database settings
DB_CONTAINER="latest-postgres"
DB_NAME="userdb"
DB_USER="postgres"

# Function to log messages
log_message() {
  local log_file="$1"
  local message="$2"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $message" | tee -a "$log_file"
}

# Function to log errors
log_error() {
  local log_file="$1"
  local message="$2"
  log_message "$log_file" "ERROR: $message"
}

# Function to log debug information
log_debug() {
  local message="$1"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: $message" >> "$DEBUG_LOG"
}

# Function to ensure directories exist
ensure_backup_dirs() {
  mkdir -p "$LOG_DIR" "$BACKUP_DIR" "$DB_BACKUP_DIR"
  chmod 755 "$LOG_DIR" "$BACKUP_DIR"
  chown -R www-data:www-data "$DB_BACKUP_DIR"
}

# Function to get latest successful deployment
get_latest_successful_deployment() {
  if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
    tail -n 1 "$SUCCESSFUL_DEPLOYMENTS_FILE"
  else
    return 1
  fi
}

# Function to verify backup exists in both locations
verify_backup_exists() {
  local backup_name="$1"
  local backup_type="$2"  # 'application' or 'database'
  local local_path
  local gdrive_path
  
  case "$backup_type" in
    "application")
      local_path="$BACKUP_DIR/$backup_name"
      gdrive_path="$GDRIVE_APP_BACKUP_DIR/$backup_name"
      ;;
    "database")
      local_path="$DB_BACKUP_DIR/$backup_name"
      gdrive_path="$GDRIVE_DB_BACKUP_DIR/$backup_name"
      ;;
    *)
      return 1
      ;;
  esac
  
  # Check local existence
  [ -e "$local_path" ] && \
  # Check Google Drive existence
  rclone lsf "gdrive:$gdrive_path" >/dev/null 2>&1
}

# Function to sync backup between locations
sync_backup() {
  local backup_name="$1"
  local backup_type="$2"  # 'application' or 'database'
  local direction="$3"    # 'to_gdrive' or 'from_gdrive'
  local local_path
  local gdrive_path
  
  case "$backup_type" in
    "application")
      local_path="$BACKUP_DIR/$backup_name"
      gdrive_path="$GDRIVE_APP_BACKUP_DIR/$backup_name"
      ;;
    "database")
      local_path="$DB_BACKUP_DIR/$backup_name"
      gdrive_path="$GDRIVE_DB_BACKUP_DIR/$backup_name"
      ;;
    *)
      return 1
      ;;
  esac
  
  case "$direction" in
    "to_gdrive")
      rclone copy --transfers 4 --progress "$local_path" "gdrive:$gdrive_path"
      ;;
    "from_gdrive")
      rclone copy --transfers 4 --progress "gdrive:$gdrive_path" "$local_path"
      ;;
    *)
      return 1
      ;;
  esac
}

# Initialize
ensure_backup_dirs 