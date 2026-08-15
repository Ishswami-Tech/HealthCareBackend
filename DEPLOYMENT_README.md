# Deployment README

Quick-start overview for the healthcare-backend multi-environment CI/CD pipeline
on Contabo VPS, managed by Coolify + Traefik.

---

## Architecture at a Glance

```
GitHub Push (main | preprod)
  │
  ├─ CI Pipeline (GitHub Actions)
  │     ├─ detect-changes → security → docker-build
  │     ├─ ensure-infrastructure-health
  │     ├─ validate-secrets + validate-disk-space
  │     └─ deploy → Coolify API trigger over SSH
  │
  └─ Contabo VPS (Docker Engine + Coolify/Traefik)
        ├─ Infrastructure (shared, NOT redeployed per app deploy)
        │     ├─ postgres (postgres:18)        — serves both envs
        │     │     ├─ userdb        ← Production
        │     │     └─ userdb_preprod ← Preprod
        │     └─ dragonfly                        — shared cache
        │
        ├─ Production Stack (Coolify-managed, gated off)
        │     ├─ Traefik → backend-service-v1.ishswami.in
        │     ├─ api-<uuid>  (Coolify-managed, image tag: main-<sha>)
        │     └─ worker-<uuid> (Coolify-managed)
        │
        └─ Preprod Stack (Coolify resource: ix9fceaxa914diauokjleeis)
              ├─ Traefik → preprod-backend.ishswami.in
              ├─ api-ix9fceaxa914diauokjleeis
              └─ worker-ix9fceaxa914diauokjleeis
```

**Key principle**: Postgres and Dragonfly run once on the VPS and serve BOTH
environments. Each environment has its own database name and cache key prefix.

---

## Traffic Flow

```
Internet → coolify-proxy (Traefik, ports 80/443)
           ├── preprod-backend.ishswami.in → api-ix9fceaxa914diauokjleeis:8080
           └── backend-service-v1.ishswami.in → api-<prod-uuid>:8080
```

Coolify automatically configures Traefik routing rules for each managed app. No
custom nginx proxy is needed for either environment.

---

## The Two Environments

| Property            | Preprod                           | Production                       |
| ------------------- | --------------------------------- | -------------------------------- |
| Branch              | `preprod`                         | `main`                           |
| Coolify Resource    | `ix9fceaxa914diauokjleeis`        | `prod-app-uuid`                  |
| Container prefix    | `api-` / `worker-`                | `api-` / `worker-`               |
| Docker network      | `preprod-network` (172.19.0.0/16) | `app-network`                    |
| Postgres DB         | `userdb_preprod`                  | `userdb`                         |
| Dragonfly prefix    | `healthcare-preprod:`             | `healthcare:`                    |
| URL                 | `preprod-backend.ishswami.in`     | `backend-service-v1.ishswami.in` |
| Deploy trigger      | Coolify API (push to `preprod`)   | Coolify API (push to `main`)     |
| DB migration target | `userdb_preprod`                  | `userdb`                         |
| Approval gate       | None (auto-deploy)                | ENABLE_PROD_DEPLOY=true required |

---

## Deploy Strategies

### Production: Coolify-managed

Deployment is triggered via Coolify API. Coolify handles image pull, container
recreation, and health checks.

1. Push to `main` → GitHub Actions (gated by `ENABLE_PROD_DEPLOY=true`)
2. CI builds and pushes image to `ghcr.io`
3. CI calls Coolify API to trigger deployment of production app
4. Coolify recreates `api-<uuid>` + `worker-<uuid>` containers
5. Health check via `/infra-health`
6. CI verifies public endpoint at `backend-service-v1.ishswami.in/health`

### Preprod: Coolify-managed

1. Push to `preprod` → GitHub Actions
2. CI builds and pushes image
3. CI calls Coolify API to trigger deployment of `ix9fceaxa914diauokjleeis`
4. Coolify recreates `api-ix9fceaxa914diauokjleeis` +
   `worker-ix9fceaxa914diauokjleeis`
5. Prisma migrations run inside the api container on startup
6. Health check via `/infra-health`

**Note**: There are NO legacy scripts (`deploy.sh`, `blue-green-deploy.sh`) for
the Coolify-managed stacks. All deploy logic lives in Coolify + CI.

---

## Coolify API Token

> **Security**: The token is stored as a GitHub Actions secret
> (`COOLIFY_API_TOKEN`). It is **never** committed to the repository. Rotate it
> via the Coolify dashboard (`Settings → API Tokens`) if it was ever exposed.

The CI uses this token to trigger Coolify deploys:

| Stack      | Resource UUID                  |
| ---------- | ------------------------------ |
| Preprod    | `ix9fceaxa914diauokjleeis`     |
| Production | `COOLIFY_PROD_APP_UUID` secret |

**Deploy endpoint**:
`POST http://<coolify-host>:8000/api/v1/applications/<uuid>/deploy`

---

## File Map

| File                                                   | Purpose                                         |
| ------------------------------------------------------ | ----------------------------------------------- |
| `DEPLOYMENT_PLAN.md`                                   | Full operational reference (this doc's parent)  |
| `DEPLOYMENT_RUNBOOK.md`                                | Step-by-step procedures for every scenario      |
| `DEPLOYMENT_STATUS_CHECK.md`                           | Pre/post deploy checklist                       |
| `DEPLOYMENT_VERIFICATION.md`                           | Verification procedures and acceptance criteria |
| `devops/scripts/docker-infra/health-check.sh`          | Infrastructure health checker                   |
| `devops/scripts/docker-infra/backup.sh`                | Database + Dragonfly backup                     |
| `devops/scripts/docker-infra/restore.sh`               | Database + Dragonfly restore                    |
| `devops/scripts/docker-infra/verify.sh`                | Post-deploy verification                        |
| `devops/scripts/docker-infra/diagnose.sh`              | Diagnostic tool                                 |
| `devops/docker/docker-compose.prod.yml`                | Production stack definition                     |
| `devops/docker/docker-compose.preprod.yml`             | Preprod stack definition                        |
| `.github/workflows/ci.yml`                             | Full CI/CD pipeline                             |
| `services/ix9fceaxa914diauokjleeis/docker-compose.yml` | Coolify preprod stack (source of truth)         |

---

## Quick Commands

```bash
# Deploy preprod (push to preprod branch → auto CI deploy)
git push origin preprod

# Deploy production (push to main → requires ENABLE_PROD_DEPLOY=true)
git push origin main

# Check running containers (production — gated off)
ssh <host> 'docker ps --filter "name=api-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'

# Check preprod containers
ssh <host> 'docker ps --filter "name=api-ix9" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'
ssh <host> 'docker ps --filter "name=worker-ix9" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'

# Tail logs (production — gated off)
ssh <host> 'docker logs --tail 50 $(docker ps --filter "name=api-" --format "{{.Names}}" | head -1) 2>&1'
ssh <host> 'docker logs --tail 50 $(docker ps --filter "name=worker-" --format "{{.Names}}" | head -1) 2>&1'

# Tail logs (preprod)
ssh <host> 'docker logs --tail 50 api-ix9fceaxa914diauokjleeis 2>&1'
ssh <host> 'docker logs --tail 50 worker-ix9fceaxa914diauokjleeis 2>&1'

# Health endpoints
curl -s https://backend-service-v1.ishswami.in/health | jq .
curl -s https://preprod-backend.ishswami.in/health | jq .

# Infrastructure health
ssh <host> 'docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"'
ssh <host> 'docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"'
```

---

## Preprod Database Strategy

Preprod uses the **same PostgreSQL container** as production but with a separate
database:

```
PostgreSQL (container: postgres, image: postgres:18)
  ├─ userdb         ← Production data
  └─ userdb_preprod ← Preprod data (isolated, safe to migrate freely)
```

**Why this works**:

- Completely separate data — preprod migrations cannot affect production
- No additional infrastructure cost (shared Postgres + Dragonfly)
- `DATABASE_URL` in `.env.preprod` points to `userdb_preprod`

**Fresh preprod DB** (when needed):

```bash
ssh <host>
docker exec -i postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"
# Then redeploy via Coolify → migrations will recreate all tables
```

---

## Preprod Stack Details

The preprod stack is managed by Coolify (resource UUID:
`ix9fceaxa914diauokjleeis`).

### Source of truth

The Coolify-generated `docker-compose.yml` lives at:

```
/data/coolify/services/ix9fceaxa914diauokjleeis/docker-compose.yml
```

### Containers

| Container name                    | Image                                   | Network                  | Port mapping               |
| --------------------------------- | --------------------------------------- | ------------------------ | -------------------------- |
| `api-ix9fceaxa914diauokjleeis`    | `localhost:5000/healthcare-api:preprod` | preprod-network, coolify | Host 8087 → container 8080 |
| `worker-ix9fceaxa914diauokjleeis` | `localhost:5000/healthcare-api:preprod` | preprod-network, coolify | No host port               |

### Environment

| Variable               | Value                                               |
| ---------------------- | --------------------------------------------------- |
| `NODE_ENV`             | `production`                                        |
| `DATABASE_URL`         | Points to `postgres:172.19.0.2:5432/userdb_preprod` |
| `DRAGONFLY_HOST`       | `dragonfly` (shared)                                |
| `DRAGONFLY_KEY_PREFIX` | `healthcare-preprod:`                               |
| `CACHE_PROVIDER`       | `dragonfly`                                         |

### Deploy via Coolify API

```bash
# Trigger preprod deploy
curl -X POST "http://<coolify-host>:8000/api/v1/applications/ix9fceaxa914diauokjleeis/deploy" \
  -H "Authorization: Bearer GffEL3VJgAem16F5j2spVcC1X5IhBzFfIqYt4vQI3a7e489f" \
  -H "Content-Type: application/json"
```

---

## Related Documents

| Document                     | Read when...                               |
| ---------------------------- | ------------------------------------------ |
| `DEPLOYMENT_PLAN.md`         | Need full operational reference            |
| `DEPLOYMENT_RUNBOOK.md`      | Performing or troubleshooting a deployment |
| `DEPLOYMENT_STATUS_CHECK.md` | Before/after deploy verification           |
| `DEPLOYMENT_VERIFICATION.md` | Deep verification procedures               |
