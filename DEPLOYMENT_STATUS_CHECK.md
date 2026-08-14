# Deployment Status Check

Pre-deploy and post-deploy checklist for both production and preprod
environments.

> **Critical**: Only API and Worker containers are deployed/recreated. Postgres,
> Dragonfly, and Nginx are untouched for app-only deploys.

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
ssh <host> 'bash /opt/healthcare-backend/devops/scripts/docker-infra/health-check.sh'
# Expected: {"status":"healthy",...}
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
- [ ] All other required secrets present (`.env.production` mapped to GitHub
      Secrets)

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
ssh <host> 'docker exec latest-api wget -q --spider http://localhost:8088/infra-health && echo OK'

# 3. Container status
ssh <host> 'docker ps --filter "name=latest-api" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=latest-worker" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'

# 4. Nginx upstream
ssh <host> 'cat /opt/healthcare-backend/nginx/upstream.conf'

# 5. Running image SHA matches deployed SHA
ssh <host> 'docker inspect latest-api --format "{{.Config.Image}} {{.Image}}"'
```

- [ ] `/health` returns 200 with healthy status
- [ ] `/infra-health` returns 200
- [ ] `latest-api` and `latest-worker` containers running
- [ ] Running image SHA matches expected tag
- [ ] Nginx upstream.conf points to active container
- [ ] No error logs in API/Worker (last 100 lines)

### Rollback Readiness

- [ ] `rollback-backup-<timestamp>` image still exists (cleanup only runs after
      success)
- [ ] Previous container (blue/green) still exists during drain period

---

## Pre-Deploy Checklist (Preprod)

Run this **before** pushing to preprod branch.

### Code Quality

- [ ] All CI checks pass
- [ ] Changes validated on preprod (or it's the first deploy of a feature)
- [ ] Migrations are idempotent / safe for re-run

### Infrastructure Health

```bash
ssh <host> 'bash /opt/healthcare-preprod/devops/scripts/docker-infra/health-check.sh'
```

- [ ] `preprod-postgres` container healthy
- [ ] `preprod-dragonfly` container healthy

### Disk Space

```bash
ssh <host> 'df -h /opt/healthcare-preprod'
```

- [ ] ≥3 GB free

### Preprod Database

```bash
# Verify preprod DB exists and is accessible
ssh <host> 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT 1"'
```

- [ ] `userdb_preprod` exists and is accessible
- [ ] `_prisma_migrations` table exists (if not, fresh DB will be created on
      deploy)

### Secrets

- [ ] `.env.preprod` has correct `DATABASE_URL` →
      `postgresql://postgres:<pass>@preprod-postgres:5432/userdb_preprod`
- [ ] Dragonfly prefix set to `healthcare-preprod:`
- [ ] Cache prefix set to `healthcare-preprod:`
- [ ] Worker port `9091` is free on VPS

### Fresh DB Option (if needed)

If preprod DB is corrupted or migrations are broken:

```bash
# DROP and recreate — production is unaffected
ssh <host>
docker exec -i preprod-postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i preprod-postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"
# Then push to preprod branch → deploy will run migrations fresh
```

- [ ] Fresh DB option: DONE / NOT NEEDED

---

## Post-Deploy Checklist (Preprod)

### CI Verification

- [ ] Deploy job passed
- [ ] `post-deployment-verification` passed (or ran with acceptable warnings)
- [ ] No errors in deploy logs

### Manual Verification

```bash
# 1. Public health
curl -s https://preprod-backend.ishswami.in/health | jq .
# Expected: {"status":"healthy",...}

# 2. Infra health
ssh <host> 'docker exec preprod-api wget -q --spider http://localhost:8088/infra-health && echo OK'

# 3. Containers
ssh <host> 'docker ps --filter "name=preprod-api" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=preprod-worker" --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'

# 4. Verify Nginx is routing correctly
ssh <host> 'docker exec preprod-nginx nginx -t && echo "nginx config OK"'

# 5. Verify DATABASE_URL points to preprod DB
ssh <host> 'docker exec preprod-api sh -c "echo \${DATABASE_URL:-NOT SET}"'

# 6. Verify queue dashboard accessible
curl -s https://preprod-backend.ishswami.in/queue-dashboard/health
```

- [ ] `/health` returns 200
- [ ] `/infra-health` returns 200
- [ ] `preprod-api` and `preprod-worker` running
- [ ] Image SHA matches expected
- [ ] `DATABASE_URL` points to `userdb_preprod`
- [ ] `DRAGONFLY_KEY_PREFIX` = `healthcare-preprod:`
- [ ] Queue dashboard accessible
- [ ] Worker healthcheck passes
- [ ] Nginx config valid

### Data Verification

```bash
# Check preprod has data
ssh <host> 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM users;"'
ssh <host> 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM clinics;"'
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
ssh <host> 'docker exec -i preprod-postgres psql -U postgres -d userdb_preprod -c "\dt"'

# 4. Containers are on correct networks
ssh <host> 'docker inspect preprod-api --format "{{json .NetworkSettings.Networks}}" | jq .'
ssh <host> 'docker inspect latest-api --format "{{json .NetworkSettings.Networks}}" | jq .'

# 5. Dragonfly key prefixes don't collide
ssh <host> 'docker exec preprod-dragonfly redis-cli --scan --pattern "healthcare-preprod:*" | wc -l'
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
  echo "=== PRODUCTION ==="
  docker ps --filter "name=latest-" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "=== PREPROD ==="
  docker ps --filter "name=preprod-" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
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

| Severity             | Action                                                         |
| -------------------- | -------------------------------------------------------------- |
| Production down      | Rollback via blue-green (automatic) or manual redeploy         |
| Preprod down         | Redeploy with `deploy.sh --env preprod`                        |
| Data corruption      | Restore from backup (`restore.sh latest`)                      |
| Infrastructure down  | `docker compose up -d --force-recreate` with volumes preserved |
| Complete server loss | Follow Disaster Recovery procedure                             |

See `DEPLOYMENT_RUNBOOK.md` section
[12. Common Troubleshooting](#12-common-troubleshooting) for detailed steps.
