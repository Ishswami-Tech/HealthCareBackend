# Deployment Runbook

Step-by-step procedures for every deployment scenario, incident response, and
recovery operation.

> **Architecture summary:**
>
> - **Production & Preprod**: Both use Coolify blue-green deploys via
>   `coolify-deploy.sh`
> - **Preprod**: Active — Coolify app with Traefik ingress + Let's Encrypt SSL
>   for `preprod-backend.ishswami.in`
> - **Production**: Gated off — Coolify app ready, deploys enabled via
>   `ENABLE_PROD_DEPLOY=true`
> - **Nginx**: Coolify's Traefik proxy handles ingress (80/443) for both
>   environments
> - Postgres, Dragonfly are shared Docker volumes — never redeployed for app
>   changes.
>
> **CI workflow**: `.github/workflows/ci.yml` — single file handles both
> environments.

---

## Table of Contents

1. [Normal Production Deploy](#1-normal-production-deploy)
2. [Normal Preprod Deploy](#2-normal-preprod-deploy)
3. [Post-Deploy Verification](#3-post-deploy-verification)
4. [Rollback Production](#4-rollback-production)
5. [Rollback Preprod](#5-rollback-preprod)
6. [Database Restore](#6-database-restore)
7. [Preprod Database Reset](#7-preprod-database-reset)
8. [Infrastructure Recovery](#8-infrastructure-recovery)
9. [Common Troubleshooting](#9-common-troubleshooting)

---

## 1. Normal Production Deploy

### Trigger

Push to `main` branch → GitHub Actions → Coolify blue-green deploy (gated by
`ENABLE_PROD_DEPLOY`).

### Steps (automated by CI)

1. **detect-changes**: Determines if infra files changed
2. **security**: Trivy scan + npm audit (continue-on-error)
3. **docker-build**: Build multi-arch image → push to `ghcr.io` with tags
4. **ensure-infrastructure-health**: SSH to VPS → verify `postgres` +
   `dragonfly` healthy
5. **pre-deployment-backup**: `backup.sh pre-deployment` on VPS
6. **coolify-deploy.sh**: SSH to VPS → trigger Coolify API deploy
   - Coolify spins up new container (green)
   - Runs health check
   - Swaps traffic (blue → green)
   - Drains old container (blue)
   - Auto-rollback on failure
7. **post-deployment-verification**: Curl
   `https://backend-service-v1.ishswami.in/health` (3 retries × 10s)
8. **success-backup**: `backup.sh success` on VPS

### Enabling production deploys

Set `ENABLE_PROD_DEPLOY=true` as a GitHub repository variable. Ensure
`COOLIFY_PROD_APP_UUID` secret is configured.

### What gets redeployed

- **ONLY** the Coolify-managed production API + Worker containers (with new
  image)
- Postgres, Dragonfly, and Traefik are **untouched**

### Post-deploy

```bash
# Verify from your machine
curl -s https://backend-service-v1.ishswami.in/health | jq .

# Check on VPS (Coolify-managed container names)
ssh <user>@<host> 'docker ps --filter "name=api-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'
```

---

## 2. Normal Preprod Deploy

### Trigger

Push to `preprod` branch → GitHub Actions → Coolify API deploy (no approval
gate).

### CI Flow

1. Same pipeline as production (detect-changes, security, docker-build, etc.)
2. Deploy triggered via Coolify API for the preprod app (app UUID from
   `COOLIFY_PREPROD_APP_UUID`)
3. Image pushed to `ghcr.io/Ishswami-Tech/HealthCareBackend:preprod-<sha>`

### What gets redeployed

- **ONLY** the Coolify-managed preprod API + Worker containers (with new image)
- Postgres (`postgres`), Dragonfly (`dragonfly`), and Traefik are **untouched**

### Critical: Database name

Preprod connects to **`userdb_preprod`** (NOT `userdb`). Configured via:

- `.env.preprod` mounted by Coolify
- `DATABASE_URL=postgresql://postgres:...@postgres:5432/userdb_preprod`
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

# Drop and recreate preprod database (uses shared postgres container)
docker exec -i postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"

# Verify
docker exec -i postgres psql -U postgres -c "\l" | grep userdb_preprod

# Now redeploy via Coolify — migrations will recreate all tables
```

**Safety**: This only affects `userdb_preprod`. Production `userdb` is
completely untouched.

---

## 4. Post-Deploy Verification

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
# Production (when enabled)
ssh <host> 'docker ps --filter "name=api-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'

# Preprod
ssh <host> 'docker ps --filter "name=api-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
```

---

## 5. Rollback Production

### Automatic (Coolify)

Production Coolify deploy auto-rolls back if health check fails:

1. New container fails health check → Coolify reverts to previous deployment
2. Old container remains active
3. CI job fails → manual intervention needed

### Manual Rollback

```bash
# Via Coolify dashboard
# 1. Open http://<vps-ip>:8000
# 2. Navigate to production application
# 3. Select "Rollback" and choose the previous deployment

# Via Coolify API
curl -X POST "http://localhost:8000/api/v1/applications/${{ secrets.COOLIFY_PROD_APP_UUID }}/deploy" \
  -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

### Rollback via CI (redeploy previous tag)

```bash
# Find the previous image tag in GitHub Actions history
# Then trigger a new deploy with that tag by creating a commit
# Or disable ENABLE_PROD_DEPLOY if you need to pause production deploys
```

---

## 5. Rollback Preprod

### Automatic (Coolify)

Preprod uses Coolify's built-in rollback — if health check fails, Coolify
reverts to the previous deployment automatically.

### Manual Rollback

```bash
# Via Coolify dashboard
# 1. Open http://<vps-ip>:8000
# 2. Navigate to preprod application
# 3. Select "Rollback" and choose the previous deployment

# Via Coolify API
curl -X POST "http://localhost:8000/api/v1/applications/${{ secrets.COOLIFY_PREPROD_APP_UUID }}/deploy" \
  -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

**Note**: Use the Coolify dashboard to select which previous deployment to roll
back to. Coolify keeps deployment history.

---

## 6. Database Restore

### Preprod Database Restore

```bash
# SSH to VPS
ssh <user>@<host>

# Run restore script
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/restore.sh latest

# Verify
docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT 1"
```

**What restore.sh does**:

1. Finds backup metadata (local first, S3 fallback)
2. Creates safety backup before touching data
3. **Drops and recreates `userdb_preprod`** (NOT `userdb`)
4. Restores PostgreSQL from `.sql.gz`
5. Restores Dragonfly from `.rdb.gz`

> **⚠️ CRITICAL**: `restore.sh` restores to `userdb_preprod`. Production
> `userdb` is NEVER touched.

### Production Database Restore

```bash
ssh <user>@<host>
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/restore.sh latest
# This restores to `userdb` (production database)
```

---

## 7. Preprod Database Reset

### Scenario: Migrations broken, schema corrupted

```bash
# Option A: Drop and recreate (loses all preprod data)
ssh <user>@<host>
docker exec -i postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"

# Option B: Reset only schema (keeps data, re-runs migrations)
ssh <user>@<host>
docker exec -i postgres psql -U postgres -d userdb_preprod -c "
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
# Connect to postgres (shared container)
docker exec -it postgres psql -U postgres -d userdb_preprod

# Check tables
\dt

# Check row counts
SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;

# Check Prisma migration history
SELECT * FROM _prisma_migrations ORDER BY finished_at DESC;
```

---

## 8. Infrastructure Recovery

### Scenario: Postgres or Dragonfly is unhealthy

```bash
# Check infrastructure health
ssh <host> 'docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"'
ssh <host> 'docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"'
```

### Data volume preservation

Both environments use **named Docker volumes** (NOT bind mounts):

- Production: `docker_postgres_data`, `docker_dragonfly_data`
- Preprod: same volumes shared via the postgres/dragonfly containers

**Recreating the postgres container NEVER loses data** — data is in Docker
volumes.

### Full infrastructure restart (last resort)

```bash
# Production
ssh <host> 'cd /opt/healthcare-backend && docker compose -f devops/docker/docker-compose.prod.yml --profile infrastructure down && docker compose -f devops/docker/docker-compose.prod.yml --profile infrastructure up -d'

# Preprod
ssh <host> 'cd /opt/healthcare-preprod && docker compose -f devops/docker/docker-compose.preprod.yml down && docker compose -f devops/docker/docker-compose.preprod.yml up -d'
```

---

## 9. Common Troubleshooting

### Container not starting

```bash
# Production (Coolify-managed — names vary by UUID)
ssh <host> 'docker ps --filter "name=api-" --filter "label=coolify.role=app" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --filter "label=coolify.role=worker" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'

# Preprod (Coolify-managed — name varies by UUID)
ssh <host> 'docker ps --filter "name=api-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'
```

### Port already in use

```bash
# Check all API containers across environments
ssh <host> 'docker ps --filter "name=api-" --format "table {{.Names}}\t{{.Ports}}\t{{.Image}}"'

# Preprod nginx (internal)
ssh <host> 'docker ps --filter "publish=8090" --format "table {{.Names}}\t{{.Ports}}\t{{.Image}}"'
```

### Database connection refused

```bash
# Verify postgres is running and accepting connections
ssh <host> 'docker exec postgres pg_isready -U postgres'

# Check DATABASE_URL in production container (use dynamic name)
PROD_API=$(ssh <host> "docker ps --filter 'name=api-' --filter 'label=coolify.role=app' --format '{{.Names}}' | grep -v preprod | head -1")
ssh <host> "docker exec $PROD_API sh -c 'echo \${DATABASE_URL:-NOT SET}'"

# Check DATABASE_URL in preprod container
PREPROD_API=$(ssh <host> "docker ps --filter 'name=api-' --filter 'label=coolify.role=app' --format '{{.Names}}' | head -1")
ssh <host> "docker exec $PREPROD_API sh -c 'echo \${DATABASE_URL:-NOT SET}'"
```

### Dragonfly/cache issues

```bash
# Check dragonfly is running
ssh <host> 'docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"'

# Test connectivity from a Coolify-managed API container
PROD_API=$(ssh <host> "docker ps --filter 'name=api-' --format '{{.Names}}' | head -1")
ssh <host> "docker exec $PROD_API sh -c 'nc -z dragonfly 6379 && echo OK || echo FAIL'"
```

---

## Escalation

If any check fails and you cannot resolve within 15 minutes:

| Severity            | Action                                                         |
| ------------------- | -------------------------------------------------------------- |
| Production down     | Trigger rollback via Coolify dashboard                         |
| Preprod down        | Redeploy via Coolify dashboard                                 |
| Data corruption     | Restore from backup (`restore.sh latest`)                      |
| Infrastructure down | `docker compose up -d --force-recreate` with volumes preserved |
| Coolify down        | Check Coolify container logs, restart if needed                |
