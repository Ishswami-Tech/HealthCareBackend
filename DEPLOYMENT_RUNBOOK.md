# Deployment Runbook

Step-by-step procedures for every deployment scenario, incident response, and
recovery operation.

> **Critical principle**: Only API and Worker containers are deployed/recreated.
> Postgres, Dragonfly, and Nginx are NOT redeployed for app changes. Preprod
> uses its own database (`userdb_preprod`) in the same PostgreSQL instance as
> production.

---

## Table of Contents

1. [Normal Production Deploy](#1-normal-production-deploy)
2. [Normal Preprod Deploy](#2-normal-preprod-deploy)
3. [Preprod Fresh Database](#3-preprod-fresh-database)
4. [Manual Preprod Deploy (from VPS)](#4-manual-preprod-deploy-from-vps)
5. [Post-Deploy Verification](#5-post-deploy-verification)
6. [Rollback Production](#6-rollback-production)
7. [Rollback Preprod](#7-rollback-preprod)
8. [Database Restore](#8-database-restore)
9. [Preprod Database Reset](#9-preprod-database-reset)
10. [Infrastructure Recovery](#10-infrastructure-recovery)
11. [Disaster Recovery (Complete Server Loss)](#11-disaster-recovery-complete-server-loss)
12. [Common Troubleshooting](#12-common-troubleshooting)

---

## 1. Normal Production Deploy

### Trigger

Push to `main` branch → GitHub Actions → approval gate → deploy.

### Steps (automated by CI)

1. **detect-changes**: Determines if infra files changed (`docker-compose`,
   nginx configs, scripts)
2. **security**: Trivy scan + npm audit (continue-on-error)
3. **docker-build**: Build multi-arch image → push to `ghcr.io` with tags
4. **ensure-infrastructure-health**: SSH to VPS → run `health-check.sh` on
   `postgres` + `dragonfly`
5. **validate-secrets**: Verify all required secrets non-empty
6. **validate-disk-space**: SSH to VPS → ensure ≥3 GB free
7. **deploy**: `blue-green-deploy.sh` over SSH
   - Build `.env.production` on VPS from GitHub Secrets
   - Copy compose files + nginx configs to VPS
   - Run Prisma migrations (`continue-on-error`, handled downstream)
   - Blue-green deploy: API first, then Worker
8. **post-deployment-verification**: Curl
   `https://backend-service-v1.ishswami.in/health` (3 retries × 10s)
9. **success-backup**: `backup.sh success` on VPS
10. **portainer-sync**: Update Portainer stack metadata (optional)

### What gets redeployed

- **ONLY** `latest-api` and `latest-worker` containers (with new image)
- Postgres, Dragonfly, and Nginx are **untouched**

### Post-deploy

```bash
# Verify from your machine
curl -s https://backend-service-v1.ishswami.in/health | jq .

# Check on VPS
ssh <user>@<host> 'docker ps --filter "name=latest-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'
```

---

## 2. Normal Preprod Deploy

### Trigger

Push to `preprod` branch → GitHub Actions → auto-deploy (no approval gate).

### CI Flow (same pipeline, different env vars)

| Variable           | Value                         |
| ------------------ | ----------------------------- |
| `DEPLOY_ENV`       | `preprod`                     |
| `COMPOSE_FILE`     | `docker-compose.preprod.yml`  |
| `CONTAINER_PREFIX` | `preprod-`                    |
| `DOCKER_NETWORK`   | `preprod-network`             |
| `NGINX_PORT`       | `8089`                        |
| `API_PORT`         | `8088`                        |
| `API_SUBDOMAIN`    | `preprod-backend.ishswami.in` |
| `ENV_FILE`         | `.env.preprod`                |
| `BLUE_GREEN`       | `false` (rolling deploy)      |
| `POSTGRES_DB`      | `userdb_preprod`              |

### What gets redeployed

- **ONLY** `preprod-api` and `preprod-worker` containers (with new image)
- Postgres (`preprod-postgres`), Dragonfly (`preprod-dragonfly`), and Nginx
  (`preprod-nginx`) are **untouched**

### Critical: Database name

Preprod connects to **`userdb_preprod`** (NOT `userdb`). This is configured via:

- `.env.preprod` →
  `DATABASE_URL=postgresql://postgres:...@preprod-postgres:5432/userdb_preprod`
- Prisma migrations run against `userdb_preprod`

### Post-deploy

```bash
curl -s https://preprod-backend.ishswami.in/health | jq .
```

---

## 3. Preprod Fresh Database

When preprod data is corrupted, migrations are broken, or you need a clean
slate:

```bash
# SSH to VPS
ssh <user>@<host>

# Drop and recreate preprod database
docker exec -i preprod-postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i preprod-postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"

# Verify
docker exec -i preprod-postgres psql -U postgres -c "\l" | grep userdb_preprod

# Now deploy — migrations will recreate all tables
# Push to preprod branch or run deploy manually
```

**Safety**: This only affects `userdb_preprod`. Production `userdb` is
completely untouched.

---

## 4. Manual Preprod Deploy (from VPS)

Useful when CI fails or you need an immediate deploy.

```bash
# SSH to VPS
ssh <user>@<host>
cd /opt/healthcare-preprod

# Ensure code is up to date
git fetch origin
git checkout preprod
git pull origin preprod

# Run rolling deploy
bash devops/scripts/docker-infra/deploy.sh \
  --env preprod \
  --blue-green false \
  --app-changed true \
  --infra-changed false
```

### What happens

1. Validates environment = preprod
2. Sets `CONTAINER_PREFIX=preprod-`, `COMPOSE_FILE=docker-compose.preprod.yml`
3. Skips infrastructure deploy (not unhealthy, not changed)
4. Tags current image as `rollback-backup-<timestamp>`
5. Stops & removes `preprod-api` + `preprod-worker`
6. Runs Prisma migrations against `userdb_preprod` (with P3009 auto-recovery)
7. Pulls new image from GHCR
8. Starts new containers
9. Verifies image IDs match
10. Health check (`/infra-health`, up to 360s)
11. Post-deploy verification (4 steps)

---

## 5. Post-Deploy Verification

### Automated (CI)

Runs after deploy job succeeds:

```
URL: https://<subdomain>/health
Retries: 3 attempts, 10s apart
Timeout: 10s per attempt
Pass: HTTP 200 with "status" in body
Fail: All retries fail → CI job fails
```

### Manual (VPS)

```bash
# Full deployment verification
bash devops/scripts/docker-infra/verify.sh

# Specific checks
bash devops/scripts/docker-infra/verify.sh backup <id>   # Verify backup integrity
bash devops/scripts/docker-infra/verify.sh image          # Verify running image
bash devops/scripts/docker-infra/verify.sh fix-image      # Force fresh pull + recreate
bash devops/scripts/docker-infra/verify.sh status         # Status dashboard
```

### Verification steps (what verify.sh checks)

1. **Infrastructure**: Postgres + Dragonfly healthy (3 retries with
   auto-recovery)
2. **Data integrity**: `SELECT 1` on postgres, row counts in `users` and
   `clinics`
3. **Application**: Polls `/infra-health` for up to 240s, verifies worker,
   verifies public ingress
4. **Environment**: Checks `DATABASE_URL` and `NODE_ENV` are set correctly

**Exit codes**: 0 = success, 1 = partial (infra OK but API not ready), 2 =
failure

---

## 6. Rollback Production

### Automatic (Blue-Green)

Production uses **implicit rollback** — no separate rollback function needed:

- If health check fails → new container removed → old container keeps serving
- If nginx reload fails → upstream.conf restored → old container keeps serving
- CI sees non-zero exit → deploy marked as **failed**

### Manual Rollback

```bash
# SSH to VPS
ssh <user>@<host>
cd /opt/healthcare-backend

# List available rollback images
docker images --filter "reference=ghcr.io/ishswami-tech/healthcarebackend/healthcare-api" \
  --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}" | head -5

# Re-deploy with previous image
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --container-prefix "latest-" \
  --service "api" \
  --image "ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<previous-sha-or-rollback-backup-tag>" \
  --network "app-network" \
  --upstream-conf ./nginx/upstream.conf \
  --nginx-container "latest-nginx" \
  --health-endpoint "/infra-health" \
  --health-timeout 180 \
  --health-interval 5 \
  --drain-timeout 120 \
  --drain-interval 5 \
  --api-port 8088

# Then deploy worker with same image
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --container-prefix "latest-" \
  --service "worker" \
  --image "ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<same-image>" \
  --network "app-network" \
  --upstream-conf ./nginx/upstream.conf \
  --nginx-container "latest-nginx" \
  --health-endpoint "/infra-health" \
  --health-timeout 180 \
  --health-interval 5 \
  --drain-timeout 120 \
  --drain-interval 5 \
  --api-port 8088
```

---

## 7. Rollback Preprod

### Automatic (Rolling Deploy)

Preprod uses explicit rollback in `deploy.sh`:

```bash
# After 3 failed post-deploy verification attempts:
# 1. Finds the rollback-backup-<timestamp> tagged image
# 2. Stops current containers
# 3. Retags backup as the expected image
# 4. Recreates containers
# 5. Verifies health
```

### Manual Rollback

```bash
ssh <user>@<host>
cd /opt/healthcare-preprod

# List rollback images
docker images --filter "reference=ghcr.io/ishswami-tech/healthcarebackend/healthcare-api" \
  --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}" | grep rollback-backup

# Re-deploy with backup image
bash devops/scripts/docker-infra/deploy.sh \
  --env preprod \
  --blue-green false
# (deploy.sh automatically uses the rollback-backup tag if current deploy fails)
```

---

## 8. Database Restore

### Preprod Database Restore

```bash
# SSH to VPS
ssh <user>@<host>

# Navigate to preprod directory
cd /opt/healthcare-preprod

# Restore latest backup
bash devops/scripts/docker-infra/restore.sh latest

# OR restore specific backup
bash devops/scripts/docker-infra/restore.sh success-2026-08-09-143022
```

**What restore.sh does**:

1. Finds backup metadata (local first, S3 fallback)
2. Stops `preprod-api` + `preprod-worker` containers
3. Creates safety backup before touching data
4. **Drops and recreates `userdb_preprod`** (NOT `userdb`)
5. Restores PostgreSQL from `.sql.gz`
6. Restores Dragonfly from `.rdb.gz`
7. Starts API + Worker containers

> **⚠️ CRITICAL**: `restore.sh` restores to the database configured in the
> current environment. For preprod, this is `userdb_preprod`. Production
> `userdb` is NEVER touched by a preprod restore.

### Production Database Restore

```bash
ssh <user>@<host>
cd /opt/healthcare-backend

bash devops/scripts/docker-infra/restore.sh latest
# This restores to `userdb` (production database)
```

### Disaster Recovery (complete server loss)

**Prerequisites on new VPS**:

1. Re-provision Contabo VPS (OS + Docker + Nginx)
2. Confirm host-level Nginx (port 80/443) is running
3. Transfer GitHub Actions secrets back to VPS
4. Push code to trigger CI pipeline (or run deploy manually)

**On VPS**:

```bash
# Clone repo
git clone <repo-url> /opt/healthcare-backend
cd /opt/healthcare-backend

# Copy .env.production from secure backup
# Set up cron for backups
bash devops/scripts/docker-infra/backup.sh setup-cron

# Restore from S3
bash devops/scripts/docker-infra/restore.sh disaster success-2026-08-09-143022

# Deploy
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --container-prefix "latest-" --service "api" \
  --network "app-network" \
  --upstream-conf ./nginx/upstream.conf \
  --nginx-container "latest-nginx" \
  --health-endpoint "/infra-health" --health-timeout 180 \
  --health-interval 5 --drain-timeout 120 --drain-interval 5 \
  --api-port 8088
```

---

## 9. Preprod Database Reset

### Scenario: Migrations broken, schema corrupted

```bash
# Option A: Drop and recreate (loses all preprod data)
ssh <user>@<host>
docker exec -i preprod-postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i preprod-postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"

# Option B: Reset only schema (keeps data, re-runs migrations)
ssh <user>@<host>
docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "
  DO \$\$ DECLARE
    r RECORD;
  BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
      EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
  END \$\$;
"
# Then redeploy to re-run migrations
```

### Verify preprod DB state

```bash
# Connect to preprod postgres
docker exec -it preprod-postgres psql -U postgres -d userdb_preprod

# Check tables
\dt

# Check row counts
SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;

# Check Prisma migration history
SELECT * FROM _prisma_migrations ORDER BY finished_at DESC;
```

---

## 10. Infrastructure Recovery

### Scenario: Postgres or Dragonfly is unhealthy

```bash
# Check infrastructure health
bash devops/scripts/docker-infra/health-check.sh

# If unhealthy, auto-recreation (if enabled)
# In CI: ensure-infrastructure-health step runs this
# Manual:
AUTO_RECREATE_SERVICES=true bash devops/scripts/docker-infra/health-check.sh

# Or manually recreate postgres (preserves data volume)
cd /opt/healthcare-backend
docker compose -f devops/docker/docker-compose.prod.yml --profile infrastructure up -d --force-recreate postgres

# Same for preprod
cd /opt/healthcare-preprod
docker compose -f devops/docker/docker-compose.preprod.yml up -d --force-recreate preprod-postgres
```

### Data volume preservation

Both environments use **bind-mounted** volumes:

- Production: `/opt/healthcare-backend/data/postgres` → `docker_postgres_data`
- Preprod: `/opt/healthcare-preprod/data/postgres` → `preprod_postgres_data`
- Production: `/opt/healthcare-backend/data/dragonfly` → `docker_dragonfly_data`
- Preprod: `/opt/healthcare-preprod/data/dragonfly` → `preprod_dragonfly_data`

**Recreating the postgres container NEVER loses data** — the volume is a bind
mount outside the container.

### Full infrastructure restart (last resort)

```bash
# Production
cd /opt/healthcare-backend
docker compose -f devops/docker/docker-compose.prod.yml --profile infrastructure down
docker compose -f devops/docker/docker-compose.prod.yml --profile infrastructure up -d

# Wait for health
bash devops/scripts/docker-infra/health-check.sh

# Preprod
cd /opt/healthcare-preprod
docker compose -f devops/docker/docker-compose.preprod.yml down
docker compose -f devops/docker/docker-compose.preprod.yml up -d
```

---

## 11. Disaster Recovery (Complete Server Loss)

### Prerequisites on New VPS

1. **Provision**: Install OS, Docker Engine + Compose plugin
2. **Network**: Ensure `coolify` Docker network exists (managed by Coolify)
3. **Host Nginx**: Port 80/443 reverse proxy to Docker Nginx
4. **Secrets**: Re-enter GitHub Actions secrets (VPS_SSH_KEY, etc.)
5. **DNS**: Verify domains point to new VPS IP

### Recovery Steps

```bash
# 1. Clone repo
git clone <repo-url> /opt/healthcare-backend
cd /opt/healthcare-backend
git checkout main

# 2. Set up .env.production (from password manager / secure backup)
cp .env.production.example .env.production
# Edit with actual values — DATABASE_URL, JWT secrets, etc.

# 3. Set up backup cron
bash devops/scripts/docker-infra/backup.sh setup-cron

# 4. Start infrastructure
docker compose -f devops/docker/docker-compose.prod.yml --profile infrastructure up -d

# 5. Wait for health
bash devops/scripts/docker-infra/health-check.sh

# 6. Restore latest backup from S3
bash devops/scripts/docker-infra/restore.sh disaster latest
# OR specify backup ID:
bash devops/scripts/docker-infra/restore.sh disaster success-2026-08-09-143022

# 7. Deploy application
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --container-prefix "latest-" --service "api" \
  --network "app-network" \
  --upstream-conf ./nginx/upstream.conf \
  --nginx-container "latest-nginx" \
  --health-endpoint "/infra-health" --health-timeout 180 \
  --health-interval 5 --drain-timeout 120 --drain-interval 5 \
  --api-port 8088

# 8. Run verification
bash devops/scripts/docker-infra/verify.sh

# 9. Trigger post-deploy backup
bash devops/scripts/docker-infra/backup.sh success
```

### Preprod Recovery (if separate server or fresh setup)

Same as above but:

- Use `.env.preprod` instead
- Use `docker-compose.preprod.yml`
- Database: `userdb_preprod`

---

## 12. Common Troubleshooting

### Deploy fails: "Image pull failed"

```bash
# Check GHCR auth
ssh <host> 'docker login ghcr.io -u <username>'

# Check image exists
docker manifest inspect ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:latest

# Wait for propagation (GHCR can take 1-2 min after push)
sleep 120
# Retry deploy
```

### Deploy fails: "Container failed to start"

```bash
# Check logs
docker logs --tail 100 preprod-api 2>&1

# Common causes:
# - DATABASE_URL wrong → fix in .env.preprod
# - Postgres not healthy → check health-check.sh
# - Port conflict → check if port 8088/8089 already in use
# - Out of memory → check docker stats
```

### Health check stuck / timeout

```bash
# Check what's happening
docker exec preprod-api wget -q --spider http://localhost:8088/infra-health
docker exec preprod-api ps aux

# Check DB connectivity from inside container
docker exec preprod-api sh -c 'nc -z preprod-postgres 5432 && echo OK || echo FAIL'

# Check if app is listening
docker exec preprod-api netstat -tlnp 2>/dev/null || ss -tlnp
```

### Nginx 502 Bad Gateway

```bash
# Check upstream.conf
cat /opt/healthcare-preprod/nginx/upstream.conf

# Check nginx config
docker exec preprod-nginx nginx -t

# Check if API is healthy
curl -s http://localhost:8089/infra-health

# Check Traefik routing
docker logs traefik --tail 50 2>&1
```

### Migration failure (P3009)

```bash
# Check which migrations failed
ssh <host>
docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 10;"

# If safe, mark as applied
docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c \
  "SELECT prisma_migrate_resolve_applied('20250809000000_add_some_field');"

# Or re-run migrations after fixing schema
bash devops/scripts/docker-infra/deploy.sh --env preprod --blue-green false
```

### Out of disk space

```bash
# Check space
df -h /opt/healthcare-preprod

# Clean old images
docker image prune -a --filter "until=720h"  # Remove unused images older than 30 days

# Clean old backups
bash devops/scripts/docker-infra/backup.sh cleanup
# Or manually:
find /opt/healthcare-preprod/backups -type f -mtime +7 -delete

# Clean Docker build cache
docker builder prune -f
```

### Wrong image deployed

```bash
# Fix with verify.sh
ssh <host> 'bash /opt/healthcare-preprod/devops/scripts/docker-infra/verify.sh fix-image'

# Or manually
cd /opt/healthcare-preprod
bash devops/scripts/docker-infra/deploy.sh --env preprod --blue-green false
```

### Worker not processing jobs

```bash
# Check worker health
docker exec preprod-worker node dist/worker-bootstrap.js --healthcheck

# Check worker logs
docker logs --tail 100 preprod-worker 2>&1

# Check Bull Board dashboard
curl -s https://preprod-backend.ishswami.in/queue-dashboard | jq .

# Check queue connection
docker exec preprod-worker node -e "
  const { Queue } = require('bullmq');
  const q = new Queue('default', { connection: { host: 'preprod-dragonfly', port: 6379 } });
  q.getJobCounts().then(c => console.log(c));
"
```
