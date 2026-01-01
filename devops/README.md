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

**Option 1: Using the consolidated scripts (Recommended)**

**⭐ Unified Script (Works on all platforms):**
```bash
# Navigate to project root
cd /path/to/HealthCareBackend

# Make scripts executable (first time only)
chmod +x devops/scripts/*.sh

# Start services
./devops/scripts/healthcare.sh docker start

# Or use the Docker script directly
./devops/scripts/docker.sh start
```

**Alternative (Old scripts still work):**
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
- **Health Check**: http://localhost:8088/health (Terminus-based, includes realtime status)
- **Detailed Health**: http://localhost:8088/health?detailed=true (includes system metrics)
- **Realtime Health (Socket.IO)**: Connect to `ws://localhost:8088/health` namespace for push-based updates
- **Queue Dashboard**: http://localhost:8088/queue-dashboard
- **Prisma Studio**: http://localhost:5555
- **PgAdmin**: http://localhost:5050 (admin@admin.com / admin)
- **Redis Commander**: http://localhost:8082 (admin / admin)

**Useful Commands (Using Consolidated Scripts):**
```bash
# Stop all services
./devops/scripts/docker.sh stop

# Restart services
./devops/scripts/docker.sh restart

# View logs
./devops/scripts/docker.sh logs api
./devops/scripts/docker.sh logs postgres

# Monitor logs
./devops/scripts/docker.sh monitor api

# Check health
./devops/scripts/docker.sh health

# Access container shell
./devops/scripts/docker.sh shell api

# Clean up (WARNING: deletes data)
./devops/scripts/docker.sh clean
```

**Or use Docker Compose directly:**
```bash
# Stop all services
docker compose -f devops/docker/docker-compose.dev.yml down

# View logs
docker compose -f devops/docker/docker-compose.dev.yml logs -f api

# Run Prisma migrations
docker exec -it healthcare-api yarn prisma:migrate

# Run database seed
docker exec -it healthcare-api yarn seed:dev
```

**What happens on startup:**
1. PostgreSQL and Redis containers start and wait for health checks
2. API container waits for database to be ready
3. Prisma Client is generated
4. Database migrations are applied automatically
5. Application starts in development mode with hot-reload

### Kubernetes (production/staging)

**Using Consolidated Scripts:**
```bash
# Deploy to production
./devops/scripts/k8s.sh deploy production

# Setup secrets
./devops/scripts/k8s.sh setup-secrets production

# Check status
./devops/scripts/k8s.sh status

# View logs
./devops/scripts/k8s.sh logs deployment/healthcare-api

# Port forward
./devops/scripts/k8s.sh port-forward healthcare-api 8088
```

**Or use kubectl directly:**
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
- **Consolidated Scripts**: `devops/scripts/*` (Main entry point: `healthcare.sh`)
- Kubernetes base: `devops/kubernetes/base/*` (API, Worker, Postgres, Redis, PgBouncer, RBAC, PDB, VPA, Ingress, NetworkPolicies)
- Overlays: `devops/kubernetes/overlays/{local,staging,production}`
- Docker: `devops/docker/*` (Old scripts still available for backward compatibility)
- Kubernetes scripts: `devops/kubernetes/scripts/*` (Old scripts still available)
- Nginx (optional VM reverse proxy): `devops/nginx/*`

## Consolidated Scripts

All DevOps operations are now consolidated into unified scripts:
- **Main Entry**: `devops/scripts/healthcare.sh` - Routes to Docker or Kubernetes
- **Docker**: `devops/scripts/dev/docker.sh` - Local Docker Compose operations
- **Docker Production**: `devops/scripts/docker-infra/` - Production Docker infrastructure scripts
- **Kubernetes**: `devops/scripts/dev/k8s.sh` - Local Kubernetes operations
- **Kubernetes Production**: `devops/scripts/kubernetes/` - Production Kubernetes scripts (to be implemented)

See `devops/scripts/README.md` for detailed usage and `devops/scripts/VERIFICATION.md` for implementation status.

## Health Monitoring

- **REST Endpoints:**
  - `/health` - Basic health check (Terminus-based, includes realtime status)
  - `/health?detailed=true` - Detailed health with system metrics
- **Socket.IO:** `/health` namespace for real-time push-based updates
- **See:** [Health Monitoring Guide](./HEALTH_MONITORING.md) for complete documentation

## SSL/TLS & Cloudflare
- See `devops/nginx/SSL_CERTIFICATES.md` and `devops/nginx/CLOUDFLARE_SETUP.md`

## Notes
- Domain/IP remain: `api.ishswami.in` (82.208.20.16)
- No Prometheus/Loki required; HPAs use CPU/Memory
- Health monitoring uses Terminus (industry-standard) with Socket.IO for real-time updates