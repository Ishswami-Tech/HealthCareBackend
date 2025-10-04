#!/bin/bash
# Healthcare App Offsite Backup Script
# This script syncs backups to Google Drive or other remote storage

set -e

# Source shared configuration
source "$(dirname "$0")/backup-config.sh"

APP_DIR="/var/www/healthcare/backend"
BACKUP_DIR="$APP_DIR/backups"
DB_BACKUP_DIR="/var/backups/postgres"
LOG_FILE="/var/log/healthcare/offsite-backup.log"
DEBUG_LOG_FILE="/var/log/healthcare/offsite-backup-debug.log"
SUCCESSFUL_DEPLOYMENTS_FILE="$APP_DIR/successful_deployments.txt"
RETENTION_COUNT=5  # Number of backups to keep

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$DEBUG_LOG_FILE")"

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function for error logging
log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE" | tee -a "$DEBUG_LOG_FILE"
}

# Function to log debug information
log_debug() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: $1" >> "$DEBUG_LOG_FILE"
}

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to verify file upload to Google Drive
verify_gdrive_upload() {
  local source_file="$1"
  local gdrive_path="$2"
  local file_name=$(basename "$source_file")
  
  log_debug "Verifying upload of $file_name to $gdrive_path"
  
  # Get local file size and MD5
  local_size=$(stat -f%z "$source_file" 2>/dev/null || stat -c%s "$source_file")
  local_md5=$(md5sum "$source_file" | cut -d' ' -f1)
  
  # Get remote file size and MD5
  remote_size=$(rclone size "${gdrive_path}/${file_name}" 2>/dev/null | grep "Total size:" | awk '{print $3}')
  remote_md5=$(rclone md5sum "${gdrive_path}/${file_name}" 2>/dev/null | cut -d' ' -f1)
  
  if [ "$local_size" = "$remote_size" ] && [ "$local_md5" = "$remote_md5" ]; then
    log_debug "Verification successful for $file_name"
    return 0
  else
    log_error "Verification failed for $file_name (size: $local_size/$remote_size, md5: $local_md5/$remote_md5)"
    return 1
  fi
}

# Function to clean up old backups in Google Drive
cleanup_gdrive_backups() {
  local backup_type="$1"  # 'application', 'database', or 'reports'
  local retention="$2"    # number of backups to keep
  
  log_message "Cleaning up old $backup_type backups in Google Drive..."
  
  # List files sorted by modification time
  local files_to_delete=$(rclone lsf --format "tp" "gdrive:$GDRIVE_BACKUP_ROOT/$backup_type" | sort -r | tail -n +$((retention + 1)) | cut -d';' -f2)
  
  if [ -n "$files_to_delete" ]; then
    echo "$files_to_delete" | while read -r file; do
      if [ -n "$file" ]; then
        log_debug "Deleting old backup: $file"
        rclone delete "gdrive:$GDRIVE_BACKUP_ROOT/$backup_type/$file"
      fi
    done
    log_message "Cleaned up old $backup_type backups in Google Drive"
  else
    log_debug "No old $backup_type backups to clean up in Google Drive"
  fi
}

# Function to get the latest successful deployment
get_latest_successful_deployment() {
  if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
    tail -n 1 "$SUCCESSFUL_DEPLOYMENTS_FILE"
  else
    log_error "No successful deployments file found"
    return 1
  fi
}

# Function to ensure required directories exist
ensure_directories() {
  log_message "$OFFSITE_LOG" "Ensuring required directories exist..."
  
  # Create application backup directory if it doesn't exist
  if [ ! -d "$BACKUP_DIR" ]; then
    log_message "$OFFSITE_LOG" "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
    chmod 755 "$BACKUP_DIR"
  fi
  
  # Create database backup directory if it doesn't exist
  if [ ! -d "$DB_BACKUP_DIR" ]; then
    log_message "$OFFSITE_LOG" "Creating database backup directory: $DB_BACKUP_DIR"
    sudo mkdir -p "$DB_BACKUP_DIR"
    sudo chown -R www-data:www-data "$DB_BACKUP_DIR"
    chmod 700 "$DB_BACKUP_DIR"
  fi
  
  # Create latest_backup marker if it doesn't exist
  if [ ! -f "$LATEST_BACKUP_MARKER" ]; then
    log_message "$OFFSITE_LOG" "Creating latest_backup marker..."
    # Try to get the latest successful deployment first
    LATEST_DEPLOY=$(get_latest_successful_deployment)
    if [ -n "$LATEST_DEPLOY" ] && [ -d "$RELEASES_DIR/$LATEST_DEPLOY" ]; then
      echo "$LATEST_DEPLOY" > "$LATEST_BACKUP_MARKER"
      log_message "$OFFSITE_LOG" "Set latest_backup to successful deployment: $LATEST_DEPLOY"
    else
      # Fall back to timestamp-based backup
      TIMESTAMP=$(date +%Y%m%d_%H%M%S)
      mkdir -p "$BACKUP_DIR/$TIMESTAMP"
      echo "$TIMESTAMP" > "$LATEST_BACKUP_MARKER"
      log_message "$OFFSITE_LOG" "Created initial backup directory: $TIMESTAMP"
    fi
  fi
  
  # Ensure Google Drive directories exist
  log_message "$OFFSITE_LOG" "Ensuring Google Drive directories exist..."
  rclone mkdir "gdrive:$GDRIVE_BACKUP_ROOT" 2>/dev/null || true
  rclone mkdir "gdrive:$GDRIVE_APP_BACKUP_DIR" 2>/dev/null || true
  rclone mkdir "gdrive:$GDRIVE_DB_BACKUP_DIR" 2>/dev/null || true
  rclone mkdir "gdrive:$GDRIVE_REPORTS_DIR" 2>/dev/null || true
}

# Function to install rclone if not present
ensure_rclone() {
  if ! command_exists rclone; then
    log_message "Installing rclone..."
    curl -s https://rclone.org/install.sh | sudo bash
    if command_exists rclone; then
      log_message "rclone installed successfully"
    else
      log_error "Failed to install rclone"
      return 1
    fi
  else
    log_message "rclone is already installed (version: $(rclone --version | head -n 1))"
  fi
  return 0
}

# Function to check if rclone is configured
check_rclone_config() {
  if ! rclone listremotes | grep -q "gdrive:"; then
    log_error "Google Drive remote 'gdrive:' is not configured in rclone"
    log_error "Please run 'rclone config' manually to set up Google Drive access"
      return 1
    fi
  
  # Test Google Drive access
  if ! rclone lsd gdrive: >/dev/null 2>&1; then
    log_error "Cannot access Google Drive. Please check authentication"
    return 1
  fi
  
  log_message "rclone is properly configured with Google Drive remote"
  return 0
}

# Function to sync app backups to Google Drive
sync_app_backups() {
  log_message "$OFFSITE_LOG" "Syncing application backups to Google Drive..."
  
  # Create a timestamp for this backup
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  
  # Try to get the latest successful deployment
  LATEST_DEPLOY=$(get_latest_successful_deployment)
  if [ -n "$LATEST_DEPLOY" ] && [ -d "$APP_DIR/releases/$LATEST_DEPLOY" ]; then
    log_message "$OFFSITE_LOG" "Found latest successful deployment: $LATEST_DEPLOY"
    
    # Create backup from successful deployment
    mkdir -p "$BACKUP_DIR/$TIMESTAMP"
    cp -r "$APP_DIR/releases/$LATEST_DEPLOY"/* "$BACKUP_DIR/$TIMESTAMP/"
    echo "$TIMESTAMP" > "$BACKUP_DIR/latest_backup"
    
    # Create archive of the backup
    ARCHIVE_NAME="healthcare_app_${TIMESTAMP}_deploy_${LATEST_DEPLOY}.tar.gz"
    log_message "$OFFSITE_LOG" "Creating archive: $ARCHIVE_NAME"
    tar -czf "/tmp/$ARCHIVE_NAME" -C "$BACKUP_DIR" "$TIMESTAMP" || {
      log_error "$OFFSITE_LOG" "Failed to create archive"
      return 1
    }
    
    # Upload to Google Drive with parallel transfer and verification
    log_message "$OFFSITE_LOG" "Uploading archive to Google Drive..."
    if rclone copy --transfers 4 --progress "/tmp/$ARCHIVE_NAME" "gdrive:$GDRIVE_APP_BACKUP_DIR/" 2>&1 | tee -a "$DEBUG_LOG_FILE"; then
      if verify_gdrive_upload "/tmp/$ARCHIVE_NAME" "gdrive:$GDRIVE_APP_BACKUP_DIR"; then
        log_message "$OFFSITE_LOG" "Application backup uploaded and verified successfully"
      else
        log_error "$OFFSITE_LOG" "Application backup verification failed"
    return 1
  fi
    else
      log_error "$OFFSITE_LOG" "Failed to upload application backup to Google Drive"
      return 1
    fi
    
    # Clean up temporary archive
    rm -f "/tmp/$ARCHIVE_NAME"
    
    # Clean up old backups (local)
    find "$BACKUP_DIR" -maxdepth 1 -type d -not -name "." -not -name ".." | \
      sort -r | tail -n +$((RETENTION_COUNT + 1)) | xargs -r rm -rf
    log_message "$OFFSITE_LOG" "Cleaned up old local application backups"
    
    # Clean up old backups (Google Drive)
    cleanup_gdrive_backups "application" "$RETENTION_COUNT"
  else
    log_error "$OFFSITE_LOG" "No successful deployment found to backup"
    # Create an empty backup directory just to maintain the structure
    mkdir -p "$BACKUP_DIR/$TIMESTAMP"
    echo "$TIMESTAMP" > "$BACKUP_DIR/latest_backup"
  fi
}

# Function to sync database backups to Google Drive
sync_db_backups() {
  log_message "$OFFSITE_LOG" "Syncing database backups to Google Drive..."
  
  # Create DB backup directory if it doesn't exist
  if [ ! -d "$DB_BACKUP_DIR" ]; then
    log_message "$OFFSITE_LOG" "Creating database backup directory..."
    sudo mkdir -p "$DB_BACKUP_DIR"
    sudo chown -R www-data:www-data "$DB_BACKUP_DIR"
  fi
  
  # Get latest successful deployment for backup name
  LATEST_DEPLOY=$(get_latest_successful_deployment)
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  
  # Create the backup filename
  if [ -n "$LATEST_DEPLOY" ]; then
    DB_BACKUP_FILE="$DB_BACKUP_DIR/healthcare_db_${TIMESTAMP}_deploy_${LATEST_DEPLOY}.sql.gz"
  else
    DB_BACKUP_FILE="$DB_BACKUP_DIR/healthcare_db_${TIMESTAMP}.sql.gz"
  fi
  
  log_message "$OFFSITE_LOG" "Creating new database backup..."
  if docker exec latest-postgres pg_dumpall -U postgres | gzip > "$DB_BACKUP_FILE"; then
    log_message "$OFFSITE_LOG" "Database backup created successfully: $DB_BACKUP_FILE"
    
    # Upload to Google Drive with parallel transfer and verification
    log_message "$OFFSITE_LOG" "Uploading database backup to Google Drive..."
    if rclone copy --transfers 4 --progress "$DB_BACKUP_FILE" "gdrive:$GDRIVE_DB_BACKUP_DIR/" 2>&1 | tee -a "$DEBUG_LOG_FILE"; then
      if verify_gdrive_upload "$DB_BACKUP_FILE" "gdrive:$GDRIVE_DB_BACKUP_DIR"; then
        log_message "$OFFSITE_LOG" "Database backup uploaded and verified successfully"
      else
        log_error "$OFFSITE_LOG" "Database backup verification failed"
        return 1
      fi
    else
      log_error "$OFFSITE_LOG" "Failed to upload database backup to Google Drive"
      return 1
    fi
    
    # Clean up old backups (local)
    find "$DB_BACKUP_DIR" -name "*.sql.gz" -type f -printf '%T@ %p\n' | \
      sort -n | head -n -"$RETENTION_COUNT" | cut -d' ' -f2- | xargs -r rm
    log_message "$OFFSITE_LOG" "Cleaned up old local database backups"
    
    # Clean up old backups (Google Drive)
    cleanup_gdrive_backups "database" "$RETENTION_COUNT"
  else
    log_error "$OFFSITE_LOG" "Failed to create database backup"
    return 1
  fi
}

# Function to create a complete system backup report
create_system_report() {
  log_message "$OFFSITE_LOG" "Creating system report..."
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  LATEST_DEPLOY=$(get_latest_successful_deployment)
  REPORT_FILE="/tmp/healthcare_system_report_${TIMESTAMP}.txt"
  
  {
    echo "===== HEALTHCARE SYSTEM BACKUP REPORT ====="
    echo "Date: $(date)"
    echo "Hostname: $(hostname)"
    echo "IP: $(hostname -I || echo 'Unable to determine IP')"
    if [ -n "$LATEST_DEPLOY" ]; then
      echo "Latest Successful Deployment: $LATEST_DEPLOY"
    fi
    echo ""
    
    echo "===== DOCKER CONTAINERS ====="
    docker ps -a || echo "Failed to get container information"
    echo ""
    
    echo "===== DOCKER VOLUMES ====="
    docker volume ls || echo "Failed to get volume information"
    echo ""
    
    echo "===== DISK USAGE ====="
    df -h || echo "Failed to get disk usage"
    echo ""
    
    echo "===== MEMORY USAGE ====="
    free -h || echo "Failed to get memory usage"
    echo ""
    
    echo "===== DEPLOYMENTS ====="
    if [ -f "$SUCCESSFUL_DEPLOYMENTS_FILE" ]; then
      echo "Successful deployments (most recent first):"
      tac "$SUCCESSFUL_DEPLOYMENTS_FILE"
    else
      echo "No successful deployments file found"
    fi
    echo ""
    
    echo "===== BACKUP INVENTORY ====="
    echo "Application backups:"
    ls -la "$BACKUP_DIR" || echo "Failed to list application backups"
    echo ""
    echo "Database backups:"
    ls -la "$DB_BACKUP_DIR" || echo "Failed to list database backups"
    echo ""
    
    echo "===== GOOGLE DRIVE BACKUP INVENTORY ====="
    echo "Application backups in Google Drive:"
    rclone ls "gdrive:$GDRIVE_APP_BACKUP_DIR" || echo "Failed to list Google Drive application backups"
    echo ""
    echo "Database backups in Google Drive:"
    rclone ls "gdrive:$GDRIVE_DB_BACKUP_DIR" || echo "Failed to list Google Drive database backups"
    echo ""
    echo "Previous reports in Google Drive:"
    rclone ls "gdrive:$GDRIVE_REPORTS_DIR" || echo "Failed to list Google Drive reports"
    
  } > "$REPORT_FILE"
  
  # Upload the report to Google Drive with verification
  log_message "$OFFSITE_LOG" "Uploading system report to Google Drive..."
  if rclone copy --progress "$REPORT_FILE" "gdrive:$GDRIVE_REPORTS_DIR/" 2>&1 | tee -a "$DEBUG_LOG_FILE"; then
    if verify_gdrive_upload "$REPORT_FILE" "gdrive:$GDRIVE_REPORTS_DIR"; then
      log_message "$OFFSITE_LOG" "System report uploaded and verified successfully"
    else
      log_error "$OFFSITE_LOG" "System report verification failed"
      return 1
    fi
  else
    log_error "$OFFSITE_LOG" "Failed to upload system report to Google Drive"
    return 1
  fi
  
  # Cleanup
  rm -f "$REPORT_FILE"
  
  # Clean up old reports in Google Drive
  cleanup_gdrive_backups "reports" "$RETENTION_COUNT"
  
  log_message "$OFFSITE_LOG" "System report process completed"
}

# Main execution
log_message "$OFFSITE_LOG" "====================== OFFSITE BACKUP PROCESS STARTED ======================"

# Ensure required directories exist
ensure_directories || {
  log_error "$OFFSITE_LOG" "Failed to ensure required directories"
  exit 1
}

# Ensure rclone is installed
if ! ensure_rclone; then
  log_error "$OFFSITE_LOG" "Failed to ensure rclone installation"
  exit 1
fi

# Check rclone configuration
if check_rclone_config; then
  # Initialize error flag
  ERROR_FLAG=0
  
  # Sync backups with error handling
  sync_app_backups || ERROR_FLAG=1
  sync_db_backups || ERROR_FLAG=1
  create_system_report || ERROR_FLAG=1
  
  if [ $ERROR_FLAG -eq 0 ]; then
    log_message "$OFFSITE_LOG" "✅ Offsite backup process completed successfully"
  exit 0
  else
    log_error "$OFFSITE_LOG" "❌ Offsite backup process completed with errors"
    exit 1
  fi
else
  log_error "$OFFSITE_LOG" "❌ Offsite backup process failed - rclone not configured correctly"
  log_error "$OFFSITE_LOG" "Please run 'rclone config' on the server to set up Google Drive"
  exit 1
fi 