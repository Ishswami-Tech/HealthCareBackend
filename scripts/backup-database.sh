#!/bin/bash
# Healthcare App Database Backup Script
# This script creates a backup of the PostgreSQL database and optionally uploads it to a secure location
# Recommended to run as a daily cron job
#
# To add to crontab:
# 0 1 * * * /var/www/healthcare/backend/current/scripts/backup-database.sh > /dev/null 2>&1

set -e
# Ensure the script runs with error handling
trap 'log_message "ERROR: Script failed at line $LINENO with exit code $?"' ERR

BACKUP_DIR="/var/www/healthcare/backend/backups/db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/userdb_$TIMESTAMP.sql.gz"
LOG_FILE="/var/log/healthcare-backup.log"
KEEP_DAYS=30
DB_CONTAINER="latest-postgres"
DB_NAME="userdb"
DB_USER="postgres"

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

# Check if required commands are available
check_command() {
  command -v $1 >/dev/null 2>&1 || { log_message "ERROR: Required command '$1' not found"; return 1; }
}

for cmd in docker gzip find stat cut; do
  check_command $cmd || exit 1
done

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR
touch $LOG_FILE

log_message "Starting database backup (non-disruptive mode)..."
log_message "IMPORTANT: Database will remain online and available during backup"

# Check if Docker service is running
if check_command systemctl && ! systemctl is-active --quiet docker; then
  log_message "Docker service is not running. Attempting to start..."
  systemctl start docker
  sleep 5
  if ! systemctl is-active --quiet docker; then
    log_message "ERROR: Failed to start Docker service. Cannot proceed with backup."
    exit 1
  fi
fi

# Check if Docker and the database container are running
if ! docker ps | grep -q $DB_CONTAINER; then
  log_message "ERROR: Database container '$DB_CONTAINER' is not running!"
  
  # Check if container exists but is stopped
  if docker ps -a | grep -q $DB_CONTAINER; then
    log_message "Container exists but is stopped. Attempting to start..."
    docker start $DB_CONTAINER
    sleep 10
    
    if ! docker ps | grep -q $DB_CONTAINER; then
      log_message "ERROR: Failed to start database container. Cannot proceed with backup."
      exit 1
    else
      log_message "Successfully started database container."
    fi
  else
    log_message "Container does not exist. Cannot proceed with backup."
    exit 1
  fi
fi

# Wait for database to be ready
log_message "Checking if database is ready for backup..."
retry_count=0
max_retries=10
while ! docker exec $DB_CONTAINER pg_isready -U $DB_USER -d $DB_NAME >/dev/null 2>&1; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -ge $max_retries ]; then
    log_message "ERROR: Database not ready after $max_retries attempts. Cannot proceed with backup."
    exit 1
  fi
  log_message "Database not ready. Waiting 5 seconds... (Attempt $retry_count/$max_retries)"
  sleep 5
done

# Check system load before starting backup
if [ -f /proc/loadavg ]; then
  load=$(cat /proc/loadavg | cut -d ' ' -f1)
  cores=$(nproc 2>/dev/null || echo 1)
  load_per_core=$(echo "$load/$cores" | bc -l 2>/dev/null || echo "$load")
  
  # If system load is very high, wait a bit before starting backup
  if (( $(echo "$load_per_core > 3.0" | bc -l 2>/dev/null || echo "0") )); then
    log_message "System load is high ($load). Waiting 5 minutes before starting backup..."
    sleep 300
  fi
fi

# Check current database activity
log_message "Checking current database activity..."
active_connections=$(docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid();" | tr -d ' ')
if [ "$active_connections" -gt 10 ]; then
  log_message "High database activity detected ($active_connections active connections). Using low-impact backup settings."
  LOW_IMPACT=true
else
  log_message "Normal database activity ($active_connections active connections). Proceeding with standard backup."
  LOW_IMPACT=false
fi

# Create database backup with settings based on activity level
log_message "Creating database backup (database will remain online)..."
if [ "$LOW_IMPACT" = true ]; then
  # Low-impact backup with reduced priority and resource limits
  log_message "Using low-impact backup mode to minimize database load..."
  if ! nice -n 19 docker exec $DB_CONTAINER pg_dump -U $DB_USER -d $DB_NAME \
      --no-owner --no-privileges \
      --jobs=1 \
      --compress=0 | gzip > $BACKUP_FILE; then
    log_message "ERROR: Database backup command failed!"
    exit 1
  fi
else
  # Standard backup with multiple jobs for better performance
  if ! docker exec $DB_CONTAINER pg_dump -U $DB_USER -d $DB_NAME \
      --no-owner --no-privileges \
      --jobs=2 \
      --compress=0 | gzip > $BACKUP_FILE; then
    log_message "ERROR: Database backup command failed!"
    exit 1
  fi
fi

# Check if backup was successful
if [ -f "$BACKUP_FILE" ] && [ $(stat -c%s "$BACKUP_FILE") -gt 1000 ]; then
  log_message "Backup created successfully: $BACKUP_FILE ($(du -h $BACKUP_FILE | cut -f1))"
else
  log_message "ERROR: Backup failed or file is too small!"
  exit 1
fi

# Verify backup can be restored (partial test without actual restore)
log_message "Verifying backup integrity..."
if ! gzip -t $BACKUP_FILE; then
  log_message "WARNING: Backup verification failed! The backup file may be corrupted."
else
  log_message "Backup verification successful."
fi

# Remove old backups
log_message "Removing backups older than $KEEP_DAYS days..."
find $BACKUP_DIR -name "userdb_*.sql.gz" -type f -mtime +$KEEP_DAYS -delete

# Count remaining backups
BACKUP_COUNT=$(find $BACKUP_DIR -name "userdb_*.sql.gz" | wc -l)
log_message "$BACKUP_COUNT backups currently stored"

# Optional: Upload to cloud storage (uncomment and configure as needed)
# if check_command aws; then
#   log_message "Uploading backup to S3..."
#   aws s3 cp $BACKUP_FILE s3://your-backup-bucket/healthcare/$(basename $BACKUP_FILE)
#   if [ $? -eq 0 ]; then
#     log_message "Backup successfully uploaded to S3"
#   else
#     log_message "WARNING: Failed to upload backup to S3"
#   fi
# fi

# Calculate total backup size
TOTAL_SIZE=$(du -sh $BACKUP_DIR | cut -f1)
log_message "Total backup size: $TOTAL_SIZE"

# Check backup directory disk space
DISK_USAGE=$(df -h $BACKUP_DIR | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 80 ]; then
  log_message "WARNING: Backup disk usage is high (${DISK_USAGE}%)!"
  
  # If disk usage is extremely high, remove some older backups even if they're not past retention
  if [ "$DISK_USAGE" -gt 90 ]; then
    log_message "CRITICAL: Disk usage above 90%. Emergency cleanup of older backups..."
    # Keep only the 10 most recent backups
    find $BACKUP_DIR -name "userdb_*.sql.gz" -type f | sort | head -n -10 | xargs -r rm -f
    log_message "Emergency cleanup completed. Remaining backups: $(find $BACKUP_DIR -name "userdb_*.sql.gz" | wc -l)"
  fi
fi

log_message "Database backup completed successfully. Database remained fully operational during the process."
exit 0 