#!/bin/bash
# Healthcare App Offsite Backup Script
# This script syncs backups to Google Drive or other remote storage

set -e

APP_DIR="/var/www/healthcare/backend"
BACKUP_DIR="$APP_DIR/backups"
DB_BACKUP_DIR="/var/backups/postgres"
LOG_FILE="/var/log/healthcare/offsite-backup.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to install rclone if not present
ensure_rclone() {
  if ! command_exists rclone; then
    log_message "Installing rclone..."
    curl https://rclone.org/install.sh | sudo bash
    log_message "rclone installed successfully"
  else
    log_message "rclone is already installed"
  fi
}

# Function to automatically configure rclone for Google Drive
configure_rclone() {
  EMAIL="aadeshbhujbal99@gmail.com"
  CONFIG_FILE="/root/.config/rclone/rclone.conf"
  CONFIG_DIR=$(dirname "$CONFIG_FILE")
  
  # Create config directory if it doesn't exist
  mkdir -p "$CONFIG_DIR"
  
  # Check if config file already exists and is configured
  if [ -f "$CONFIG_FILE" ] && grep -q "gdrive" "$CONFIG_FILE"; then
    log_message "rclone is already configured with Google Drive"
    return 0
  fi
  
  log_message "Configuring rclone for Google Drive with account $EMAIL"
  
  # Install required packages
  apt-get update && apt-get install -y expect > /dev/null 2>&1
  
  # Create expect script to automate rclone config
  cat > /tmp/rclone_config.exp << EOF
#!/usr/bin/expect -f
set timeout -1
spawn rclone config
expect "n/s/q>"
send "n\r"
expect "name>"
send "gdrive\r"
expect "Storage>"
send "drive\r"
expect "client_id>"
send "\r"
expect "client_secret>"
send "\r"
expect "scope>"
send "1\r"
expect "root_folder_id>"
send "\r"
expect "service_account_file>"
send "\r"
expect "Edit advanced config?"
send "n\r"
expect "Use auto config?"
send "n\r"
expect "Please go to the following link:"
set link "\$expect_out(buffer)"
puts "Please visit the following URL to authorize rclone:"
puts \$link
expect "Enter verification code>"

# Wait for user to manually enter verification code
puts "*** MANUAL STEP REQUIRED ***"
puts "1. Copy the URL displayed above"
puts "2. Open it in a browser while logged in as $EMAIL"
puts "3. Authorize the app and copy the verification code"
puts "4. Paste the verification code here and press Enter"
expect_user -re "(.*)\r"
set code \$expect_out(1,string)
send "\$code\r"

expect "Configure this as a team drive?"
send "n\r"
expect "y/n>"
send "y\r"
expect "q>"
send "q\r"
expect eof
EOF
  
  # Make the expect script executable
  chmod +x /tmp/rclone_config.exp
  
  # Manual configuration instruction
  log_message "===== MANUAL CONFIGURATION STEP ====="
  log_message "To complete the Google Drive setup, you need to authorize rclone once."
  log_message "Please follow the instructions when the authorization URL appears."
  log_message "This only needs to be done once."
  log_message "====================================="
  
  # Run the expect script
  /tmp/rclone_config.exp
  
  # Clean up
  rm -f /tmp/rclone_config.exp
  
  # Check if configuration was successful
  if grep -q "gdrive" "$CONFIG_FILE"; then
    log_message "rclone configured successfully for Google Drive with account $EMAIL"
    # Create HealthcareBackups folder structure
    rclone mkdir gdrive:HealthcareBackups
    rclone mkdir gdrive:HealthcareBackups/application
    rclone mkdir gdrive:HealthcareBackups/database
    rclone mkdir gdrive:HealthcareBackups/reports
    log_message "Created folder structure in Google Drive"
    return 0
  else
    log_message "Failed to configure rclone for Google Drive"
    return 1
  fi
}

# Function to check if rclone is configured
check_rclone_config() {
  if ! rclone listremotes | grep -q "gdrive:"; then
    log_message "Google Drive remote 'gdrive:' is not configured in rclone"
    log_message "Attempting to configure automatically..."
    if configure_rclone; then
      log_message "Successfully configured rclone for Google Drive"
      return 0
    else
      log_message "ERROR: Failed to configure rclone automatically"
      log_message "Please run 'rclone config' manually to set up Google Drive access"
      return 1
    fi
  fi
  log_message "rclone is properly configured with Google Drive remote"
  return 0
}

# Function to sync app backups to Google Drive
sync_app_backups() {
  log_message "Syncing application backups to Google Drive..."
  
  # Create a timestamp for this backup
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  
  # Ensure the backup directory exists
  if [ ! -d "$BACKUP_DIR" ]; then
    log_message "ERROR: Backup directory $BACKUP_DIR does not exist"
    return 1
  fi
  
  # Check if there are any backups
  if [ -z "$(ls -A $BACKUP_DIR 2>/dev/null)" ]; then
    log_message "No application backups found to sync"
    return 0
  fi
  
  # Compress the latest backup
  LATEST_BACKUP=""
  if [ -f "$BACKUP_DIR/latest_backup" ]; then
    LATEST_BACKUP=$(cat "$BACKUP_DIR/latest_backup")
    if [ -d "$BACKUP_DIR/$LATEST_BACKUP" ]; then
      log_message "Found latest backup: $LATEST_BACKUP"
      
      # Create archive of the latest backup
      ARCHIVE_NAME="healthcare_app_${LATEST_BACKUP}_${TIMESTAMP}.tar.gz"
      log_message "Creating archive: $ARCHIVE_NAME"
      tar -czf "/tmp/$ARCHIVE_NAME" -C "$BACKUP_DIR" "$LATEST_BACKUP"
      
      # Sync to Google Drive
      log_message "Uploading archive to Google Drive..."
      # Creates a folder structure: HealthcareBackups/application/ in your Google Drive
      rclone copy "/tmp/$ARCHIVE_NAME" gdrive:HealthcareBackups/application/
      
      # Clean up temporary archive
      rm -f "/tmp/$ARCHIVE_NAME"
      log_message "Application backup synced to Google Drive successfully"
    else
      log_message "WARNING: Latest backup directory $BACKUP_DIR/$LATEST_BACKUP not found"
    fi
  else
    log_message "WARNING: No latest_backup marker found"
  fi
}

# Function to sync database backups to Google Drive
sync_db_backups() {
  log_message "Syncing database backups to Google Drive..."
  
  # Ensure the DB backup directory exists
  if [ ! -d "$DB_BACKUP_DIR" ]; then
    log_message "ERROR: Database backup directory $DB_BACKUP_DIR does not exist"
    return 1
  fi
  
  # Check if there are any DB backups
  if [ -z "$(ls -A $DB_BACKUP_DIR 2>/dev/null)" ]; then
    log_message "No database backups found to sync"
    return 0
  fi
  
  # Find the latest database backup
  LATEST_DB_BACKUP=$(find "$DB_BACKUP_DIR" -type f -name "*.sql.gz" -o -name "*.dump" | sort -r | head -n 1)
  
  if [ -n "$LATEST_DB_BACKUP" ]; then
    log_message "Found latest database backup: $LATEST_DB_BACKUP"
    
    # Sync to Google Drive
    log_message "Uploading database backup to Google Drive..."
    rclone copy "$LATEST_DB_BACKUP" gdrive:HealthcareBackups/database/
    log_message "Database backup synced to Google Drive successfully"
  else
    log_message "WARNING: No database backups found to sync"
  fi
}

# Function to create a complete system backup report
create_system_report() {
  log_message "Creating system report..."
  REPORT_FILE="/tmp/healthcare_system_report_$(date +%Y%m%d_%H%M%S).txt"
  
  {
    echo "===== HEALTHCARE SYSTEM BACKUP REPORT ====="
    echo "Date: $(date)"
    echo "Hostname: $(hostname)"
    echo "IP: $(hostname -I || echo 'Unable to determine IP')"
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
    if [ -f "$APP_DIR/successful_deployments.txt" ]; then
      echo "Successful deployments:"
      cat "$APP_DIR/successful_deployments.txt"
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
    
  } > "$REPORT_FILE"
  
  # Upload the report to Google Drive
  log_message "Uploading system report to Google Drive..."
  rclone copy "$REPORT_FILE" gdrive:HealthcareBackups/reports/
  
  # Cleanup
  rm -f "$REPORT_FILE"
  log_message "System report created and uploaded successfully"
}

# Main execution
log_message "====================== OFFSITE BACKUP PROCESS STARTED ======================"

# Ensure rclone is installed
ensure_rclone

# Check rclone configuration
if check_rclone_config; then
  # Sync backups
  sync_app_backups
  sync_db_backups
  create_system_report
  
  log_message "✅ Offsite backup process completed successfully"
  exit 0
else
  log_message "❌ Offsite backup process failed - rclone not configured correctly"
  log_message "Please run 'rclone config' on the server to set up Google Drive"
  exit 1
fi 