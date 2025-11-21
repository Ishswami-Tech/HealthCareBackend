# Healthcare Backend DevOps

This folder contains the operational configuration and scripts to run the Healthcare Backend locally (Docker) and in production (Kubernetes on containerd). It consolidates the previous scattered READMEs into one guide.

## Overview
- Local development: Docker Compose (fast feedback loop)
- Production: Kubernetes (containerd), Kustomize overlays (local/staging/production)
- Postgres: StatefulSet with WAL-G PITR backups
- PgBouncer: connection pooling (transaction mode)
- Cache: Provider-agnostic (Redis/Dragonfly) with auth enabled; Redis/Dragonfly cluster manifests available

## Quick Start

### Docker (local development)

**Prerequisites:**
- **Docker Desktop installed and running on Windows** (required even when using WSL2)
- At least 4GB RAM available for Docker
- WSL2 integration enabled in Docker Desktop settings

**Option 1: Using the startup script (Recommended)**

**⭐ WSL2 (Recommended for Windows):**
```bash
# Open WSL terminal
wsl

# Navigate to project (adjust path if needed)
cd /mnt/d/Projects/Doctor\ APP/HealthCareApp/HealthcareFrontend/HealthCareBackend

# Or if you're already in the project directory
cd devops/docker
chmod +x start-dev.sh
./start-dev.sh
```

**Windows PowerShell (Alternative):**
```powershell
cd devops/docker
.\start-dev.ps1
```

**Linux/Mac:**
```bash
cd devops/docker
chmod +x start-dev.sh
./start-dev.sh
```

> **💡 Why WSL2?** Docker Desktop on Windows uses WSL2 backend by default. Running Docker commands in WSL2 provides:
> - Better file system performance
> - More consistent Linux-like environment
> - Better integration with Docker Desktop
> - Easier path handling for mounted volumes

**Option 2: Manual startup**
```bash
# Navigate to project root
cd /path/to/HealthCareBackend

# Start all services
docker compose -f devops/docker/docker-compose.dev.yml up -d --build

# View logs
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
```

**Access Points:**
- **API**: http://localhost:8088
- **Swagger Docs**: http://localhost:8088/docs
- **Health Check**: http://localhost:8088/health
- **Queue Dashboard**: http://localhost:8088/queue-dashboard
- **Prisma Studio**: http://localhost:5555
- **PgAdmin**: http://localhost:5050 (admin@admin.com / admin)
- **Redis Commander**: http://localhost:8082 (admin / admin)

**Useful Commands:**
```bash
# Stop all services
docker compose -f devops/docker/docker-compose.dev.yml down

# Restart API service
docker compose -f devops/docker/docker-compose.dev.yml restart api

# View logs for specific service
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
docker compose -f devops/docker/docker-compose.dev.yml logs -f postgres

# Access container shell
docker exec -it healthcare-api sh

# Run Prisma migrations manually
docker exec -it healthcare-api pnpm prisma:migrate

# Run database seed
docker exec -it healthcare-api pnpm seed:dev

# Clean up (removes volumes - WARNING: deletes data)
docker compose -f devops/docker/docker-compose.dev.yml down -v
```

**What happens on startup:**
1. PostgreSQL and Redis containers start and wait for health checks
2. API container waits for database to be ready
3. Prisma Client is generated
4. Database migrations are applied automatically
5. Application starts in development mode with hot-reload

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
  - `session-secret`: Fastify session secret (minimum 32 characters) - used with CacheService/Dragonfly
  - `cookie-secret`: Fastify cookie secret (minimum 32 characters) - used for cookie signing
- Secret `wal-g-secrets` (namespace `healthcare-backend`)
  - `WALG_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `WALG_S3_ENDPOINT`

Helpers:
- Validate: `make k8s-secrets-validate`
- Apply from env: `make k8s-secrets-apply`

## PgBouncer
- Service: `pgbouncer.healthcare-backend.svc:6432`
- Use `?pgbouncer=true` in app connection string to disable prepared statements
- Run Prisma migrations against `database-migration-url` (direct Postgres) � not PgBouncer

## Backups & Restore (WAL-G)
- Archiving enabled (`archive_mode=on`, `wal-g wal-push`)
- Nightly base backup via sidecar scheduler, retention keep 7
- Trigger on-demand backup: `make k8s-walg-backup`
- Restore runbook: use Job at `devops/kubernetes/base/postgres-restore-job.yaml` (scale down, fetch, scale up)

## Makefile Commands
- `k8s-local-build` � build local image (nerdctl or docker)
- `k8s-local-deploy` � deploy local overlay
- `k8s-local-access` � port-forward API 8088
- `k8s-secrets-validate` � check required secrets/keys
- `k8s-secrets-apply` � apply both secret sets from env
- `k8s-walg-backup` � trigger WAL-G base backup and prune

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