# Root Cause Analysis - Deployment Issues

## 🔍 Issue Summary

We're experiencing multiple interconnected issues during deployment:

1. **Portainer Container Restart Loop**
2. **"Text file busy" Error**
3. **API Database Authentication Failure**
4. **Worker Container Not Created**

---

## 📋 Detailed Analysis

### 1. Portainer Restart Loop

**Error**: `portainer: error: expected NAME=VALUE got '*'`

**Root Cause**:

- The docker-compose file was fixed (removed `--hide-label=*` flag)
- BUT the container is still running with the OLD configuration
- Docker doesn't automatically update running containers when compose files
  change
- The container needs to be **force-recreated** to pick up the new command

**Why It's Not Being Fixed**:

- `container_running()` function uses `docker ps` which shows containers in
  "running" OR "restarting" state
- A restarting container passes the "running" check, so it's not detected as
  needing recreation
- We added a check for "restarting" status, but the recreation logic might not
  be triggering

**Solution**:

- Force stop and remove Portainer container before health check
- Or ensure the health check properly detects restarting containers and triggers
  recreation

---

### 2. "Text file busy" Error

**Error**: `/bin/bash: bad interpreter: Text file busy`

**Root Cause**:

- **Race condition**: Script is being executed while SCP is still writing it
- Even with `sync` and `sleep`, if SCP hasn't fully closed the file handle,
  execution fails
- Linux kernel locks the file when it's being written, preventing execution

**Why It's Not Being Fixed**:

- `sync` only flushes buffers to disk, but doesn't guarantee the file handle is
  closed
- `sleep 1` might not be enough if the network is slow or the file is large
- SCP might still have the file open when we try to execute

**Solution**:

- Copy to a temporary location first (`/tmp/health-check.sh.tmp`)
- Move it to final location (`mv /tmp/health-check.sh.tmp /tmp/health-check.sh`)
- This ensures the file is fully written and closed before execution
- OR: Copy in a separate step, wait for SCP to complete, then execute

---

### 3. API Database Authentication Failure

**Error**:
`P1000: Authentication failed against database server, the provided database credentials for 'postgres' are not valid`

**Root Cause**:

- The API container's `DATABASE_URL` doesn't match the actual database password
- Possible causes:
  1. `.env.production` file has wrong `DATABASE_URL`
  2. Container is using cached environment variables
  3. Database password was changed but `.env.production` wasn't updated
  4. The `DATABASE_URL` format is incorrect

**Why It's Not Being Fixed**:

- We're passing `DATABASE_URL` to Prisma commands, but the container might have
  a different value
- The container reads from `.env.production` file, which might have wrong
  credentials
- We need to verify what `DATABASE_URL` the container actually has

**Solution**:

- Verify `.env.production` has correct `DATABASE_URL`
- Check what `DATABASE_URL` the container actually sees
- Ensure database password matches between:
  - `.env.production` file
  - Docker compose environment variables
  - Actual PostgreSQL container

---

### 4. Worker Container Not Created

**Error**: `Container latest-worker does not exist (never created)`

**Root Cause**:

- The `deploy_application` function tries to start `api` and `worker`
- But `worker` container is never created
- Possible causes:
  1. Worker image doesn't exist in GHCR
  2. `docker compose up` fails silently for worker
  3. Worker service has a dependency that's not met
  4. Worker service is not in the `app` profile

**Why It's Not Being Fixed**:

- The deploy script doesn't check if worker image exists before trying to start
  it
- If `docker compose up` fails for worker, it might not be logged
- We need to verify worker service configuration and image availability

**Solution**:

- Check if worker image exists in GHCR
- Verify worker service is in the correct profile
- Add explicit error checking for worker container creation
- Check worker service dependencies

---

## 🔧 Comprehensive Fix Strategy

### Fix 1: Portainer Force Recreation

1. Add explicit Portainer recreation step before health checks
2. Stop and remove Portainer container if it's restarting
3. Recreate with `--force-recreate` flag

### Fix 2: "Text file busy" - Better File Copy Strategy

1. Copy to temporary file first: `/tmp/health-check.sh.tmp`
2. Wait for SCP to complete
3. Move to final location: `mv /tmp/health-check.sh.tmp /tmp/health-check.sh`
4. Then execute

### Fix 3: Database Authentication

1. Add verification step to check `DATABASE_URL` in container
2. Compare with expected value
3. Log actual `DATABASE_URL` for debugging
4. Verify database password matches

### Fix 4: Worker Container

1. Check if worker image exists before deployment
2. Add explicit error checking for worker creation
3. Verify worker service configuration
4. Check worker logs if creation fails

---

## 🎯 Priority Order

1. **HIGH**: Fix "Text file busy" error (blocks all health checks)
2. **HIGH**: Fix Portainer restart loop (causes infrastructure to be marked
   unhealthy)
3. **MEDIUM**: Fix database authentication (blocks API from starting)
4. **MEDIUM**: Fix worker container creation (non-critical but should work)

---

## 📝 Next Steps

1. Implement better file copy strategy (temp file + move)
2. Add explicit Portainer recreation step
3. Add database credential verification
4. Add worker container creation verification
