# Deployment Verification

Deep verification procedures, acceptance criteria, and edge-case testing for the
healthcare-backend deployment pipeline.

> **Critical principle**: Only API and Worker containers are deployed/recreated.
> Postgres, Dragonfly, and Nginx are untouched for app-only deploys. Preprod
> uses `userdb_preprod` in the same PostgreSQL instance.

---

## Table of Contents

1. [Verification Levels](#1-verification-levels)
2. [Automated CI Verification](#2-automated-ci-verification)
3. [Full Manual Verification](#3-full-manual-verification)
4. [Infrastructure Verification](#4-infrastructure-verification)
5. [Application Verification](#5-application-verification)
6. [Environment Isolation Verification](#6-environment-isolation-verification)
7. [Database Verification](#7-database-verification)
8. [Cache Verification](#8-cache-verification)
9. [Network and Ingress Verification](#9-network-and-ingress-verification)
10. [Rollback Verification](#10-rollback-verification)
11. [Edge Case Scenarios](#11-edge-case-scenarios)
12. [Load Testing](#12-load-testing)
13. [Performance Baseline](#13-performance-baseline)
14. [Security Verification](#14-security-verification)

---

## 1. Verification Levels

| Level               | When                               | Depth                      | Time   |
| ------------------- | ---------------------------------- | -------------------------- | ------ |
| **L0: CI Smoke**    | Every deploy (automated)           | Public endpoint 200 check  | 30s    |
| **L1: Quick Check** | After CI passes, manual spot-check | Containers + health + logs | 2 min  |
| **L2: Full Verify** | First deploy of day, major release | All sections below         | 15 min |
| **L3: Deep Verify** | After infra changes, weekly        | L2 + edge cases + load     | 45 min |

---

## 2. Automated CI Verification

### Pipeline: `post-deployment-verification` job

```yaml
# From .github/workflows/ci.yml
- name: Verify deployment
  run: |
    URL="https://${API_SUBDOMAIN}/health"
    for i in $(seq 1 3); do
      if curl -sf -H "Host: ${API_SUBDOMAIN}" "$URL" | jq -e '.status' >/dev/null 2>&1; then
        echo "Deployment verified: $URL is healthy"
        exit 0
      fi
      echo "Attempt $i/3 failed, retrying in 10s..."
      sleep 10
    done
    echo "Deployment verification FAILED"
    exit 1
```

### Acceptance Criteria

| Criterion     | Pass                      | Fail                 |
| ------------- | ------------------------- | -------------------- |
| HTTP status   | 200                       | Any non-200          |
| Response body | Contains `"status"` field | Missing or malformed |
| Response time | <10s per attempt          | Timeout              |
| Retries       | ≤3 attempts               | All 3 fail           |

### What CI Does NOT Verify

- Database connectivity (only checks app is responding)
- Worker health (only checks API endpoint)
- Dragonfly/cache connectivity
- Data integrity
- Correct environment variables
- Correct image version
- Nginx config validity

**These must be verified manually for L1+ checks.**

---

## 3. Full Manual Verification

### 3.1 Production Verification

```bash
PROD_HOST="<your-host>"

echo "=== PRODUCTION FULL VERIFICATION ==="

# Step 1: Infrastructure
echo "[1/8] Infrastructure health..."
ssh $PROD_HOST 'bash /opt/healthcare-backend/devops/scripts/docker-infra/health-check.sh'

# Step 2: Container status
echo "[2/8] Container status..."
ssh $PROD_HOST 'docker ps --filter "name=latest-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'
ssh $PROD_HOST 'docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}"'
ssh $PROD_HOST 'docker ps --filter "name=dragonfly" --format "table {{.Names}}\t{{.Status}}"'

# Step 3: Image verification
echo "[3/8] Running image..."
ssh $PROD_HOST 'docker inspect latest-api --format "Image: {{.Config.Image}}\nID: {{.Image}}\nCreated: {{.Created}}"'

# Step 4: Health endpoints
echo "[4/8] Health endpoints..."
curl -s https://backend-service-v1.ishswami.in/health | jq .
curl -s https://backend-service-v1.ishswami.in/infra-health | jq .

# Step 5: Nginx upstream
echo "[5/8] Nginx upstream..."
ssh $PROD_HOST 'cat /opt/healthcare-backend/nginx/upstream.conf'

# Step 6: Logs (last 50 lines, check for errors)
echo "[6/8] API logs..."
ssh $PROD_HOST 'docker logs --tail 50 latest-api 2>&1 | grep -iE "error|fatal|unhandled|ECONNREFUSED|timeout" || echo "No errors found"'
echo "[6/8] Worker logs..."
ssh $PROD_HOST 'docker logs --tail 50 latest-worker 2>&1 | grep -iE "error|fatal|unhandled" || echo "No errors found"'

# Step 7: Database connectivity
echo "[7/8] Database..."
ssh $PROD_HOST 'docker exec latest-api sh -c "nc -z postgres 5432 && echo DB_OK || echo DB_FAIL"'

# Step 8: Disk space
echo "[8/8] Disk space..."
ssh $PROD_HOST 'df -h /opt/healthcare-backend'
```

### 3.2 Preprod Verification

```bash
PREPROD_HOST="<same-host>"  # Same VPS, different directory

echo "=== PREPROD FULL VERIFICATION ==="

# Step 1: Infrastructure
echo "[1/8] Infrastructure health..."
ssh $PREPROD_HOST 'bash /opt/healthcare-preprod/devops/scripts/docker-infra/health-check.sh'

# Step 2: Container status
echo "[2/8] Container status..."
ssh $PREPROD_HOST 'docker ps --filter "name=preprod-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'

# Step 3: Image verification
echo "[3/8] Running image..."
ssh $PREPROD_HOST 'docker inspect preprod-api --format "Image: {{.Config.Image}}\nID: {{.Image}}\nCreated: {{.Created}}"'

# Step 4: Health endpoints
echo "[4/8] Health endpoints..."
curl -s https://preprod-backend.ishswami.in/health | jq .
curl -s https://preprod-backend.ishswami.in/infra-health | jq .

# Step 5: Database verification
echo "[5/8] Database..."
ssh $PREPROD_HOST 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT 1"'
ssh $PREPROD_HOST 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_type = '\''BASE TABLE'\'';"'
ssh $PREPROD_HOST 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"'

# Step 6: Environment variables
echo "[6/8] Environment variables..."
ssh $PREPROD_HOST 'docker exec preprod-api sh -c "echo DATABASE_URL=\${DATABASE_URL:-NOT SET}" | grep -o "userdb_preprod"'
ssh $PREPROD_HOST 'docker exec preprod-api sh -c "echo NODE_ENV=\${NODE_ENV:-NOT SET}"'
ssh $PREPROD_HOST 'docker exec preprod-worker sh -c "echo DRAGONFLY_KEY_PREFIX=\${DRAGONFLY_KEY_PREFIX:-NOT SET}"'

# Step 7: Logs
echo "[7/8] Logs..."
ssh $PREPROD_HOST 'docker logs --tail 50 preprod-api 2>&1 | grep -iE "error|fatal" || echo "No errors"'
ssh $PREPROD_HOST 'docker logs --tail 50 preprod-worker 2>&1 | grep -iE "error|fatal" || echo "No errors"'

# Step 8: Nginx
echo "[8/8] Nginx..."
ssh $PREPROD_HOST 'docker exec preprod-nginx nginx -t'
```

### Acceptance Criteria

| Check                  | Expected                                               | Notes                               |
| ---------------------- | ------------------------------------------------------ | ----------------------------------- | --------------------- |
| `/health`              | 200, `"status":"healthy"`                              | All services green                  |
| `/infra-health`        | 200, all services healthy                              | DB + cache reachable                |
| API container          | `running`                                              | `preprod-api` or `latest-api`       |
| Worker container       | `running`                                              | `preprod-worker` or `latest-worker` |
| Image SHA              | Matches deployed SHA                                   | No old image                        |
| DB connectivity        | `SELECT 1` → `?column?                                 | 1`                                  | FROM inside container |
| Table count            | >0 (unless fresh DB)                                   | Tables created by Prisma            |
| Migrations             | Latest migration marked `applied`                      | No failed migrations                |
| `DATABASE_URL`         | Contains `userdb_preprod` (preprod) or `userdb` (prod) | NOT localhost                       |
| `DRAGONFLY_KEY_PREFIX` | `healthcare-preprod:` (preprod) / `healthcare:` (prod) | No collision                        |
| `NODE_ENV`             | `production`                                           | Both environments                   |
| Nginx config           | `nginx -t` → OK                                        | Valid config                        |
| No error logs          | 0 errors in last 50 lines                              | Check API + Worker                  |

---

## 4. Infrastructure Verification

### Postgres

```bash
# Connectivity from host
docker exec preprod-postgres pg_isready -U postgres -d userdb_preprod
# Expected: userdb_pregres-postgres:5432 - accepting connections

# Connectivity from API container
docker exec preprod-api sh -c 'nc -z preprod-postgres 5432 && echo OK'
# Expected: OK

# Connection limits
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c "SHOW max_connections;"
# Preprod: 80

# Active connections
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = 'userdb_preprod';"

# Database size
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT pg_size_pretty(pg_database_size('userdb_preprod'));"

# Table count
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"

# Verify production DB untouched (if deploying preprod)
docker exec preprod-postgres psql -U postgres -d userdb -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
# Expected: same count as before (not affected by preprod operations)
```

### Dragonfly

```bash
# Ping
docker exec preprod-dragonfly redis-cli -p 6379 ping
# Expected: PONG

# Memory usage
docker exec preprod-dragonfly redis-cli -p 6379 INFO memory | grep used_memory_human

# Connected clients
docker exec preprod-dragonfly redis-cli -p 6379 INFO clients | grep connected_clients

# Key count (preprod keys only)
docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare-preprod:*" | wc -l

# Verify production keys not mixed in
docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare:*" | wc -l
# Expected: 0 (production prefix shouldn't exist in preprod dragonfly)

# Persistence
docker exec preprod-dragonfly redis-cli -p 6379 INFO persistence | grep rdb_last_save
```

### Docker Health Checks

```bash
# Verify Docker-level health status
docker inspect preprod-postgres --format "{{.State.Health.Status}}"
# Expected: healthy

docker inspect preprod-dragonfly --format "{{.State.Health.Status}}"
# Expected: healthy

docker inspect preprod-nginx --format "{{.State.Health.Status}}"
# Expected: healthy

docker inspect preprod-api --format "{{.State.Health.Status}}"
# Expected: healthy (may be starting → wait)

docker inspect preprod-worker --format "{{.State.Health.Status}}"
# Expected: healthy
```

---

## 5. Application Verification

### API Endpoints

```bash
BASE="https://preprod-backend.ishswami.in"

# Health (full)
curl -sf "$BASE/health" | jq .
# Expected: {"status":"healthy","services":{"database":"up","cache":"up",...}}

# Infra health (deployment gate)
curl -sf "$BASE/infra-health" | jq .
# Expected: {"status":"healthy",...}

# Detailed health
curl -sf "$BASE/health?detailed=true" | jq .
# Expected: includes processInfo, memory, CPU

# Queue dashboard accessible
curl -sf "$BASE/queue-dashboard" | head -5
# Expected: HTML response

# Nginx self-check
curl -sf "http://localhost:8089/nginx-health"
# Expected: nginx-ok
```

### Worker Health

```bash
# Worker healthcheck (from host)
docker exec preprod-worker node dist/worker-bootstrap.js --healthcheck
# Expected: "Worker health check passed" (exit 0)

# Worker logs
docker logs --tail 20 preprod-worker 2>&1
# Expected: No errors, cron jobs starting
```

### Queue Processing

```bash
# Check Bull Board dashboard
curl -s "$BASE/queue-dashboard/api/queues" | jq .

# Expected: array of queues with job counts
# - default queue should exist
# - job counts should be reasonable
```

---

## 6. Environment Isolation Verification

These checks prevent cross-environment data leakage.

### Network Isolation

```bash
# Verify separate Docker networks
docker network ls | grep -E "app-network|preprod-network"
# Expected: both networks exist

# Verify preprod-api is ONLY on preprod-network (and coolify)
docker inspect preprod-api --format '{{range $n, $v := .NetworkSettings.Networks}}{{$n}} {{end}}'
# Expected: "preprod-network coolify"

# Verify latest-api is ONLY on app-network (and coolify)
docker inspect latest-api --format '{{range $n, $v := .NetworkSettings.Networks}}{{$n}} {{end}}'
# Expected: "app-network coolify"

# Verify preprod-api CANNOT reach production containers
docker exec preprod-api sh -c 'nc -z latest-postgres 5432 2>&1' || echo "BLOCKED (correct)"
# Expected: BLOCKED or timeout (different network)

# Verify preprod-api CAN reach preprod-postgres
docker exec preprod-api sh -c 'nc -z preprod-postgres 5432 && echo OK'
# Expected: OK
```

### Database Isolation

```bash
# Production DB name
docker exec postgres psql -U postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '%userdb%';"
# Expected: userdb (and possibly template databases)

# Preprod DB name (from SAME postgres container)
docker exec postgres psql -U postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '%userdb%';"
# Expected: userdb, userdb_preprod (both visible from same server)

# Verify preprod DB has separate data
docker exec postgres psql -U postgres -d userdb_preprod -c "SELECT count(*) FROM users;" 2>/dev/null
docker exec postgres psql -U postgres -d userdb -c "SELECT count(*) FROM users;" 2>/dev/null
# Expected: Different counts (or preprod is 0 if fresh)
# CRITICAL: userdb_preprod COUNT should NOT equal userdb COUNT
```

### Cache Isolation

```bash
# Production Dragonfly keys (from production dragonfly)
docker exec dragonfly redis-cli -p 6379 --scan --pattern "healthcare:*" | head -5
# Expected: keys with "healthcare:" prefix

# Preprod Dragonfly keys (from preprod dragonfly)
docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare:*" | head -5
# Expected: NO keys with "healthcare:" prefix (that's production)

# Preprod keys
docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare-preprod:*" | head -5
# Expected: keys with "healthcare-preprod:" prefix

# Verify NO key collision
docker exec preprod-dragonfly redis-cli -p 6379 DBSIZE
docker exec dragonfly redis-cli -p 6379 DBSIZE
# Expected: Different counts
```

### Environment Variable Verification

```bash
# Preprod API
echo "=== preprod-api ==="
docker exec preprod-api sh -c 'echo "DATABASE_URL=${DATABASE_URL}"' | grep -o "userdb_preprod\|userdb"
# Expected: userdb_preprod

docker exec preprod-api sh -c 'echo "NODE_ENV=${NODE_ENV}"'
# Expected: production

docker exec preprod-api sh -c 'echo "CACHE_PREFIX=${CACHE_PREFIX}"'
# Expected: healthcare-preprod:

docker exec preprod-api sh -c 'echo "DRAGONFLY_HOST=${DRAGONFLY_HOST}"'
# Expected: preprod-dragonfly

# Preprod Worker
echo "=== preprod-worker ==="
docker exec preprod-worker sh -c 'echo "DRAGONFLY_KEY_PREFIX=${DRAGONFLY_KEY_PREFIX}"'
# Expected: healthcare-preprod:

docker exec preprod-worker sh -c 'echo "PORT=${PORT}"'
# Expected: 8080 (internal) — externally exposed on 9091

# Production API (for comparison)
echo "=== latest-api ==="
docker exec latest-api sh -c 'echo "DATABASE_URL=${DATABASE_URL}"' | grep -o "userdb_preprod\|userdb"
# Expected: userdb

docker exec latest-api sh -c 'echo "DRAGONFLY_HOST=${DRAGONFLY_HOST}"'
# Expected: dragonfly (not preprod-dragonfly)
```

---

## 7. Database Verification

### Schema Verification

```bash
# List all tables (preprod)
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c "\dt"

# Verify expected tables exist
docker exec preprod-postgres psql -U postgres -d userdb_preprod -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
# Expected: >0 (unless intentionally fresh)

# Verify Prisma migration history
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 10;"
# Expected: All latest migrations have finished_at set, rolled_back_at is NULL
```

### Data Integrity

```bash
# Row counts in key tables
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;"

# Check for orphaned records (example)
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT count(*) FROM users u LEFT JOIN clinics c ON u.clinic_id = c.id WHERE c.id IS NULL AND u.clinic_id IS NOT NULL;"
# Expected: 0 (no orphans)

# Check sequences are in sync
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public';"
```

### Migration Verification

```bash
# Check all migrations applied
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY migration_name;"
# Expected: All rows show "t" (true) for applied

# Check no pending migrations
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;"
# Expected: 0
```

---

## 8. Cache Verification

### Dragonfly Connectivity

```bash
# Ping
docker exec preprod-api sh -c 'echo PING | nc preprod-dragonfly 6379'
# Expected: +PONG

# Set/Get test (from API container perspective)
docker exec preprod-api sh -c '
  node -e "
    const redis = require(\"ioredis\");
    const client = new redis({ host: \"preprod-dragonfly\", port: 6379, keyPrefix: \"healthcare-preprod:\" });
    client.set(\"test-key\", \"test-value\", \"EX\", 10).then(() => client.get(\"test-key\")).then(v => { console.log(\"Value:\", v); client.del(\"test-key\"); client.quit(); });
  "
'
# Expected: Value: test-value
```

### Key Prefix Isolation

```bash
# Verify no cross-prefix pollution
docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare:*" 2>/dev/null
# Expected: empty (production prefix shouldn't exist in preprod dragonfly)

docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare-preprod:*" 2>/dev/null | head -5
# Expected: actual preprod keys

# Same for production
docker exec dragonfly redis-cli -p 6379 --scan --pattern "healthcare-preprod:*" 2>/dev/null
# Expected: empty
```

### Cache TTL Verification

```bash
# Check that cache entries have reasonable TTL
docker exec preprod-dragonfly redis-cli -p 6379 --scan --pattern "healthcare-preprod:*" 2>/dev/null | head -3 | while read key; do
  docker exec preprod-dragonfly redis-cli -p 6379 TTL "$key"
done
# Expected: Positive TTL values (not -1 = no expiry for session keys, or -2 = expired)
```

---

## 9. Network and Ingress Verification

### DNS Resolution

```bash
# Production
dig +short backend-service-v1.ishswami.in
# Expected: VPS IP address

# Preprod
dig +short preprod-backend.ishswami.in
# Expected: Same VPS IP address
```

### HTTPS/TLS

```bash
# Production TLS
echo | openssl s_client -connect backend-service-v1.ishswami.in:443 -servername backend-service-v1.ishswami.in 2>/dev/null | openssl x509 -noout -dates -subject
# Expected: Valid certificate, not expired

# Preprod TLS
echo | openssl s_client -connect preprod-backend.ishswami.in:443 -servername preprod-backend.ishswami.in 2>/dev/null | openssl x509 -noout -dates -subject
# Expected: Valid certificate, not expired
```

### Traefik Routing

```bash
# Verify Traefik sees the routers
docker ps --filter "name=traefik" --format "{{.Names}}"
# Expected: traefik container running

docker logs traefik --tail 30 2>&1 | grep -E "healthcare-api|preprod"
# Expected: Both routers configured

# Verify correct entrypoints
docker logs traefik --tail 50 2>&1 | grep "healthcare-api-preprod"
# Expected: Router for preprod on http,https entrypoints
```

### Nginx Configuration

```bash
# Production nginx
ssh <host> 'docker exec latest-nginx nginx -t'
# Expected: nginx: configuration file /etc/nginx/nginx.conf test is successful

# Preprod nginx
ssh <host> 'docker exec preprod-nginx nginx -t'
# Expected: nginx: configuration file /etc/nginx/nginx.conf test is successful

# Verify upstream.conf is correct
ssh <host> 'cat /opt/healthcare-backend/nginx/upstream.conf'
# Expected: server latest-api:8088 max_fails=3 fail_timeout=10s;

ssh <host> 'cat /opt/healthcare-preprod/nginx/upstream.conf'
# Expected: server preprod-api:8088 max_fails=3 fail_timeout=10s;
```

### Socket.IO (WebSocket)

```bash
# Verify WebSocket upgrade works
curl -s -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://preprod-backend.ishswami.in/socket.io/?EIO=4&transport=websocket" | head -5
# Expected: WebSocket upgrade response (101 Switching Protocols)
```

---

## 10. Rollback Verification

### Production Blue-Green Rollback

```bash
# Before deploy: note active color
ssh <host> 'cat /opt/healthcare-backend/nginx/upstream.conf'
# Expected: server latest-api-blue:8088 ...  OR  server latest-api-green:8088 ...

# Trigger rollback scenario: deploy fails
# Expected: old container still serving, upstream.conf unchanged

# Verify old container still running
ssh <host> 'docker ps --filter "name=latest-api-blue" --format "{{.Names}}\t{{.Status}}"'
# OR
ssh <host> 'docker ps --filter "name=latest-api-green" --format "{{.Names}}\t{{.Status}}"'

# Verify upstream.conf unchanged
ssh <host> 'cat /opt/healthcare-backend/nginx/upstream.conf'
# Expected: Same as before deploy attempt
```

### Preprod Rolling Rollback

```bash
# Before deploy: note image tag
ssh <host> 'docker inspect preprod-api --format "{{.Config.Image}}"'
# Expected: ghcr.io/.../healthcare-api:preprod-abc1234

# Trigger rollback scenario
# Expected: deploy.sh uses rollback_to_backup_image()

# Verify rollback image exists
ssh <host> 'docker images --filter "reference=ghcr.io/ishswami-tech/healthcarebackend/healthcare-api" --format "{{.Repository}}:{{.Tag}}" | grep rollback-backup'
# Expected: rollback-backup-<timestamp> tag exists

# After rollback
ssh <host> 'docker inspect preprod-api --format "{{.Config.Image}}"'
# Expected: Same image as before (or rollback-backup-<timestamp>)
```

---

## 11. Edge Case Scenarios

### 11.1 Deploy with Infra Unhealthy

**Scenario**: Postgres is unhealthy during a preprod app deploy.

**Expected behavior**:

```bash
# deploy.sh checks infrastructure health first
bash devops/scripts/docker-infra/deploy.sh --env preprod
# Should attempt auto-recreation via health-check.sh
# If infra cannot be recovered → deploy FAILS (does not proceed with broken DB)
```

**Verification**:

```bash
# Manually stop postgres
docker stop preprod-postgres

# Attempt deploy — should fail safely
bash devops/scripts/docker-infra/deploy.sh --env preprod
# Expected: Error about infrastructure health, deploy stops

# Restore postgres
docker start preprod-postgres
bash devops/scripts/docker-infra/health-check.sh
# Wait for healthy, then retry deploy
```

### 11.2 Deploy with Disk Full

**Scenario**: VPS has <3 GB free during deploy.

**Expected behavior**: CI `validate-disk-space` step fails before deploy starts.

**Manual test**:

```bash
# Fill disk
dd if=/dev/zero of=/tmp/fill bs=1M count=5000 || true

# Attempt deploy — should fail
bash devops/scripts/docker-infra/deploy.sh --env preprod
# Expected: "Insufficient disk space" error

# Clean up
rm -f /tmp/fill
```

### 11.3 Deploy with Missing Image

**Scenario**: GHCR image not yet propagated.

**Expected behavior**: `retry_docker_pull()` tries 12 times × 10s = 120s, then
falls back to `:latest` tag, then fails.

**Verification**:

```bash
# Set non-existent image
DOCKER_IMAGE="ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:nonexistent-12345" \
  bash devops/scripts/docker-infra/deploy.sh --env preprod
# Expected: Error after retries, fallback to :latest also fails
```

### 11.4 Deploy During Another Deploy (Concurrency)

**Scenario**: Two preprod deploys triggered simultaneously.

**Expected behavior**: CI concurrency group `deploy-preprod` queues the second
deploy. First deploy completes, then second runs.

**Verification**: Check GitHub Actions — second deploy should show "Queued" then
run after first completes.

### 11.5 Worker Starts Before API (Preprod)

**Scenario**: Preprod worker has
`depends_on: preprod-api: condition: service_started`.

**Edge case**: If API crashes during startup, worker still starts (Docker only
checks if container started, not if it's healthy).

**Verification**:

```bash
# Check worker started even if API is unhealthy
docker inspect preprod-worker --format "{{.State.Status}}"
# Expected: running (worker starts regardless of API health)

# Worker should handle API unavailability gracefully
docker logs preprod-worker 2>&1 | grep -i "connection\|error\|retry"
# Expected: Reconnection logs, not crash
```

### 11.6 Preprod DB Already Exists with Data

**Scenario**: `userdb_preprod` already has tables and data.

**Expected behavior**: `deploy.sh` detects it's NOT a fresh deployment, runs
migrations safely (P3009 auto-recovery), does NOT drop database.

**Verification**:

```bash
# Deploy to preprod with existing data
bash devops/scripts/docker-infra/deploy.sh --env preprod

# Verify data preserved
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT count(*) FROM users;"
# Expected: Same or higher count (new seed data may be added)
```

### 11.7 Fresh Preprod Deployment (No DB)

**Scenario**: `userdb_preprod` doesn't exist (first deploy).

**Expected behavior**: Prisma migrations create the database schema from
scratch.

**Verification**:

```bash
# Drop preprod DB
docker exec preprod-postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"

# Deploy
bash devops/scripts/docker-infra/deploy.sh --env preprod

# Verify DB created and migrated
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c "\dt"
# Expected: All tables from Prisma schema
```

### 11.8 Nginx Port Conflict

**Scenario**: Port 8089 already in use on host.

**Expected behavior**: Preprod nginx container fails to start. Deploy should
detect and fail.

**Verification**:

```bash
# Occupy port 8089 on host
nc -l 8089 &
# Deploy should fail or nginx should not bind

# Clean up
kill %1
```

### 11.9 Concurrent DB Access During Restore

**Scenario**: API container tries to write to DB while restore is in progress.

**Expected behavior**: `restore.sh` stops API/Worker containers first, then
drops/recreates database. No concurrent access possible.

**Verification**:

```bash
# Verify containers are stopped before restore
bash devops/scripts/docker-infra/restore.sh latest
# Check: docker ps shows NO preprod-api or preprod-worker during restore
```

### 11.10 Dragonfly Unavailable During Deploy

**Scenario**: Dragonfly is down during API deploy.

**Expected behavior**: Preprod API has
`depends_on: preprod-dragonfly: condition: service_healthy` with
`required: false`. API starts even if Dragonfly is unhealthy.

**Verification**:

```bash
# Stop dragonfly
docker stop preprod-dragonfly

# Deploy API — should succeed (Dragonfly optional)
bash devops/scripts/docker-infra/deploy.sh --env preprod

# API should start with cache disabled
docker logs preprod-api 2>&1 | grep -i "dragonfly\|cache\|redis"
# Expected: Warning about cache unavailable, app continues

# Restore dragonfly
docker start preprod-dragonfly
```

---

## 12. Load Testing

### Basic Smoke Test

```bash
# Production
ab -n 100 -c 10 https://backend-service-v1.ishswami.in/health
# Expected: All 200, avg response <500ms

# Preprod
ab -n 100 -c 10 https://preprod-backend.ishswami.in/health
# Expected: All 200, avg response <500ms
```

### WebSocket Test

```bash
# Simple Socket.IO connection test
node -e "
  const { io } = require('socket.io-client');
  const socket = io('https://preprod-backend.ishswami.in', { transports: ['websocket'] });
  socket.on('connect', () => { console.log('Connected:', socket.id); socket.disconnect(); });
  socket.on('connect_error', (e) => { console.error('Failed:', e.message); process.exit(1); });
  setTimeout(() => { console.error('Timeout'); process.exit(1); }, 10000);
"
# Expected: "Connected: <socket-id>"
```

### Queue Processing Test

```bash
# Enqueue a test job
curl -s -X POST https://preprod-backend.ishswami.in/api/test/queue \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected: 200 or 202 with job ID

# Check queue dashboard
curl -s https://preprod-backend.ishswami.in/queue-dashboard/api/queues
# Expected: Job count >0 briefly, then 0 (processed)
```

---

## 13. Performance Baseline

### Response Times

| Endpoint                | Target | Method                               |
| ----------------------- | ------ | ------------------------------------ |
| `GET /health`           | <200ms | curl -o /dev/null -w "%{time_total}" |
| `GET /infra-health`     | <100ms | curl -o /dev/null -w "%{time_total}" |
| `POST /auth/login`      | <500ms | curl with credentials                |
| `GET /api/appointments` | <300ms | curl with auth header                |

### Resource Usage

```bash
# Container resource usage
docker stats preprod-api preprod-worker preprod-postgres preprod-dragonfly --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
# Expected:
#   preprod-api:       <50% CPU, <1GB RAM
#   preprod-worker:    <20% CPU, <256MB RAM
#   preprod-postgres:  <30% CPU, <512MB RAM
#   preprod-dragonfly: <10% CPU, <256MB RAM
```

### Database Performance

```bash
# Query performance
time docker exec preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT count(*) FROM users;"
# Expected: <100ms for tables with <100K rows

# Connection pool usage
docker exec preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = 'userdb_preprod';"
# Expected: <10 active connections
```

---

## 14. Security Verification

### Environment Variables (No Leaks)

```bash
# Verify no production secrets in preprod
docker exec preprod-api env | grep -iE "SECRET|PASSWORD|KEY" | grep -v "DRAGONFLY_KEY_PREFIX\|QUEUE_DASHBOARD" || echo "No sensitive env vars exposed"

# Verify DATABASE_URL is not localhost
docker exec preprod-api sh -c 'echo "${DATABASE_URL}"' | grep -i "localhost\|127.0.0.1"
# Expected: No matches (should use service hostnames)

# Verify TRUST_PROXY set (behind Traefik)
docker exec preprod-api sh -c 'echo "${TRUST_PROXY}"'
# Expected: 1
```

### Network Access

```bash
# Verify API cannot access host network directly
docker exec preprod-api sh -c 'nc -z host.docker.internal 22 2>&1' || echo "Host blocked (correct)"

# Verify API can only reach expected services
docker exec preprod-api sh -c 'nc -z preprod-postgres 5432 && echo "postgres OK"'
docker exec preprod-api sh -c 'nc -z preprod-dragonfly 6379 && echo "dragonfly OK"'
# Expected: postgres OK, dragonfly OK

# Verify preprod cannot reach production containers
docker exec preprod-api sh -c 'nc -z latest-api 8088 2>&1' || echo "prod blocked (correct)"
# Expected: prod blocked or timeout
```

### Rate Limiting

```bash
# Send rapid requests to test rate limiting
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{http_code}" https://preprod-backend.ishswami.in/health
done
# Expected: Mix of 200s, then 429s if rate limit hit
# Preprod config: SECURITY_RATE_LIMIT_MAX=4000, window=1000ms
```

### TLS Configuration

```bash
# Verify TLS 1.2+
nmap --script ssl-enum-ciphers -p 443 preprod-backend.ishswami.in
# Expected: TLSv1.2 and TLSv1.3 supported, weak ciphers rejected

# Verify HSTS header
curl -sI https://preprod-backend.ishswami.in | grep -i strict-transport-security
# Expected: Strict-Transport-Security header present
```

---

## Verification Sign-Off

After completing the relevant verification level:

```
Environment: _______________  (production / preprod)
Deploy SHA/Tag: _______________
Verification Level: ____  (L0 / L1 / L2 / L3)
Verified by: _______________
Date/Time: _______________

Checks passed: ____ / ____
Issues found: _______________
Rollback needed: ____ (yes / no)

Sign-off: _______________
```

---

## Quick Reference: One-Shot Verification

```bash
# L1 Quick check — preprod
ssh <host> bash -c '
  set -e
  echo "=== PREPROD L1 VERIFICATION ==="
  echo "[1] Infra:"
  bash /opt/healthcare-preprod/devops/scripts/docker-infra/health-check.sh
  echo "[2] Containers:"
  docker ps --filter "name=preprod-" --format "{{.Names}}: {{.Status}}" | while read line; do
    echo "  $line"
    if echo "$line" | grep -q "Up"; then echo "    ✅"; else echo "    ❌"; fi
  done
  echo "[3] Health:"
  curl -sf https://preprod-backend.ishswami.in/health | jq -r ".status"
  echo "[4] Image:"
  docker inspect preprod-api --format "  {{.Config.Image}} ({{.Image}})"
  echo "[5] DB:"
  docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_type = '\''BASE TABLE'\'';"
  echo "[6] Env:"
  docker exec preprod-api sh -c "echo DATABASE_URL=\${DATABASE_URL:-(not set)}" | grep -o "userdb_preprod" && echo "  ✅ DB: userdb_preprod" || echo "  ❌ DB wrong"
  echo "=== DONE ==="
'
```
