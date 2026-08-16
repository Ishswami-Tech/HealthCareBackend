# Deployment Architecture

## Current Architecture (2026-08-15)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  COOLIFY MANAGES PREPROD                                               │
│                                                                         │
│  CI builds image → pushes to GHCR → transfers to local registry →     │
│  calls coolify-deploy.sh → Coolify API → blue-green deploy            │
│                                                                         │
│  preprod-network (bridge):                                             │
│    api-ix9fceaxa914diauokjleeis:8080  (Coolify-managed)               │
│    worker-ix9fceaxa914diauokjleeis:8088 (Coolify-managed)             │
│    postgres:5432   (shared infra, not Coolify-managed)                │
│    dragonfly:6379  (shared infra, not Coolify-managed)                │
│    coolify-proxy:80/443 (Traefik, Coolify ingress)                    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  DOCKER-COMPOSE MANAGES PRODUCTION (NOT Coolify)                       │
│                                                                         │
│  CI builds image → pushes to GHCR → (currently gated off)             │
│                                                                         │
│  app-network (bridge):                                                 │
│    latest-api:8088   (docker-compose.prod.yml)                         │
│    latest-worker:8089 (docker-compose.prod.yml)                        │
│    postgres:5432     (shared infra)                                     │
│    dragonfly:6379    (shared infra)                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Preprod Deploy Flow

1. Push to `preprod` branch triggers CI
2. CI builds & pushes Docker image to GHCR
3. CI pushes image to GHCR
   (`ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:preprod`)
4. CI SSH to VPS, runs
   `coolify-deploy.sh --app api --image <image> --wait --force`
5. Coolify receives API call, orchestrates blue-green deploy of
   `api-ix9fceaxa914diauokjleeis`
6. Coolify also deploys worker (`worker-ix9fceaxa914diauokjleeis`) if configured
7. CI runs verification via `verify.sh deployment`

## Production Deploy Flow (currently gated)

1. Push to `main` branch triggers CI
2. CI builds & pushes Docker image to GHCR
3. Production deploy is **gated** — set `ENABLE_PROD_DEPLOY=true` to enable
4. When enabled: CI SSH to VPS, runs `blue-green-deploy.sh` directly
5. Script creates `blue-api-latest`/`green-api-latest` containers on
   `app-network`
6. Nginx (host `latest-nginx`) proxies via upstream.conf hot-swap

## Key Ports

| Service                         | Host Port | Internal Port | Managed By              |
| ------------------------------- | --------- | ------------- | ----------------------- |
| api-ix9fceaxa914diauokjleeis    | 8087      | 8080          | Coolify                 |
| worker-ix9fceaxa914diauokjleeis | (none)    | 8088          | Coolify                 |
| latest-api                      | 8088      | 8088          | docker-compose.prod.yml |
| latest-worker                   | 8089      | 8088          | docker-compose.prod.yml |
| coolify-proxy (Traefik)         | 80/443    | —             | Coolify                 |
| postgres                        | —         | 5432          | docker-compose          |
| dragonfly                       | —         | 6379          | docker-compose          |

## Config Files

- **Coolify app UUIDs**: `devops/config/coolify-apps.env`
- **CI workflow**: `.github/workflows/ci.yml`
- **Coolify deploy script**: `devops/scripts/docker-infra/coolify-deploy.sh`
- **Blue-green deploy script**:
  `devops/scripts/docker-infra/blue-green-deploy.sh`

## Deployment Scripts

- `coolify-deploy.sh` — Triggers Coolify blue-green deploy via API (preprod
  only)
- `blue-green-deploy.sh` — Direct docker-based blue-green deploy (production)
- `deploy.sh` — Unified deploy orchestrator (used for production)
- `health-check.sh` — Verify all containers healthy
- `verify.sh` — Post-deployment verification
- `backup.sh` — Pre-deployment backup (PostgreSQL + Dragonfly + .env)

## Environment Files

| File              | Used For                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `.env.production` | Both preprod and production (different DB names via compose env) |
