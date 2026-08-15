# Deployment Plan

Operational manual for the healthcare-backend multi-environment CI/CD pipeline.
This document reflects the **actual current implementation** — verified against
the running server and codebase.

> **Both environments use Coolify blue-green deploys.**
>
> - **Preprod**: Active — Coolify-managed containers with Traefik ingress +
>   Let's Encrypt SSL for `preprod-backend.ishswami.in`
> - **Production**: Gated off — will be enabled after preprod validation. Same
>   Coolify blue-green mechanism, managed via `coolify-deploy.sh`.
>
> **CI pipeline**: GitHub Actions builds image → pushes to GHCR → SSH to VPS →
> calls Coolify API → Coolify handles blue-green lifecycle.
>
> **Companion docs:**
>
> - `DEPLOYMENT_RUNBOOK.md` — Step-by-step deploy commands
> - `DEPLOYMENT_VERIFICATION.md` — Post-deploy verification steps
> - `DEPLOYMENT_STATUS_CHECK.md` — Quick health check commands
> - `.github/workflows/ci.yml` — Full CI pipeline definition

---

## 1. Environments

| Env        | Branch    | Host        | Container prefix | Management | URL                                      |
| ---------- | --------- | ----------- | ---------------- | ---------- | ---------------------------------------- |
| preprod    | `preprod` | Contabo VPS | Coolify auto     | Coolify    | `https://preprod-backend.ishswami.in`    |
| production | `main`    | Contabo VPS | Coolify auto     | Coolify ⏸  | `https://backend-service-v1.ishswami.in` |

> ⏸ Production Coolify app is created but deploys are **gated off** via
> `ENABLE_PROD_DEPLOY` flag.

Both environments share the same VPS and use the same Docker network (`coolify`
network bridges external traffic via Traefik).

### Production Container Stack

| Container       | Image                           | Role                        |
| --------------- | ------------------------------- | --------------------------- |
| `api-<uuid>`    | healthcare-api:main-<sha>       | NestJS API server (Coolify) |
| `worker-<uuid>` | healthcare-api:main-<sha>       | BullMQ worker (Coolify)     |
| `postgres`      | postgres:<version>              | PostgreSQL database         |
| `dragonfly`     | dragonflydb/dragonfly:<version> | Cache (Redis-compatible)    |

> Container names are Coolify-managed (prefixed `api-` / `worker-`).

### Preprod Container Stack (Coolify-managed)

| Container       | Management | Routing                                 |
| --------------- | ---------- | --------------------------------------- |
| `api-<uuid>`    | Coolify    | Traefik → `preprod-backend.ishswami.in` |
| `worker-<uuid>` | Coolify    | No external routing                     |

Coolify's Traefik proxy (`coolify-proxy`) handles SSL termination via Let's
Encrypt. Docker labels on containers define routing rules.

---

## 2. Complete CI/CD Pipeline

The single workflow file `.github/workflows/ci.yml` handles all environments.
The branch name resolves which environment and deploy strategy to use.

### 2.1 Pipeline Jobs (push to main or preprod)

```
push to preprod or main
  │
  ├─ 1. detect-changes         What changed? (infra / app / both)
  ├─ 2. security               Trivy + npm audit-ci — continue-on-error
  ├─ 3. docker-build           Multi-arch build → push ghcr.io with tags
  ├─ 4. ensure-infrastructure-health   SSH → health-check.sh (postgres + dragonfly)
  ├─ 5. pre-deployment-backup  (both envs) backup.sh pre-deployment
  ├─ 6. deploy
  │     ├─ preprod (preprod branch):  Coolify API deploy (--wait --force)
  │     └─ production (main branch):  Coolify API deploy (--wait --force)
  │         ⏸ Gated by ENABLE_PROD_DEPLOY flag until preprod validated
  ├─ 7. post-deployment-verification  Curl /health via public subdomain (3 retries)
  ├─ 8. post-deployment-backup        (both envs) backup.sh success
  └─ 9. portainer-sync         (optional) Update Portainer metadata
```

### 2.2 Deploy Mechanism (both environments)

Both environments use the **same Coolify blue-green mechanism**:

```bash
# SSH to VPS, then call Coolify API
ssh $SERVER_USER@$SERVER_HOST "
  cd $DEPLOY_PATH
  COOLIFY_API_TOKEN=$COOLIFY_API_TOKEN \
  COOLIFY_APP_UUID=$APP_UUID \
  bash devops/scripts/docker-infra/coolify-deploy.sh \
    --app-uuid $APP_UUID \
    --image ghcr.io/repo/healthcare-api:$TAG \
    --wait \
    --force
"
```

Coolify handles:

- Spinning up new container (green)
- Health checking the new container
- Swapping traffic (blue → green)
- Draining and removing old container (blue)
- Automatic rollback on failure

**No manual SSH scripts needed.** The `blue-green-deploy.sh` and `deploy.sh`
scripts are kept as fallback/reference but not used in CI.

---

### 2.3 Pipeline Jobs (PR only)

```
PR targeting main or preprod
  │
  ├─ 1. validate-pr             Enforce preprod → main promotion flow
  │     ├─ Reject PRs targeting main from non-preprod
  │     ├─ type-check
  │     ├─ lint:check
  │     └─ audit-ci moderate+
  └─ (no deploy)
```

### 2.4 Production Gate

Production deploys (push to `main`) are **gated by `ENABLE_PROD_DEPLOY=true`**.

**To enable production deploys:**

1. Set `ENABLE_PROD_DEPLOY=true` as a repository variable in GitHub
2. Ensure `COOLIFY_PROD_APP_UUID` secret is configured
3. Ensure production Coolify app is configured with correct Docker network, env
   vars, and health checks

**Current state:** `ENABLE_PROD_DEPLOY=false` — only preprod deploys are active.

### 2.4 Required GitHub Secrets/Variables

| Name                       | Type      | Purpose                                    |
| -------------------------- | --------- | ------------------------------------------ |
| `SERVER_USER`              | Secret    | SSH user on Contabo VPS                    |
| `SERVER_HOST`              | Secret    | VPS hostname/IP                            |
| `SERVER_DEPLOY_PATH`       | Secret    | Path to healthcare-backend on VPS          |
| `SSH_PRIVATE_KEY`          | Secret    | Deploy SSH key                             |
| `COOLIFY_API_TOKEN`        | Secret    | Coolify API token (both envs)              |
| `COOLIFY_PREPROD_APP_UUID` | Secret    | Coolify app UUID for preprod               |
| `COOLIFY_PROD_APP_UUID`    | Secret    | Coolify app UUID for production            |
| `GITHUB_TOKEN`             | Automatic | For GitHub API calls (auto-provided)       |
| `ENABLE_PROD_DEPLOY`       | Variable  | `true`/`false` — enable production deploys |

---

---

## 3. Coolify Deploy (Both Environments)

Both production and preprod use the **same Coolify blue-green mechanism** via
`devops/scripts/docker-infra/coolify-deploy.sh`.

Script: `devops/scripts/docker-infra/coolify-deploy.sh`

### 3.1 CI Call (Preprod)

```bash
COOLIFY_API_TOKEN=<token> \
COOLIFY_APP_UUID=ix9fceaxa914diauokjleeis \
ENABLE_PROD_DEPLOY=false \
bash devops/scripts/docker-infra/coolify-deploy.sh \
  --app-uuid ix9fceaxa914diauokjleeis \
  --image ghcr.io/Ishswami-Tech/HealthCareBackend:preprod-<sha> \
  --wait --force
```

### 3.2 CI Call (Production)

```bash
COOLIFY_API_TOKEN=<token> \
COOLIFY_APP_UUID=<prod-uuid> \
ENABLE_PROD_DEPLOY=true \
bash devops/scripts/docker-infra/coolify-deploy.sh \
  --app-uuid <prod-uuid> \
  --image ghcr.io/Ishswami-Tech/HealthCareBackend:main-<sha> \
  --wait --force
```

### 3.3 What Coolify Handles

- Spinning up new container (green slot)
- Health checking the new container
- Swapping traffic (blue → green)
- Draining and removing old container (blue)
- Automatic rollback on failure

**No manual SSH scripts needed.** The `blue-green-deploy.sh` and `deploy.sh`
scripts are kept as fallback/reference but not used in CI.

---

## 4. Coolify App Configuration

### Preprod (Active)

| Property              | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| Coolify Resource UUID | `ix9fceaxa914diauokjleeis`                              |
| Environment           | `preprod`                                               |
| Image                 | `ghcr.io/Ishswami-Tech/HealthCareBackend:preprod-<sha>` |
| Network               | `preprod-network`                                       |
| Database              | `userdb_preprod`                                        |
| URL                   | `preprod-backend.ishswami.in`                           |

### Production (Gated Off)

| Property              | Value                                                |
| --------------------- | ---------------------------------------------------- |
| Coolify Resource UUID | See `COOLIFY_PROD_APP_UUID` secret                   |
| Environment           | `production`                                         |
| Image                 | `ghcr.io/Ishswami-Tech/HealthCareBackend:main-<sha>` |
| Network               | `app-network`                                        |
| Database              | `userdb`                                             |
| URL                   | `backend-service-v1.ishswami.in`                     |

### Shared Settings

- Coolify auto-generates `api-<uuid>` and `worker-<uuid>` container names
- Traefik proxy handles SSL via Let's Encrypt (Docker labels)
- Prisma migrations run on container startup

---

## 5. Environment Variables

### Production (`.env.production` on VPS)

- `DATABASE_URL` — PostgreSQL connection
- `JWT_SECRET` — JWT signing key
- `DRAGONFLY_URL` — DragonflyDB connection
- `NODE_ENV=production`

### Preprod (`.env.preprod` on VPS, also in Coolify)

- `DATABASE_URL` — PostgreSQL connection (preprod database)
- Same keys as production

---

## 6. Networking

| Network           | Used By    | Purpose                          |
| ----------------- | ---------- | -------------------------------- |
| `preprod-network` | Preprod    | Preprod containers (Coolify)     |
| `app-network`     | Production | Production containers (Coolify)  |
| `coolify`         | Both       | External ingress (Traefik proxy) |

Port mappings:

- **External**: 80/443 → Coolify Traefik proxy
- **Preprod API**: Traefik routes `preprod-backend.ishswami.in` → api container
  :8088
- **Production API**: Traefik routes `backend-service-v1.ishswami.in` → api
  container :8088

---

## 7. Rollback

### Both Environments (Coolify auto-rollback)

Coolify automatically rolls back if the health check fails during deployment.

### Manual Rollback

```bash
# Via Coolify dashboard
# 1. Open http://<vps-ip>:8000
# 2. Navigate to the application (preprod or production)
# 3. Select "Rollback" and choose the previous deployment

# Via Coolify API
curl -X POST "http://localhost:8000/api/v1/applications/<app-uuid>/deploy" \
  -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

**Note**: Use the Coolify dashboard to select which previous deployment to roll
back to. Coolify keeps deployment history.

```bash
# Via Coolify UI or API: redeploy previous image tag
# Coolify handles zero-downtime rollback
```
