# Deployment Verification

Deep verification procedures, acceptance criteria, and edge-case testing for the
healthcare-backend deployment pipeline.

> **Architecture summary:**
>
> - **Preprod**: Active — Coolify-managed app with Traefik ingress + Let's
>   Encrypt SSL for `preprod-backend.ishswami.in`. CI triggers deploys via
>   Coolify API (`coolify-deploy.sh`).
> - **Production**: Gated off — currently runs via `docker-compose.prod.yml`
>   (latest-api/latest-worker). Deploys enabled via `ENABLE_PROD_DEPLOY=true`.
> - **Ingress**: Coolify's Traefik proxy handles 80/443 for the preprod
>   environment (host → coolify-proxy → api-ix9fceaxa914diauokjleeis:8080).
> - **Shared infra**: Postgres and Dragonfly run once and serve both
>   environments via separate database names and cache key prefixes.

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
10. [Edge Case Scenarios](#10-edge-case-scenarios)
11. [Performance Baseline](#11-performance-baseline)
12. [Security Verification](#12-security-verification)

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
- Traefik routing (checks endpoint, not routing layer)

**These must be verified manually for L1+ checks.**

---

## 3. Full Manual Verification

### 3.1 Production Verification

```bash
PROD_HOST="<your-host>"

echo "=== PRODUCTION FULL VERIFICATION ==="

# Step 1: Infrastructure
echo "[1/8] Infrastructure health..."
ssh $PROD_HOST 'docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}"'
ssh $PROD_HOST 'docker ps --filter "name=dragonfly" --format "table {{.Names}}\t{{.Status}}"'

# Step 2: Container status
echo "[2/8] Container status..."
ssh $PROD_HOST 'docker ps --filter "name=api-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'
ssh $PROD_HOST 'docker ps --filter "name=worker-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'

# Step 3: Image verification
echo "[3/8] Running image..."
PROD_API=$(ssh $PROD_HOST "docker ps --filter 'name=api-' --format '{{.Names}}' | head -1")
ssh $PROD_HOST "docker inspect $PROD_API --format 'Image: {{.Config.Image}}\nID: {{.Image}}\nCreated: {{.Created}}'"

# Step 4: Health endpoints
echo "[4/8] Health endpoints..."
curl -s https://backend-service-v1.ishswami.in/health | jq .
curl -s https://backend-service-v1.ishswami.in/infra-health | jq .

# Step 5: Database connectivity
echo "[5/8] Database..."
PROD_API=$(ssh $PROD_HOST "docker ps --filter 'name=api-' --format '{{.Names}}' | head -1")
ssh $PROD_HOST "docker exec $PROD_API sh -c 'nc -z postgres 5432 && echo DB_OK || echo DB_FAIL'"

# Step 6: Disk space
echo "[6/8] Disk space..."
ssh $PROD_HOST 'df -h /opt/healthcare-backend'

# Step 7: Logs (check for errors)
echo "[7/8] Logs..."
PROD_API=$(ssh $PROD_HOST "docker ps --filter 'name=api-' --format '{{.Names}}' | head -1")
PROD_WORKER=$(ssh $PROD_HOST "docker ps --filter 'name=worker-' --format '{{.Names}}' | head -1")
ssh $PROD_HOST "docker logs --tail 50 $PROD_API 2>&1 | grep -iE 'error|fatal|unhandled|ECONNREFUSED|timeout' || echo 'No errors found'"
ssh $PROD_HOST "docker logs --tail 50 $PROD_WORKER 2>&1 | grep -iE 'error|fatal|unhandled' || echo 'No errors found'"

# Step 8: Dragonfly connectivity
echo "[8/8] Cache..."
ssh $PROD_HOST "docker exec $PROD_API sh -c 'nc -z dragonfly 6379 && echo CACHE_OK || echo CACHE_FAIL'"
```

### 3.2 Preprod Verification

```bash
PREPROD_HOST="<same-host>"  # Same VPS

echo "=== PREPROD FULL VERIFICATION ==="

# Step 1: Infrastructure
echo "[1/8] Infrastructure health..."
ssh $PREPROD_HOST 'docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}"'
ssh $PREPROD_HOST 'docker ps --filter "name=dragonfly" --format "table {{.Names}}\t{{.Status}}"'

# Step 2: Container status
echo "[2/8] Container status..."
ssh $PREPROD_HOST 'docker ps --filter "name=api-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'
ssh $PREPROD_HOST 'docker ps --filter "name=worker-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'

# Step 3: Image verification
echo "[3/8] Running image..."
PREPROD_API=$(ssh $PREPROD_HOST "docker ps --filter 'name=api-ix9' --format '{{.Names}}' | head -1")
ssh $PREPROD_HOST "docker inspect $PREPROD_API --format 'Image: {{.Config.Image}}\nID: {{.Image}}\nCreated: {{.Created}}'"

# Step 4: Health endpoints
echo "[4/8] Health endpoints..."
curl -s https://preprod-backend.ishswami.in/health | jq .
curl -s https://preprod-backend.ishswami.in/infra-health | jq .

# Step 5: Database verification
echo "[5/8] Database..."
ssh $PREPROD_HOST 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT 1"'
ssh $PREPROD_HOST 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_type = '\''BASE TABLE'\'';"'
ssh $PREPROD_HOST 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"'

# Step 6: Environment variables
echo "[6/8] Environment variables..."
PREPROD_API=$(ssh $PREPROD_HOST "docker ps --filter 'name=api-ix9' --format '{{.Names}}' | head -1")
PREPROD_WORKER=$(ssh $PREPROD_HOST "docker ps --filter 'name=worker-ix9' --format '{{.Names}}' | head -1")
ssh $PREPROD_HOST "docker exec $PREPROD_API sh -c 'echo DATABASE_URL=\${DATABASE_URL:-NOT SET}' | grep -o 'userdb_preprod'"
ssh $PREPROD_HOST "docker exec $PREPROD_API sh -c 'echo NODE_ENV=\${NODE_ENV:-NOT SET}'"
ssh $PREPROD_HOST "docker exec $PREPROD_WORKER sh -c 'echo DRAGONFLY_KEY_PREFIX=\${DRAGONFLY_KEY_PREFIX:-NOT SET}'"

# Step 7: Logs
echo "[7/8] Logs..."
ssh $PREPROD_HOST 'docker logs --tail 50 api-ix9fceaxa914diauokjleeis 2>&1 | grep -iE "error|fatal" || echo "No errors"'
ssh $PREPROD_HOST 'docker logs --tail 50 worker-ix9fceaxa914diauokjleeis 2>&1 | grep -iE "error|fatal" || echo "No errors"'

# Step 8: Health check
echo "[8/8] Health..."
ssh $PREPROD_HOST 'docker inspect --format "{{.State.Health.Status}}" $(docker ps --filter "name=api-ix9" --format "{{.Names}}" | head -1)'
```

### Acceptance Criteria

| Check                  | Expected                                               | Notes                                                                 |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- | --------------------- |
| `/health`              | 200, `"status":"healthy"`                              | All services green                                                    |
| `/infra-health`        | 200, all services healthy                              | DB + cache reachable                                                  |
| API container          | `running`                                              | `api-<uuid>` (prod) or `api-ix9fceaxa914diauokjleeis` (preprod)       |
| Worker container       | `running`                                              | `worker-<uuid>` (prod) or `worker-ix9fceaxa914diauokjleeis` (preprod) |
| Image tag              | Matches deployed tag                                   | No stale image                                                        |
| DB connectivity        | `SELECT 1` → `?column?                                 | 1`                                                                    | FROM inside container |
| Table count            | >0 (unless fresh DB)                                   | Tables created by Prisma                                              |
| Migrations             | Latest migration marked `applied`                      | No failed migrations                                                  |
| `DATABASE_URL`         | Contains `userdb_preprod` (preprod) or `userdb` (prod) | NOT localhost                                                         |
| `DRAGONFLY_KEY_PREFIX` | `healthcare-preprod:` (preprod) / `healthcare:` (prod) | No collision                                                          |
| `NODE_ENV`             | `production`                                           | Both environments                                                     |
| Container health       | `healthy`                                              | Docker health check passing                                           |
| No error logs          | 0 errors in last 50 lines                              | Check API + Worker                                                    |

---

## 4. Infrastructure Verification

### Postgres

```bash
# Connectivity from host
docker exec postgres pg_isready -U postgres -d userdb
# Expected: postgres:5432 - accepting connections

# Connectivity from API container
docker exec $(docker ps --filter "name=api-" --format "{{.Names}}" | head -1) sh -c 'nc -z postgres 5432 && echo OK'
# Expected: OK

# Connection limits
docker exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

### Dragonfly

```bash
# Connectivity from host
docker exec dragonfly redis-cli ping
# Expected: PONG

# Connectivity from API container
docker exec $(docker ps --filter "name=api-" --format "{{.Names}}" | head -1) sh -c 'nc -z dragonfly 6379 && echo OK'
# Expected: OK

# Memory usage
docker exec dragonfly redis-cli INFO memory | grep used_memory_human
```

---

## 5. Application Verification

### Container Health

```bash
# Production
docker ps --filter "name=api-" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
docker ps --filter "name=worker-" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"

# Preprod
docker ps --filter "name=api-ix9" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
docker ps --filter "name=worker-ix9" --format "{{.Names}}\t{{.Status}}"
```

### Image Verification

```bash
# Production
docker inspect $(docker ps --filter "name=api-" --format "{{.Names}}" | head -1) --format "Image: {{.Config.Image}}\nID: {{.Image}}"

# Preprod
docker inspect api-ix9fceaxa914diauokjleeis --format "Image: {{.Config.Image}}\nID: {{.Image}}"
```

### Health Endpoints

```bash
# Production
curl -s https://backend-service-v1.ishswami.in/health | jq .
curl -s https://backend-service-v1.ishswami.in/infra-health | jq .

# Preprod
curl -s https://preprod-backend.ishswami.in/health | jq .
curl -s https://preprod-backend.ishswami.in/infra-health | jq .
```

---

## 6. Environment Isolation Verification

These checks ensure production and preprod are properly isolated.

```bash
# 1. Networks are separate
docker network ls | grep -E "app-network|preprod-network"
# Should show both networks

# 2. Production DB has only production data
docker exec -i postgres psql -U postgres -d userdb -c "\dt"

# 3. Preprod DB has only preprod data
docker exec -i postgres psql -U postgres -d userdb_preprod -c "\dt"

# 4. Containers are on correct networks
docker inspect $(docker ps --filter "name=api-" --format "{{.Names}}" | head -1) --format "{{json .NetworkSettings.Networks}}" | jq .
docker inspect api-ix9fceaxa914diauokjleeis --format "{{json .NetworkSettings.Networks}}" | jq .

# 5. Dragonfly key prefixes don't collide
docker exec dragonfly redis-cli --scan --pattern "healthcare-preprod:*" | wc -l
docker exec dragonfly redis-cli --scan --pattern "healthcare:*" | wc -l
```

- [ ] Networks are separate (`app-network` vs `preprod-network`)
- [ ] Production DB contains only production data
- [ ] Preprod DB contains only preprod data
- [ ] Containers are on their correct networks
- [ ] Cache keys don't collide between environments

---

## 7. Database Verification

### Schema

```bash
# Production
docker exec -i postgres psql -U postgres -d userdb -c "\dt"

# Preprod
docker exec -i postgres psql -U postgres -d userdb_preprod -c "\dt"
```

### Migrations

```bash
# Check migration history
docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

# Check for failed migrations
docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;"
```

### Row counts

```bash
# Preprod
docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM users;"
docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM clinics;"

# Production
docker exec -i postgres psql -U postgres -d userdb -c "SELECT COUNT(*) FROM users;"
docker exec -i postgres psql -U postgres -d userdb -c "SELECT COUNT(*) FROM clinics;"
```

---

## 8. Cache Verification

```bash
# Dragonfly connectivity
docker exec dragonfly redis-cli ping
# Expected: PONG

# Check key prefixes (should be separate)
docker exec dragonfly redis-cli DBSIZE
# Should show total keys across both environments

# Test cache operations from preprod container
docker exec api-ix9fceaxa914diauokjleeis sh -c '
  node -e "
    const redis = require(\"ioredis\");
    const client = new redis({ host: \"dragonfly\", port: 6379, keyPrefix: \"healthcare-preprod:\" });
    client.set(\"test\", \"1\", \"EX\", 10).then(() => {
      console.log(\"Cache write OK\");
      return client.get(\"test\");
    }).then(val => {
      console.log(\"Cache read:\", val);
      return client.del(\"test\");
    }).then(() => {
      console.log(\"Cache cleanup OK\");
      process.exit(0);
    }).catch(err => {
      console.error(\"Cache FAIL:\", err.message);
      process.exit(1);
    });
  "
'
```

---

## 9. Network and Ingress Verification

### Port mapping

```bash
# Production
docker ps --filter "name=api-" --format "{{.Names}}\t{{.Ports}}"

# Preprod
docker ps --filter "name=api-ix9" --format "{{.Names}}\t{{.Ports}}"
```

### Ingress verification

```bash
# Verify preprod is reachable through Coolify Traefik proxy
curl -sI https://preprod-backend.ishswami.in/health | head -5

# Verify production is reachable through host nginx
curl -sI https://backend-service-v1.ishswami.in/health | head -5
```

### DNS

```bash
# Verify domains resolve
curl -sI https://backend-service-v1.ishswami.in | head -5
curl -sI https://preprod-backend.ishswami.in | head -5
```

---

## 10. Edge Case Scenarios

### Image pull failure

```bash
# Verify image exists in local registry
curl -s http://localhost:5000/v2/healthcare-api/tags/list | jq .

# If missing, CI failed to push — rebuild and redeploy
```

### Migration failure

```bash
# Check migration status from inside the API container
docker exec api-ix9fceaxa914diauokjleeis sh -c 'npx prisma migrate status --schema=/app/prisma/schema.prisma 2>&1' || true

# For failed migrations, reset preprod DB and redeploy
```

### Container restart loop

```bash
# Check logs for crash reason
docker logs --tail 100 api-ix9fceaxa914diauokjleeis 2>&1 | tail -20

# Common causes: DATABASE_URL wrong, migration failure, missing env var
```

---

## 11. Performance Baseline

```bash
# Response time baseline (should be <200ms for health endpoint)
time curl -s https://backend-service-v1.ishswami.in/health > /dev/null

# Preprod
time curl -s https://preprod-backend.ishswami.in/health > /dev/null
```

---

## 12. Security Verification

```bash
# Verify no secrets in logs
docker logs --tail 200 api-ix9fceaxa914diauokjleeis 2>&1 | grep -iE "password|secret|token|key" | grep -v "REDACTED" || echo "No exposed secrets"

# Verify production DB is not accessible from preprod
docker exec api-ix9fceaxa914diauokjleeis sh -c 'echo ${DATABASE_URL:-NOT SET}' | grep -c "userdb_preprod"
# Expected: 1 (must point to userdb_preprod, not userdb)

# Verify ports are not exposed externally (except via Traefik/nginx)
docker ps --filter "name=api-ix9" --format "{{.Names}}\t{{.Ports}}"
# Should NOT show 0.0.0.0:8087 (if API port is only internal)
```
