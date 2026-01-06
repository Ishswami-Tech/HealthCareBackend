# Prisma Complete Guide

Complete guide for Prisma Client generation, management, and Docker
configuration.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Developer Workflow](#developer-workflow)
4. [Docker Configuration](#docker-configuration)
5. [Safety Mechanisms](#safety-mechanisms)
6. [Troubleshooting](#troubleshooting)
7. [Best Practices](#best-practices)

---

## Overview

This document explains how Prisma Client generated files are managed in this
project to prevent merge conflicts and stale files across all environments
(development, Docker, CI/CD).

### Key Principles

- **Hybrid Approach**: Committed generated files + multiple safety nets
- **Build-time Generation**: Always ensures files are fresh
- **Runtime Safety Net**: Docker entrypoint regenerates if needed
- **Multiple Path Resolution**: Application code checks multiple locations

---

## Architecture

We use a **hybrid approach** that combines:

- **Committed generated files** (for faster startup, no runtime dependencies)
- **Multiple safety nets** (pre-commit hooks, CI validation, post-merge hooks)
- **Build-time regeneration** (always ensures files are fresh)
- **Docker runtime generation** (safety net for containerized environments)

---

## Developer Workflow

### 1. Edit Prisma Schema

```bash
# Edit src/libs/infrastructure/database/prisma/schema.prisma
```

### 2. Commit Changes

```bash
git add schema.prisma
git commit -m "Update schema"
```

**What happens automatically:**

- Pre-commit hook detects schema changes
- Automatically runs `prisma generate`
- Validates generated files are correct
- Stages generated files for commit
- Blocks commit if validation fails

### 3. Push to GitHub

```bash
git push
```

---

## CI/CD Workflow

### 1. Checkout Code

- GitHub Actions checks out repository

### 2. Validate Generated Files

- Runs `yarn prisma:validate-generated`
- Compares generated files with committed files
- **FAILS** if files are stale (catches missed cases)

### 3. Build Docker Image

- Runs `prisma generate` again during build (safety net)
- Overwrites any stale committed files
- Ensures production always has fresh files

### 4. Deploy

- Uses committed files (already in Docker image)
- No runtime generation needed
- Faster startup

---

## Docker Configuration

### ✅ Configuration Status

All Docker configurations are properly set up for Prisma Client management.

### Dockerfile Configuration

**Build Stage:**

- ✅ Line 31: Runs `yarn prisma:generate` during build
- ✅ Line 36-76: Verifies Prisma Client generation
- ✅ Line 81-86: Creates symlink for TypeScript resolution
- ✅ Line 94-117: Copies generated files to standard location
- ✅ Line 172-173: Copies generated client to `dist/` for runtime

**Production Stage:**

- ✅ Line 235-238: Copies Prisma schema, config, and generated client
- ✅ Line 243-293: Creates inline entrypoint script with Prisma generation
- ✅ Line 258: Entrypoint runs `prisma generate` at runtime
- ✅ Line 273-285: Entrypoint ensures symlink points to standard location
- ✅ Line 297-339: Build-time symlink creation (entrypoint will update at
  runtime)

### Docker Compose Configuration

**Production (`docker-compose.prod.yml`):**

- ✅ Line 278: `PRISMA_SCHEMA_PATH` set correctly
- ✅ Line 397: Worker service also has `PRISMA_SCHEMA_PATH` set

**Local-Prod (`docker-compose.local-prod.yml`):**

- ✅ Line 273: `PRISMA_SCHEMA_PATH` set correctly
- ✅ Line 385: Worker service also has `PRISMA_SCHEMA_PATH` set
- ✅ Line 237-240: Builds locally using Dockerfile

### Prisma Client Generation Flow

#### Build Time

1. **Dockerfile line 31**: `yarn prisma:generate`
   - Generates Prisma Client in custom location
     (`src/libs/.../generated/client`)
   - Also generates JavaScript files in standard location
     (`node_modules/.prisma/client`)

2. **Dockerfile line 94-117**: Copy to standard location
   - Copies generated files to `node_modules/.prisma/client`

3. **Dockerfile line 172-173**: Copy to dist
   - Copies generated client to `dist/libs/.../generated/client` for runtime

#### Runtime (Container Startup)

1. **Entrypoint script (line 258)**: Runs `prisma generate`
   - Ensures Prisma Client is available
   - Generates JavaScript files in standard location

2. **Entrypoint script (line 273-285)**: Updates symlink
   - Checks if symlink points to standard location
   - Updates if needed to point to `node_modules/.prisma/client`

3. **Application code**: Multiple path checks
   - Checks `dist/libs/.../generated/client` (production)
   - Checks `src/libs/.../generated/client` (development)
   - Checks relative path `./generated/client`
   - Falls back to `@prisma/client` (via symlink)

### How It Works

1. **Build Stage**:
   - Generates Prisma Client (TypeScript in custom location, JavaScript in
     standard location)
   - Copies to `dist/` for runtime
   - Creates initial symlink (entrypoint will update)

2. **Runtime Stage**:
   - Entrypoint runs `prisma generate` (ensures fresh files)
   - Updates symlink to point to standard location (has JavaScript files)
   - Application code finds Prisma Client via multiple paths

3. **Result**:
   - ✅ Always has fresh Prisma Client
   - ✅ Multiple fallback paths
   - ✅ Works in all scenarios (build-time, runtime, committed files)

### Testing Docker Configuration

To verify Prisma configuration works:

```bash
# Build Docker image
docker build -f devops/docker/Dockerfile -t healthcare-api:test .

# Run container
docker run --rm healthcare-api:test sh -c "ls -la /app/node_modules/@prisma/client && ls -la /app/src/libs/infrastructure/database/prisma/generated/client"

# Check symlink
docker run --rm healthcare-api:test sh -c "readlink /app/node_modules/@prisma/client"
# Should output: /app/node_modules/.prisma/client
```

---

## Safety Mechanisms

### 1. Pre-Commit Hook (Primary Defense)

**Location**: `.husky/pre-commit`

**What it does**:

- Detects changes to `schema.prisma` or `prisma.config.js`
- Automatically runs `prisma generate`
- Validates generated files
- Stages generated files for commit
- Blocks commit if validation fails

**How to bypass** (not recommended):

```bash
git commit --no-verify
```

### 2. Post-Merge Hook (Conflict Prevention)

**Location**: `.husky/post-merge`

**What it does**:

- Runs after `git merge` or `git pull`
- Detects if schema files changed during merge
- Automatically regenerates Prisma Client
- Prevents merge conflicts from lingering

### 3. CI Validation (Secondary Defense)

**Location**: `.github/workflows/ci.yml` (lint job)

**What it does**:

- Runs `yarn prisma:validate-generated` in CI
- Compares generated files with committed files
- **FAILS the build** if files are stale
- Forces developers to regenerate and commit

**Error message**:

```
❌ Prisma generated files are stale or invalid
💡 Regenerating Prisma Client...
⚠️  Generated files were updated. Please commit the changes.
```

### 4. Build Script Integration (Safety Net)

**Location**: `scripts/build.js`

**What it does**:

- Validates Prisma generated files before build
- Regenerates if validation fails
- Ensures build always has fresh files

### 5. Git Attributes (Merge Strategy)

**Location**: `.gitattributes`

**What it does**:

- Marks generated files as "generated"
- Uses `merge=ours` strategy (always use our version)
- Prevents merge conflicts on generated files

### 6. Docker Entrypoint (Runtime Safety Net)

**Location**: `devops/docker/Dockerfile` (entrypoint script)

**What it does**:

- Runs `prisma generate` at container startup
- Ensures Prisma Client is available even if build-time generation failed
- Updates symlinks to point to correct location
- Creates `package.json` for Node.js module resolution

---

## Scripts

### Available Commands

```bash
# Generate Prisma Client (standard)
yarn prisma:generate

# Regenerate and validate
yarn prisma:regenerate

# Validate generated files only
yarn prisma:validate-generated
```

### Manual Validation

If you need to manually validate:

```bash
# Check if files are up-to-date
node scripts/validate-prisma-generated.js

# Regenerate if stale
node scripts/validate-prisma-generated.js --regenerate

# Skip comparison with committed files
node scripts/validate-prisma-generated.js --skip-comparison
```

---

## Troubleshooting

### Issue: Pre-commit hook fails

**Error**: `Prisma generated files validation failed!`

**Solution**:

```bash
# Regenerate Prisma Client
yarn prisma:regenerate

# Stage the updated files
git add src/libs/infrastructure/database/prisma/generated/

# Commit again
git commit
```

### Issue: CI fails with stale files

**Error**: `Prisma generated files are stale or invalid`

**Solution**:

1. Pull latest changes
2. Run `yarn prisma:regenerate`
3. Commit the updated generated files
4. Push again

### Issue: Merge conflicts on generated files

**Solution**:

1. The post-merge hook should handle this automatically
2. If not, run manually:
   ```bash
   yarn prisma:regenerate
   git add src/libs/infrastructure/database/prisma/generated/
   git commit -m "Regenerate Prisma Client after merge"
   ```

### Issue: Generated files are missing

**Solution**:

```bash
# Regenerate
yarn prisma:regenerate

# Verify files exist
ls -la src/libs/infrastructure/database/prisma/generated/client/
```

### Issue: Docker container can't find Prisma Client

**Error**: `PrismaClient not found in any expected location`

**Solution**:

1. Check entrypoint script ran: `docker logs <container> | grep prisma`
2. Verify symlink exists:
   `docker exec <container> readlink /app/node_modules/@prisma/client`
3. Check files exist:
   `docker exec <container> ls -la /app/node_modules/.prisma/client/`
4. Rebuild image if needed: `docker compose build --no-cache`

### Issue: Docker build fails during Prisma generation

**Solution**:

1. Check Dockerfile has correct Prisma schema path
2. Verify `PRISMA_SCHEMA_PATH` is set in docker-compose files
3. Check build logs for specific Prisma errors
4. Ensure database is accessible if migrations are needed

---

## Best Practices

1. **Always commit generated files** - They're part of the repository
2. **Don't edit generated files manually** - They'll be overwritten
3. **Run validation before pushing** - Catch issues early
4. **Let hooks do the work** - Don't bypass pre-commit hooks
5. **Check CI logs** - If validation fails, fix it immediately
6. **Test Docker builds** - Verify Prisma generation works in containers
7. **Monitor Docker logs** - Check entrypoint script execution

---

## File Locations

- **Schema**: `src/libs/infrastructure/database/prisma/schema.prisma`
- **Config**: `src/libs/infrastructure/database/prisma/prisma.config.js`
- **Generated Client**:
  `src/libs/infrastructure/database/prisma/generated/client/`
- **Validation Script**: `scripts/validate-prisma-generated.js`
- **Pre-commit Hook**: `.husky/pre-commit`
- **Post-merge Hook**: `.husky/post-merge`
- **Dockerfile**: `devops/docker/Dockerfile`
- **Docker Compose**: `devops/docker/docker-compose.prod.yml`,
  `devops/docker/docker-compose.local-prod.yml`

---

## How It Prevents Issues

### Merge Conflicts

- **Git attributes** mark files as generated (merge strategy)
- **Post-merge hook** regenerates after merge
- **Pre-commit hook** ensures files are fresh before commit

### Stale Files

- **Pre-commit hook** regenerates before every commit
- **CI validation** catches any missed cases
- **Build script** regenerates as safety net
- **Docker entrypoint** regenerates at runtime
- **Schema hash tracking** detects schema changes

---

## Summary

This system ensures:

- ✅ Generated files are always up-to-date
- ✅ No merge conflicts on generated files
- ✅ Fast startup (no runtime generation needed in most cases)
- ✅ Multiple safety nets (pre-commit, CI, build script, Docker entrypoint)
- ✅ Clear error messages
- ✅ Automated workflow
- ✅ Works in all environments (development, Docker, CI/CD)

If you encounter any issues, check the troubleshooting section or run
`yarn prisma:regenerate` manually.

---

## Related Documentation

- [Environment Variables](./ENVIRONMENT_VARIABLES.md) - Prisma-related
  environment variables
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Docker deployment setup
- [Developer Guide](./DEVELOPER_GUIDE.md) - General development practices

---

**Last Updated**: January 2025  
**Maintained By**: Healthcare Backend Team
