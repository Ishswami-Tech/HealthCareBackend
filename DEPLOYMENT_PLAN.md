# Deployment Plan

Operational manual for the healthcare-backend multi-environment CI/CD pipeline.
This document reflects the **actual current implementation** — verified against
the codebase.

> **Important — Coolify migration is in progress:** Coolify currently manages
> Traefik ingress, SSL termination, and the `coolify` Docker network. Portainer
> remains active for container orchestration, stack management, and backups.
> GitHub Actions directly executes `blue-green-deploy.sh` and `deploy.sh` over
> SSH. The long-term goal is full Coolify ownership of runtime; today Coolify is
> the ingress layer only.
>
> **Companion docs:**
>
> - `COOLIFY_MIGRATION.md` — Coolify/Traefik ingress architecture and
>   operational rules
> - `AGENTS.md` — Project root instructions
> - `.github/workflows/ci.yml` — Full CI pipeline definition

---

## 1. Environments

| Env        | Branch    | Host        | Container prefix | Env file          | URL                                      |
| ---------- | --------- | ----------- | ---------------- | ----------------- | ---------------------------------------- |
| preprod    | `preprod` | Contabo VPS | `preprod-`       | `.env.preprod`    | `https://preprod-backend.ishswami.in`    |
| production | `main`    | Contabo VPS | `latest-`        | `.env.production` | `https://backend-service-v1.ishswami.in` |

Both VPS hosts run:

- Docker Engine 24+ with Compose plugin
- Coolify-managed Traefik reverse proxy (external `coolify` Docker network)
- Repo checkout at `/opt/healthcare-backend`
- Healthcheck endpoint at `GET /infra-health` → `200 OK` with JSON status

---

## 2. Complete CI/CD Pipeline

The single workflow file `.github/workflows/ci.yml` handles all environments.
The branch name resolves which environment and deploy strategy to use.

### 2.1 Pipeline Jobs (execution order on push)

```
push to main or preprod
  │
  ├─ 1. detect-changes         What changed? (infra / app / both) — does NOT branch pipeline
  ├─ 2. security               Trivy vulnerability scan + npm audit-ci (moderate+) — continue-on-error
  ├─ 3. docker-build           Build multi-arch image → push to ghcr.io with tags
  ├─ 4. ensure-infrastructure-health   SSH to VPS → run health-check.sh (postgres + dragonfly)
  ├─ 5. validate-secrets       Verify all required secrets/variables are non-empty
  ├─ 6. validate-disk-space    SSH to VPS → ensure ≥3 GB free disk space
  ├─ 7. deploy                 Blue-green deploy via blue-green-deploy.sh (both environments; preprod uses 8089/separate network)
  │     ├─ 7a. Construct .env on VPS
  │     ├─ 7b. Copy compose files, nginx configs, blue-green-deploy.sh to VPS
  │     ├─ 7c. Run Prisma migrations (continue-on-error — handled downstream)
  │     └─ 7d. Blue-green deploy API
  │     └─ 7e. Blue-green deploy Worker
  ├─ 8. post-deployment-verification  Curl /health via public subdomain (3 retries × 10s)
  ├─ 9. success-backup          (production only) Run backup.sh success on VPS
  └─ 10. portainer-sync         (optional, continue-on-error) Update Portainer stack metadata
```

### 2.2 Pipeline Jobs (PR only)

```
PR targeting main or preprod
  │
  ├─ 1. validate-pr             Enforce preprod → main promotion flow only
  │     ├─ Reject PRs targeting main from any branch other than preprod
  │     ├─ yarn type-check
  │     ├─ yarn lint:check
  │     └─ npx audit-ci@7.1.0 --moderate
  └─ (no deploy — validation only)
```

### 2.3 Environment Resolution

The `resolve-env` step in each job derives these values from the branch:

| Variable           | Production (`main`)              | Preprod (`preprod`)           |
| ------------------ | -------------------------------- | ----------------------------- |
| `DEPLOY_ENV`       | `production`                     | `preprod`                     |
| `COMPOSE_FILE`     | `docker-compose.prod.yml`        | `docker-compose.preprod.yml`  |
| `CONTAINER_PREFIX` | `latest-`                        | `preprod-`                    |
| `DOCKER_NETWORK`   | `app-network`                    | `preprod-network`             |
| `NGINX_PORT`       | `8088`                           | `8089`                        |
| `API_PORT`         | `8088`                           | `8088`                        |
| `API_SUBDOMAIN`    | `backend-service-v1.ishswami.in` | `preprod-backend.ishswami.in` |
| `ENV_FILE`         | `.env.production`                | `.env.preprod`                |

---

## 3. Blue-Green Deploy (Production)

Script: `devops/scripts/docker-infra/blue-green-deploy.sh`

Executed **per service** (API, then Worker) via SSH from CI. Zero-downtime
traffic switch.

### 3.1 Blue-Green Flow
