# Deployment Status Check

Pre-deploy and post-deploy checklist for both production and preprod
environments.

> **Architecture summary:**
>
> - **Production & Preprod**: Both managed by Coolify blue-green deploys via
>   `coolify-deploy.sh`
> - **Preprod**: Active — Coolify app with Traefik ingress + Let's Encrypt SSL
>   for `preprod-backend.ishswami.in`
> - **Production**: Gated off — Coolify app ready, deploys enabled via
>   `ENABLE_PROD_DEPLOY=true`
> - **Nginx**: Coolify's Traefik proxy handles ingress (80/443) for both
>   environments
> - Postgres, Dragonfly are shared Docker volumes — never redeployed for
>   app-only deploys.

---

## Pre-Deploy Checklist (Production)

Run this **before** merging to main or triggering a deploy.

### Code Quality

- [ ] All CI checks pass (lint, type-check, tests, audit)
- [ ] PR reviewed and approved
- [ ] PR targets `preprod` branch for promotion (not directly to main, unless
      hotfix policy applies)
- [ ] CHANGELOG updated (if applicable)

### Infrastructure Health

```bash
ssh <host> 'docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"'
ssh <host> 'docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"'
```

- [ ] `postgres` container healthy
- [ ] `dragonfly` container healthy

### Disk Space

```bash
ssh <host> 'df -h /opt/healthcare-backend'
# Required: ≥3 GB free (CI also checks this)
```

- [ ] ≥3 GB free on VPS

### Secrets Validation

- [ ] `DATABASE_URL` set in GitHub Secrets →
      `postgresql://postgres:<pass>@postgres:5432/userdb?schema=public`
- [ ] `JWT_SECRET` set
- [ ] `GITHUB_TOKEN` set (for GHCR auth)
- [ ] `GITHUB_USERNAME` set
- [ ] All other required secrets present

### Backup Status

```bash
ssh <host> 'bash /opt/healthcare-backend/devops/scripts/docker-infra/backup.sh pre-deployment'
# Expected: outputs backup ID like "pre-deployment-2026-08-09-143022"
```

- [ ] Pre-deployment backup completed successfully

### Concurrency

- [ ] No in-flight deploy for production (check GitHub Actions)
- [ ] Previous deploy fully verified (no partial state)

---

## Post-Deploy Checklist (Production)

Run this **after** deploy job completes.

### CI Verification

- [ ] `post-deployment-verification` job passed (HTTP 200 on `/health`)
- [ ] `success-backup` job passed
- [ ] No errors in deploy job logs

### Manual Verification

```bash
# 1. Public health endpoint
curl -s https://backend-service-v1.ishswami.in/health | jq .
# Expected: {"status":"healthy","services":{...}}

# 2. Infra health (from VPS)
# Find the production api container dynamically
PROD_API=$(ssh <host> "docker ps --filter 'name=api-' --filter 'name=preprod' --filter 'name=latest' --format '{{.Names}}' | grep -v preprod | head -1")
ssh <host> "docker exec $PROD_API wget -q --spider http://localhost:8088/infra-health && echo OK"

# 3. Container status
ssh <host> 'docker ps --filter "name=api-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
```

- [ ] `/health` returns 200 with healthy status
- [ ] `/infra-health` returns 200
- [ ] `api-*` and `worker-*` containers running
- [ ] Running image matches expected tag
- [ ] No error logs in API/Worker (last 100 lines)

### Rollback Readiness

- [ ] Previous deployment still available in Coolify (for manual rollback)

---

## Pre-Deploy Checklist (Preprod)

Run this **before** pushing to preprod branch.

### Code Quality

- [ ] All CI checks pass
- [ ] Changes validated on preprod (or it's the first deploy of a feature)
- [ ] Migrations are idempotent / safe for re-run

### Infrastructure Health

```bash
ssh <host> 'docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"'
ssh <host> 'docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"'
```

- [ ] `postgres` container healthy
- [ ] `dragonfly` container healthy

### Disk Space

```bash
ssh <host> 'df -h /opt/healthcare-backend'
# Required: ≥3 GB free (CI also checks this)
```

- [ ] ≥3 GB free on VPS

### Preprod Database

```bash
# Verify preprod DB exists and is accessible (shared postgres container)
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT 1"'
```

- [ ] `userdb_preprod` exists and is accessible
- [ ] `_prisma_migrations` table exists (if not, fresh DB will be created on
      deploy)

### Secrets

- [ ] `.env.preprod` mounted correctly at `/opt/healthcare-preprod/.env.preprod`
- [ ] `DATABASE_URL` points to `userdb_preprod`
- [ ] `DRAGONFLY_KEY_PREFIX` = `healthcare-preprod:`

### Fresh DB Option (if needed)

If preprod DB is corrupted or migrations are broken:

```bash
# DROP and recreate — production is unaffected
ssh <host>
docker exec -i postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"
# Then push to preprod branch → deploy will run migrations fresh
```

- [ ] Fresh DB option: DONE / NOT NEEDED

---

## Post-Deploy Checklist (Preprod)

### CI Verification

- [ ] Deploy job passed
- [ ] `post-deployment-verification` passed
- [ ] No errors in deploy logs

### Manual Verification

```bash
# 1. Public health
curl -s https://preprod-backend.ishswami.in/health | jq .
# Expected: {"status":"healthy",...}

# 2. Infra health
ssh <host> 'docker exec api-ix9fceaxa914diauokjleeis wget -q --spider http://localhost:8088/infra-health && echo OK'

# 3. Containers (Coolify-managed names)
ssh <host> 'docker ps --filter "name=api-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'

# 4. Verify Nginx is routing correctly
PREPROD_NGINX=$(ssh <host> "docker ps --filter 'name=api-ix9' --format '{{.Names}}' | head -1")
ssh <host> "docker exec $PREPROD_NGINX nginx -t && echo 'nginx config OK'"

# 5. Verify DATABASE_URL points to preprod DB
ssh <host> 'docker exec api-ix9fceaxa914diauokjleeis sh -c "echo ${DATABASE_URL:-NOT SET}"'

# 6. Verify queue dashboard accessible
curl -s https://preprod-backend.ishswami.in/queue-dashboard/health
```

- [ ] `/health` returns 200
- [ ] `/infra-health` returns 200
- [ ] `api-ix9fceaxa914diauokjleeis` and `worker-ix9fceaxa914diauokjleeis`
      running
- [ ] Image matches expected `preprod` tag
- [ ] `DATABASE_URL` points to `userdb_preprod`
- [ ] `DRAGONFLY_KEY_PREFIX` = `healthcare-preprod:`
- [ ] Queue dashboard accessible
- [ ] Nginx config valid (port 8090)

### Data Verification

```bash
# Check preprod has data (shared postgres container)
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM users;"'
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM clinics;"'
```

- [ ] Expected tables exist
- [ ] Row counts are reasonable (not 0 unless fresh DB)

---

## Environment Isolation Verification

These checks ensure production and preprod are properly isolated.

```bash
# 1. Networks are separate
docker network ls | grep -E "app-network|preprod-network"
# Should show both networks

# 2. Production DB has only production data
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb -c "\dt"'

# 3. Preprod DB has only preprod data
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "\dt"'

# 4. Containers are on correct networks
ssh <host> 'docker inspect $(docker ps --filter "name=api-" --format "{{.Names}}" | grep -v ix9 | head -1) --format "{{json .NetworkSettings.Networks}}" | jq .'
ssh <host> 'docker inspect api-ix9fceaxa914diauokjleeis --format "{{json .NetworkSettings.Networks}}" | jq .'

# 5. Dragonfly key prefixes don't collide
ssh <host> 'docker exec dragonfly redis-cli --scan --pattern "healthcare-preprod:*" | wc -l'
ssh <host> 'docker exec dragonfly redis-cli --scan --pattern "healthcare:*" | wc -l'
```

- [ ] Networks are separate (`app-network` vs `preprod-network`)
- [ ] Production DB contains only production data
- [ ] Preprod DB contains only preprod data
- [ ] Containers are on their correct networks
- [ ] Cache keys don't collide between environments

---

## Quick Health Dashboard

```bash
# One-liner to check everything
ssh <host> bash -c '
  PROD_API=$(docker ps --filter "name=api-" --format "{{.Names}}" | grep -v ix9 | head -1)
  PROD_WORKER=$(docker ps --filter "name=worker-" --format "{{.Names}}" | head -1)
  PREPROD_NGINX=$(docker ps --filter "name=api-ix9" --format "{{.Names}}" | head -1)
  echo "=== PRODUCTION ==="
  docker ps --filter "name=$PROD_API" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
  docker ps --filter "name=$PROD_WORKER" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "=== PREPROD ==="
  docker ps --filter "name=api-ix9" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
  docker ps --filter "name=worker-ix9" --format "{{.Names}}\t{{.Status}}"
  docker ps --filter "name=$PREPROD_NGINX" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "=== INFRA ==="
  docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"
  docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"
  echo ""
  echo "=== DISK ==="
  df -h /opt/healthcare-backend /opt/healthcare-preprod 2>/dev/null
'
```

---

## Escalation

If any check fails and you cannot resolve within 15 minutes:

| Severity            | Action                                                          |
| ------------------- | --------------------------------------------------------------- |
| Production down     | Rollback via Coolify dashboard                                  |
| Preprod down        | Redeploy via Coolify dashboard                                  |
| Data corruption     | Restore from backup (`restore.sh latest`)                       |
| Infrastructure down | Recreate container with `docker compose up -d --force-recreate` |
| Coolify down        | Check Coolify container logs, restart if needed                 |
