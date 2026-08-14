# Deployment README

Quick-start overview for the healthcare-backend multi-environment CI/CD
pipeline.

---

## Architecture at a Glance

```
GitHub Push (main | preprod)
  │
  ├─ CI Pipeline (GitHub Actions)
  │     ├─ detect-changes → security → docker-build
  │     ├─ ensure-infrastructure-health
  │     ├─ validate-secrets + validate-disk-space
  │     └─ deploy → blue-green deploy via SSH to Contabo VPS
  │
  └─ Contabo VPS (Docker Engine + Coolify/Traefik)
        ├─ Infrastructure (shared, NOT redeployed per app deploy)
        │     ├─ postgres        (userdb + userdb_preprod)
        │     └─ dragonfly
        │
        ├─ Production Stack
        │     ├─ nginx:8088 → Traefik → backend-service-v1.ishswami.in
        │     ├─ latest-api-blue / latest-api-green
        │     └─ latest-worker
        │
        └─ Preprod Stack (separate network + containers)
              ├─ preprod-nginx:8089 → Traefik → preprod-backend.ishswami.in
              ├─ preprod-api
              └─ preprod-worker:9091
```

**Key principle**: Postgres and Dragonfly run once on the VPS and serve BOTH
environments. Each environment has its own database name and cache key prefix.

---

## The Two Environments

| Property            | Preprod                           | Production                        |
| ------------------- | --------------------------------- | --------------------------------- |
| Branch              | `preprod`                         | `main`                            |
| VPS path            | `/opt/healthcare-preprod`         | `/opt/healthcare-backend`         |
| Docker network      | `preprod-network` (172.19.0.0/16) | `app-network`                     |
| Postgres DB         | `userdb_preprod`                  | `userdb`                          |
| Dragonfly prefix    | `healthcare-preprod:`             | `healthcare:`                     |
| Nginx host port     | 8089                              | 8088                              |
| URL                 | `preprod-backend.ishswami.in`     | `backend-service-v1.ishswami.in`  |
| Container prefix    | `preprod-`                        | `latest-`                         |
| Deploy strategy     | Rolling (deploy.sh)               | Blue-Green (blue-green-deploy.sh) |
| DB migration target | `userdb_preprod`                  | `userdb`                          |
| Approval gate       | None (auto-deploy)                | Manual approval required          |

---

## Deploy Strategies

### Production: Blue-Green (Zero Downtime)

Only **API** and **Worker** containers are redeployed. Infra (postgres,
dragonfly) is untouched.

1. Detect active color (blue or green) from `upstream.conf`
2. Start new containers on the **inactive** color
3. Health check new containers (`/infra-health`)
4. Atomically switch `upstream.conf` → reload nginx
5. Drain old containers (120s grace period)
6. Old containers removed

**Rollback**: Automatic — on any failure, old containers keep serving.

### Preprod: Rolling Deploy

Only **API** and **Worker** containers are redeployed. Infra untouched.

1. Tag current image as `rollback-backup-<timestamp>`
2. Stop & remove `preprod-api` + `preprod-worker`
3. Run Prisma migrations against `userdb_preprod`
4. Start new containers with fresh image
5. Verify image IDs match expected
6. Health check (`/infra-health`, up to 360s)
7. Post-deploy verification (containers, images, health, env vars)

**Rollback**: Explicit — `rollback_to_backup_image()` retags backup and
recreates.

---

## File Map

| File                                               | Purpose                                         |
| -------------------------------------------------- | ----------------------------------------------- |
| `DEPLOYMENT_PLAN.md`                               | Full operational reference (this doc's parent)  |
| `DEPLOYMENT_RUNBOOK.md`                            | Step-by-step procedures for every scenario      |
| `DEPLOYMENT_STATUS_CHECK.md`                       | Pre/post deploy checklist                       |
| `DEPLOYMENT_VERIFICATION.md`                       | Verification procedures and acceptance criteria |
| `devops/scripts/docker-infra/deploy.sh`            | Rolling deploy (preprod, local)                 |
| `devops/scripts/docker-infra/blue-green-deploy.sh` | Blue-green deploy (production)                  |
| `devops/scripts/docker-infra/health-check.sh`      | Infrastructure health checker                   |
| `devops/scripts/docker-infra/backup.sh`            | Database + Dragonfly backup                     |
| `devops/scripts/docker-infra/restore.sh`           | Database + Dragonfly restore                    |
| `devops/scripts/docker-infra/verify.sh`            | Post-deploy verification                        |
| `devops/scripts/docker-infra/diagnose.sh`          | Diagnostic tool                                 |
| `devops/docker/docker-compose.prod.yml`            | Production stack definition                     |
| `devops/docker/docker-compose.preprod.yml`         | Preprod stack definition                        |
| `.github/workflows/ci.yml`                         | Full CI/CD pipeline                             |
| `devops/docker/nginx/nginx.conf`                   | Internal nginx config                           |
| `devops/docker/nginx/upstream.conf`                | Dynamic upstream (blue-green)                   |

---

## Quick Commands

```bash
# Deploy preprod (push to preprod branch → auto CI deploy)
git push origin preprod

# Deploy production (push to main → requires manual approval in GitHub Environments)
git push origin main

# Manual rolling deploy on VPS
ssh <user>@<host>
cd /opt/healthcare-preprod
bash devops/scripts/docker-infra/deploy.sh --env preprod

# Manual blue-green deploy on VPS
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --container-prefix "latest-" --service "api" \
  --network "app-network" \
  --upstream-conf ./nginx/upstream.conf \
  --nginx-container "latest-nginx" \
  --health-endpoint "/infra-health" --health-timeout 180 \
  --health-interval 5 --drain-timeout 120 --drain-interval 5 \
  --api-port 8088

# Health check
ssh <host> 'bash /opt/healthcare-backend/devops/scripts/docker-infra/health-check.sh'

# Post-deploy verification
ssh <host> 'bash /opt/healthcare-backend/devops/scripts/docker-infra/verify.sh'

# Tail logs
ssh <host> 'docker logs --tail 50 preprod-api 2>&1'
ssh <host> 'docker logs --tail 50 preprod-worker 2>&1'

# Check running containers
ssh <host> 'docker ps --filter "name=preprod-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
```

---

## Preprod Database Strategy

Preprod uses the **same PostgreSQL instance** as production but with a separate
database:

```
PostgreSQL (single container: preprod-postgres)
  ├─ userdb         ← Production data
  └─ userdb_preprod ← Preprod data (isolated, safe to migrate freely)
```

**Why this works**:

- Completely separate data — preprod migrations cannot affect production
- No additional infrastructure cost (shared Postgres + Dragonfly)
- `depends_on: service_healthy` ensures DB is ready before app starts
- `DATABASE_URL` in `.env.preprod` points to `userdb_preprod`

**Fresh preprod DB** (when needed):

```bash
ssh <host>
docker exec -i preprod-postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i preprod-postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"
# Then deploy — migrations will recreate all tables
```

---

## Related Documents

| Document                     | Read when...                               |
| ---------------------------- | ------------------------------------------ |
| `DEPLOYMENT_PLAN.md`         | Need full operational reference            |
| `DEPLOYMENT_RUNBOOK.md`      | Performing or troubleshooting a deployment |
| `DEPLOYMENT_STATUS_CHECK.md` | Before/after deploy verification           |
| `DEPLOYMENT_VERIFICATION.md` | Deep verification procedures               |
| `COOLIFY_MIGRATION.md`       | Coolify/Traefik ingress questions          |
| `AGENTS.md`                  | Project conventions and rules              |
