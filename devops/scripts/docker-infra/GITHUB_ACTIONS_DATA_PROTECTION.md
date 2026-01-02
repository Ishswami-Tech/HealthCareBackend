# GitHub Actions Data Protection Enhancements

This document outlines the data protection measures added to the GitHub Actions CI/CD workflow to ensure PostgreSQL and Dragonfly data is safely backed up before container recreation.

## Overview

The CI/CD workflow now includes comprehensive data protection steps that ensure:
1. **Containers are running** before backup (starts them if needed)
2. **Data is backed up** before any container recreation
3. **Containers are stopped gracefully** to flush data to disk
4. **Volumes are verified** before and after recreation
5. **Health checks** ensure services are ready before proceeding

## Enhanced Jobs

### 1. Backup Infrastructure Job (`backup-infrastructure`)

**Location**: `.github/workflows/ci.yml` (lines 245-308)

**Enhancements**:
- ✅ **Ensures containers are running** before backup
  - Checks if PostgreSQL container is running
  - Starts PostgreSQL if not running and waits for health
  - Checks if Dragonfly container is running
  - Starts Dragonfly if not running and waits for health
- ✅ **Explicit error handling** if containers fail to start
- ✅ **Clear logging** with emojis for visibility in GitHub Actions UI

**Flow**:
```
1. Check PostgreSQL container status
   ├─ Not running → Start and wait for health (30 retries, 2s intervals)
   └─ Running → Continue

2. Check Dragonfly container status
   ├─ Not running → Start and wait for health (20 retries, 2s intervals)
   └─ Running → Continue

3. Create backup
   ├─ PostgreSQL: pg_dump → compressed SQL
   ├─ Dragonfly: SAVE command → RDB snapshot
   └─ Upload to S3 (if configured)

4. Exit on failure (prevents data loss)
```

### 2. Recreate Infrastructure Job (`recreate-infrastructure`)

**Location**: `.github/workflows/ci.yml` (lines 360-530)

**Enhancements**:
- ✅ **Volume preservation verification** before recreation
  - Checks if volumes exist (`docker_postgres_data`, `docker_dragonfly_data`)
  - Verifies bind mount paths exist (`/opt/healthcare-backend/data/postgres`, `/opt/healthcare-backend/data/dragonfly`)
  - Creates missing directories if needed
- ✅ **Ensures containers are running** before graceful stop
  - Starts containers if not running (for data flush)
  - Waits for containers to be ready
- ✅ **Graceful container shutdown**
  - Uses `docker compose stop` (respects `stop_grace_period`)
  - Falls back to `docker compose kill` if graceful stop fails
  - Waits 3 seconds for data to flush to disk
- ✅ **Health checks after recreation**
  - Waits for PostgreSQL to be ready (30 retries, 2s intervals)
  - Waits for Dragonfly to be ready (20 retries, 2s intervals)
  - Verifies volumes still exist after recreation
- ✅ **Uses `--force-recreate`** to ensure containers are recreated while preserving volumes

**Flow**:
```
1. Verify volumes exist
   ├─ Check docker volumes
   ├─ Check bind mount paths
   └─ Create missing directories

2. Ensure containers are running (for graceful shutdown)
   ├─ Check PostgreSQL → Start if needed
   └─ Check Dragonfly → Start if needed

3. Stop containers gracefully
   ├─ docker compose stop (with grace period)
   └─ Wait 3s for data flush

4. Recreate containers
   ├─ docker compose up -d --force-recreate
   └─ Volumes are preserved (bind mounts)

5. Wait for health
   ├─ PostgreSQL: pg_isready (30 retries)
   └─ Dragonfly: redis-cli ping (20 retries)

6. Verify volumes after recreation
   └─ Confirm volumes still exist
```

## Safety Features

### 1. Fail-Fast on Backup Failure
- If backup fails, the workflow **aborts immediately**
- Prevents data loss by stopping deployment before container recreation
- Clear error messages in GitHub Actions logs

### 2. Container Health Verification
- Containers must be **healthy** before backup
- Containers must be **healthy** after recreation
- Retry logic with timeouts prevents infinite waiting

### 3. Volume Preservation
- **Bind mounts** ensure data persists even if containers are removed
- Volume paths are verified before and after recreation
- Missing directories are created automatically

### 4. Graceful Shutdown
- Containers stop with configured `stop_grace_period` (1 minute for PostgreSQL)
- Data is flushed to disk before container removal
- Fallback to force stop if graceful stop fails

## Workflow Dependencies

The enhanced workflow maintains proper job dependencies:

```
detect-changes
    ↓
check-infrastructure
    ↓
backup-infrastructure (NEW: Ensures containers running, creates backup)
    ↓
debug-infrastructure
    ↓
recreate-infrastructure (NEW: Verifies volumes, graceful stop, health checks)
    ↓
restore-backup
    ↓
verify-infrastructure
    ↓
deploy
```

## Logging and Visibility

All critical steps include emoji indicators for easy identification in GitHub Actions UI:

- 🔍 **Verifying/Checking** - Verification steps
- ✅ **Success** - Successful operations
- ⚠️ **Warning** - Non-critical issues
- ❌ **Error** - Critical failures
- 💾 **Backup** - Backup operations
- 🛑 **Stop** - Container shutdown
- 🔄 **Recreate** - Container recreation
- ⏳ **Waiting** - Health check retries

## Error Handling

### Backup Job Failures
- **Container won't start**: Exits with error, prevents backup
- **Backup script fails**: Exits with error, prevents deployment
- **S3 upload fails**: Logs warning, but backup succeeds locally

### Recreation Job Failures
- **Volume path creation fails**: Exits with error
- **Container start fails**: Exits with error
- **Health check timeout**: Exits with error after max retries
- **Recreation fails**: Exits with error

## Best Practices

1. **Always backup before recreation** - No exceptions (unless fresh deployment)
2. **Verify volumes before operations** - Ensure data paths exist
3. **Start containers if needed** - Don't assume they're running
4. **Wait for health** - Don't proceed until services are ready
5. **Fail fast** - Abort on critical errors to prevent data loss
6. **Clear logging** - Use emojis and descriptive messages

## Testing

To test the enhanced workflow:

1. **Trigger a deployment** with infrastructure changes
2. **Monitor GitHub Actions logs** for:
   - Container status checks
   - Backup creation
   - Volume verification
   - Graceful shutdown
   - Health checks
3. **Verify data** after deployment:
   - PostgreSQL data is intact
   - Dragonfly cache is restored (if backup existed)
   - Volumes are preserved

## Related Files

- **Deployment Script**: `devops/scripts/docker-infra/deploy.sh`
  - Contains similar data protection logic for standalone deployments
- **Backup Script**: `devops/scripts/docker-infra/backup.sh`
  - Handles PostgreSQL and Dragonfly backup
- **Restore Script**: `devops/scripts/docker-infra/restore.sh`
  - Handles PostgreSQL and Dragonfly restore
- **Docker Compose**: `devops/docker/docker-compose.prod.yml`
  - Defines volumes and container configurations

## Summary

The GitHub Actions workflow now provides **comprehensive data protection** that ensures:

✅ **No data loss** - Backup is mandatory before recreation  
✅ **Volume preservation** - Bind mounts ensure data persists  
✅ **Graceful shutdown** - Data is flushed before container removal  
✅ **Health verification** - Services are ready before proceeding  
✅ **Fail-safe operations** - Deployment aborts on critical errors  

All critical operations are logged with clear indicators, making it easy to monitor and debug deployment issues in the GitHub Actions UI.

