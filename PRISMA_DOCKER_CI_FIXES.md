# Prisma Docker & CI/CD Fixes

## Summary

Fixed PrismaClient initialization issues that were causing "Retry failed" errors
during application startup in Docker production environments.

## Issues Identified

1. **PrismaClient Not Ready During Startup**: Database queries were being
   executed before PrismaClient was fully initialized, causing "Retry failed"
   errors.

2. **Missing Prisma Initialization Errors in Retry Logic**: Prisma
   initialization errors (e.g., "did not initialize yet", "prisma generate")
   were not included in the retryable errors list, causing immediate failures
   instead of retries.

3. **getRawPrismaClient() Race Condition**: The method was trying to create a
   new PrismaClient instance synchronously before `onModuleInit()` completed,
   instead of waiting for the shared singleton instance.

## Fixes Applied

### 1. Fixed `getRawPrismaClient()` in `PrismaService` ✅

**File**: `src/libs/infrastructure/database/prisma/prisma.service.ts`

**Changes**:

- Now checks for `PrismaService.sharedPrismaClient` first (created in
  `onModuleInit()`)
- Waits for `onModuleInit()` to complete instead of trying to create a new
  instance
- Polls for the shared instance with retry mechanism
- Provides better error messages when PrismaClient is not ready

**Before**:

```typescript
getRawPrismaClient(): PrismaClient {
  if (!this.prismaClient) {
    // Tried to create new instance synchronously
    // This failed because initialization happens in onModuleInit()
  }
}
```

**After**:

```typescript
getRawPrismaClient(): PrismaClient {
  // First check if shared instance exists (created in onModuleInit)
  if (PrismaService.sharedPrismaClient) {
    this.prismaClient = PrismaService.sharedPrismaClient;
    return this.prismaClient;
  }

  // Wait for onModuleInit to complete by polling for shared instance
  // ... retry logic with proper waiting
}
```

### 2. Added Prisma Initialization Errors to Retryable Errors ✅

**File**: `src/libs/infrastructure/database/internal/retry.service.ts`

**Changes**:

- Added Prisma initialization errors to the `defaultRetryableErrors` list
- These errors are now retryable during startup, preventing immediate failures

**Added Errors**:

- `'did not initialize yet'`
- `'prisma generate'`
- `'PrismaClient'`
- `'not generated'`
- `'not ready'`
- `'Invalid invocation'`

### 3. Added Prisma Readiness Check in Database Service ✅

**File**: `src/libs/infrastructure/database/database.service.ts`

**Changes**:

- Added `waitUntilReady()` check in both `executeRead()` and `executeWrite()`
  methods
- Ensures PrismaClient is fully initialized before executing any database
  queries
- Prevents "Retry failed" errors during application startup

**Implementation**:

```typescript
const executeWithRetry = async (): Promise<T> => {
  // CRITICAL: Wait for Prisma to be ready before executing queries
  if (!this.prismaService.isReady()) {
    const isReady = await this.prismaService.waitUntilReady(30000); // 30 second timeout
    if (!isReady) {
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        'Prisma client not ready within timeout',
        undefined,
        {},
        this.serviceName
      );
    }
  }
  // ... rest of execution logic
};
```

## Docker Configuration Verification

### Dockerfile ✅

**File**: `devops/docker/Dockerfile`

**Status**: Already correctly configured

- Prisma Client is generated during Docker build (line 34:
  `RUN yarn prisma:generate`)
- Prisma Client is copied to production stage (lines 183-184)
- Entrypoint script verifies Prisma Client exists (lines 210-218)
- Symlink is created to `@prisma/client` (lines 220-226)

**No changes needed** - Docker configuration is correct.

### docker-compose.prod.yml ✅

**File**: `devops/docker/docker-compose.prod.yml`

**Status**: Already correctly configured

- Database connection string is properly configured (line 314)
- Prisma schema path is set (line 325)
- Health checks are configured (lines 403-408)
- Dependencies ensure PostgreSQL is ready before API starts (lines 392-401)

**No changes needed** - Docker Compose configuration is correct.

## CI/CD Considerations

### Prisma Generation in CI/CD

**Current Setup**:

- Prisma Client is generated during Docker build (not in CI lint jobs)
- This is the correct approach for production deployments

**Recommendations**:

1. ✅ **Keep Prisma generation in Docker build** - This ensures consistent
   client generation across environments
2. ✅ **Verify Prisma Client in entrypoint** - Already implemented in Dockerfile
3. ✅ **Run migrations at container startup** - Already implemented in
   Dockerfile CMD

### CI/CD Workflow Recommendations

If you have CI/CD workflows, ensure:

1. **Build Stage**: Prisma Client is generated during Docker image build
2. **Deploy Stage**: Migrations run automatically at container startup (already
   configured)
3. **Health Checks**: Wait for Prisma to be ready before marking container as
   healthy (already configured with 120s start period)

## Testing

### Local Testing

```bash
# Build Docker image
docker build -f devops/docker/Dockerfile -t healthcare-api:test .

# Run with docker-compose
docker-compose -f devops/docker/docker-compose.prod.yml up
```

### Production Testing

1. Deploy updated code to production
2. Monitor application logs for Prisma initialization warnings
3. Verify database queries succeed after application startup
4. Check health endpoint: `GET /health`

## Expected Behavior

### Before Fixes

- ❌ Multiple "PrismaClient not generated yet" warnings during startup
- ❌ "Retry failed" errors when database queries execute before Prisma is ready
- ❌ Login and other database operations fail during startup

### After Fixes

- ✅ PrismaClient initialization warnings are reduced (only during initial
  startup)
- ✅ Database queries wait for Prisma to be ready before executing
- ✅ "Retry failed" errors are eliminated
- ✅ Login and other database operations succeed after Prisma initialization

## Monitoring

### Key Metrics to Monitor

1. **Prisma Initialization Time**: Should be < 10 seconds in production
2. **Database Query Success Rate**: Should be 100% after startup grace period
3. **Application Startup Time**: Should include Prisma initialization time

### Log Messages to Watch

- `[WARN] PrismaClient not generated yet` - Should only appear during startup
- `[ERROR] Retry failed` - Should no longer appear
- `[LOG] Prisma client fully initialized` - Confirms successful initialization

## Package.json Analysis

### Current Configuration ✅

**File**: `package.json`

**Prisma Scripts**:

- Line 40: `prisma:generate` - Correctly configured with schema and config paths
- Line 43: `postinstall: "yarn prisma:generate || true"` - Runs in local
  development

**Docker Compatibility**:

- ✅ Dockerfile uses `--ignore-scripts` flag (line 22, 140) to skip
  `postinstall`
- ✅ Prisma Client is explicitly generated during Docker build (line 34 of
  Dockerfile)
- ✅ Production stage also uses `--ignore-scripts` to prevent postinstall from
  running

**Potential Issues & Recommendations**:

1. **postinstall Script with `|| true`** (Line 43)
   - **Current**: `"postinstall": "yarn prisma:generate || true"`
   - **Issue**: The `|| true` suppresses errors, which could hide Prisma
     generation failures in local development
   - **Recommendation**: Consider removing `|| true` for better error
     visibility, OR make it conditional:
     ```json
     "postinstall": "node -e \"if (process.env.SKIP_PRISMA_GENERATE !== 'true') { require('child_process').execSync('yarn prisma:generate', {stdio: 'inherit'}) }\" || true"
     ```
   - **Status**: ✅ **Acceptable** - Works correctly in Docker (skipped), and
     `|| true` allows local dev to continue even if Prisma generation fails
     (user can manually run it)

2. **Build Scripts** (Lines 9-12)
   - ✅ All build scripts are correctly configured
   - ✅ `pre-build` runs validation including `prisma:validate` (line 14)
   - ✅ No issues detected

3. **Deploy Scripts** (Lines 53-54)
   - ✅ `deploy:dev` and `deploy:prod` correctly include `prisma:generate`
   - ✅ Production deploy includes build step before Prisma generation
   - ✅ No issues detected

### Recommendations

**Option 1: Keep Current Configuration** (Recommended)

- Current setup works correctly in Docker (postinstall is skipped)
- `|| true` in postinstall is acceptable for local development flexibility
- No changes needed

**Option 2: Improve Error Visibility** (Optional)

- Remove `|| true` from postinstall to fail fast if Prisma generation fails
- Add environment variable check to skip postinstall in CI/CD:
  ```json
  "postinstall": "if [ \"$SKIP_PRISMA_GENERATE\" != \"true\" ]; then yarn prisma:generate; fi"
  ```

**Option 3: Make postinstall Conditional** (Optional)

- Only run postinstall in development, skip in production/CI:
  ```json
  "postinstall": "if [ \"$NODE_ENV\" != \"production\" ] && [ \"$SKIP_PRISMA_GENERATE\" != \"true\" ]; then yarn prisma:generate || true; fi"
  ```

**Current Status**: ✅ **No changes required** - Package.json is correctly
configured for Docker builds.

## Related Files

- `package.json` - Package configuration (verified ✅)
- `src/libs/infrastructure/database/prisma/prisma.service.ts` - PrismaService
  with initialization fixes
- `src/libs/infrastructure/database/database.service.ts` - DatabaseService with
  readiness checks
- `src/libs/infrastructure/database/internal/retry.service.ts` - RetryService
  with Prisma error handling
- `devops/docker/Dockerfile` - Docker build configuration
- `devops/docker/docker-compose.prod.yml` - Docker Compose production
  configuration

## Conclusion

All Prisma initialization issues have been addressed:

1. ✅ Fixed `getRawPrismaClient()` to wait for shared instance
2. ✅ Added Prisma errors to retryable errors list
3. ✅ Added Prisma readiness checks in database service
4. ✅ Verified Docker configuration is correct
5. ✅ Verified Docker Compose configuration is correct
6. ✅ Verified package.json configuration is correct

The application should now start successfully in Docker production environments
without "Retry failed" errors.

## Deployment Issue Fix: API Not Recreated on Code Push

### Problem Identified

When code is pushed, the API container was not being recreated because:

1. `docker compose pull` doesn't always pull the latest image if a tag already
   exists locally
2. Docker Compose caches images and may reuse old images even with
   `--force-recreate`
3. The pull operation was "quiet" and might fail silently

### Fix Applied

**File**: `devops/scripts/docker-infra/deploy.sh`

**Changes**:

1. **Tag current image as backup BEFORE pulling new one**: Tags the currently
   running image as `rollback-backup-timestamp` to enable rollback if deployment
   fails
2. **Use `docker pull` directly**: Pulls the API/Worker image directly before
   using docker compose
3. **Add `--pull always` flag**: Ensures `docker compose up` always pulls the
   latest image
4. **Add `--no-deps` flag**: **CRITICAL** - Prevents recreating infrastructure
   dependencies (postgres, dragonfly, openvidu, coturn, etc.)
5. **Explicitly target only api and worker**: All commands explicitly specify
   `api worker` to ensure only these containers are affected
6. **Remove old images AFTER successful deployment**: Only removes old backup
   images after deployment is verified successful
7. **Restore image during rollback**: If deployment fails, restores the previous
   Docker image from backup tag

**Before**:

```bash
docker compose pull --quiet api worker
docker compose up -d --force-recreate api worker
```

**After**:

```bash
# CRITICAL: Tag current running image as backup BEFORE pulling new one
# This enables rollback if new deployment fails
current_image=$(docker inspect --format='{{.Config.Image}}' latest-api)
docker tag "$current_image" "${image_name_base}:rollback-backup-$(date +%Y%m%d-%H%M%S)"
export OLD_IMAGE_BACKUP_TAG="${image_name_base}:rollback-backup-..."

# Pull directly with docker pull (ONLY api/worker image)
docker pull "${DOCKER_IMAGE}"

# Pull via docker compose (ONLY api and worker)
docker compose pull api worker

# Start with --pull always and --no-deps to ensure latest image
# --no-deps is CRITICAL: prevents recreating infrastructure containers (postgres, dragonfly, etc.)
docker compose up -d --pull always --force-recreate --no-deps api worker

# AFTER successful deployment: Remove old backup images (keep most recent)
# If deployment fails, rollback function will restore from OLD_IMAGE_BACKUP_TAG
```

### Expected Behavior

- ✅ Current running image is tagged as backup BEFORE pulling new one (enables
  rollback)
- ✅ Latest API/Worker image is always pulled from registry
- ✅ Only API and Worker containers are recreated (postgres, dragonfly,
  openvidu, coturn remain untouched)
- ✅ API and Worker containers are recreated on every code push
- ✅ Infrastructure containers (postgres, dragonfly, etc.) are NOT recreated
- ✅ Old backup images are removed AFTER successful deployment (keeps most
  recent backup)
- ✅ If deployment fails, rollback restores both Docker image AND database from
  backup

### Verification

After pushing code:

1. Check GitHub Actions workflow - `docker-build` job should complete
2. Check `deploy` job logs - should show "Removing old images" and "Pulling
   latest images"
3. Check server logs - API container should be recreated with new creation
   timestamp
4. Verify new code is running - check API response or logs for new changes
