# Healthcare Backend DevOps

This folder contains the operational configuration and scripts to run the Healthcare Backend locally (Docker) and in production (Kubernetes on containerd). It consolidates the previous scattered READMEs into one guide.

## Overview
- Local development: Docker Compose (fast feedback loop)
- Production: Kubernetes (containerd), Kustomize overlays (local/staging/production)
- Postgres: StatefulSet with WAL-G PITR backups
- PgBouncer: connection pooling (transaction mode)
- Redis: auth enabled; Redis cluster manifests available

## Quick Start

### Docker (local development)
```bash
docker compose -f devops/docker/docker-compose.dev.yml up -d --build
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
```

### Kubernetes (production/staging)
```bash
# Apply/update secrets (env vars required)
DB_URL='postgresql://postgres:PW@pgbouncer:6432/userdb?pgbouncer=true' \
DB_MIGRATION_URL='postgresql://postgres:PW@postgres:5432/userdb' \
POSTGRES_USER=postgres POSTGRES_PASSWORD=PW REDIS_PASSWORD=PW JWT_SECRET='MIN_32' \
WALG_S3_PREFIX='s3://bucket/prefix' AWS_ACCESS_KEY_ID=KEY AWS_SECRET_ACCESS_KEY=SECRET \
AWS_REGION=us-east-1 WALG_S3_ENDPOINT='https://endpoint' \
make k8s-secrets-apply

# Deploy overlay
kubectl apply -k devops/kubernetes/overlays/production/

# Verify rollout
kubectl rollout status deploy/healthcare-api -n healthcare-backend --timeout=300s
```

## Required Secrets
- Secret `healthcare-secrets` (namespace `healthcare-backend`)
  - `database-url`: connect via PgBouncer, e.g. `postgresql://user:pass@pgbouncer:6432/userdb?pgbouncer=true`
  - `database-migration-url`: direct Postgres for migrations, e.g. `postgresql://user:pass@postgres:5432/userdb`
  - `postgres-user`, `postgres-password`, `redis-password`, `jwt-secret`
- Secret `wal-g-secrets` (namespace `healthcare-backend`)
  - `WALG_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `WALG_S3_ENDPOINT`

Helpers:
- Validate: `make k8s-secrets-validate`
- Apply from env: `make k8s-secrets-apply`

## PgBouncer
- Service: `pgbouncer.healthcare-backend.svc:6432`
- Use `?pgbouncer=true` in app connection string to disable prepared statements
- Run Prisma migrations against `database-migration-url` (direct Postgres) — not PgBouncer

## Backups & Restore (WAL-G)
- Archiving enabled (`archive_mode=on`, `wal-g wal-push`)
- Nightly base backup via sidecar scheduler, retention keep 7
- Trigger on-demand backup: `make k8s-walg-backup`
- Restore runbook: use Job at `devops/kubernetes/base/postgres-restore-job.yaml` (scale down, fetch, scale up)

## Makefile Commands
- `k8s-local-build` — build local image (nerdctl or docker)
- `k8s-local-deploy` — deploy local overlay
- `k8s-local-access` — port-forward API 8088
- `k8s-secrets-validate` — check required secrets/keys
- `k8s-secrets-apply` — apply both secret sets from env
- `k8s-walg-backup` — trigger WAL-G base backup and prune

## File Map
- Kubernetes base: `devops/kubernetes/base/*` (API, Worker, Postgres, Redis, PgBouncer, RBAC, PDB, VPA, Ingress, NetworkPolicies)
- Overlays: `devops/kubernetes/overlays/{local,staging,production}`
- Docker: `devops/docker/*`
- Nginx (optional VM reverse proxy): `devops/nginx/*`

## SSL/TLS & Cloudflare
- See `devops/nginx/SSL_CERTIFICATES.md` and `devops/nginx/CLOUDFLARE_SETUP.md`

## Notes
- Domain/IP remain: `api.ishswami.in` (82.208.20.16)
- No Prometheus/Loki required; HPAs use CPU/Memory