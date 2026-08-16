# Docker Deployment Guides

This folder contains Docker Compose files for the Healthcare Backend.

## Environments

- Production: `docker-compose.prod.yml`
- Local production-like: `docker-compose.local-prod.yml`
- Development: `docker-compose.dev.yml`

## Current Stack

- Infrastructure: `postgres`, `dragonfly`, `portainer`
- Application: `api`, `worker`
- Video: handled by the backend `video` service abstraction

## Common Commands

```bash
cd devops/docker
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.local-prod.yml --profile infrastructure --profile app up -d --build
docker compose -f docker-compose.dev.yml up -d --build
```

## Checks

- `docker compose -f docker-compose.prod.yml ps`
- `curl http://localhost:8088/health`
- `docker compose -f docker-compose.prod.yml logs -f api`
- `docker compose -f docker-compose.prod.yml logs -f worker`

## Notes

- Video provider selection happens in the backend.

---

# Coolify Migration Guide

Migrate the healthcare backend from Portainer to Coolify **without downtime**.
The Portainer stack stays running throughout; Coolify runs a parallel "canary"
stack that is verified before cutting over.

## Prerequisites

- VPS with enough RAM for both stacks side-by-side (Coolify itself needs ~500MB;
  current stack ~16GB)
- Domain/DNS that can be re-pointed later
- SSH access to the VPS as root
- Docker image pushed to GHCR:
  `ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<tag>`

## Phase 0 — Pre-flight (30 min)

### 0.1 Backup the database

```bash
docker exec postgres pg_dump -U postgres userdb > ~/backups/pre-coolify-migration-$(date +%Y%m%d).sql
```

### 0.2 Confirm VPS resources

```bash
free -h        # need ≥ 4 GB free RAM
df -h          # need ≥ 10 GB free disk
```

### 0.3 Document current state

```bash
docker compose -f docker-compose.prod.yml ps
docker images | grep healthcare
```

Record the current image SHA from `docker images` output — you'll need it to tag
the Coolify image identically.

### 0.4 Choose non-conflicting ports

| Service    | Portainer current | Coolify canary               |
| ---------- | ----------------- | ---------------------------- |
| PostgreSQL | internal only     | `127.0.0.1:5433:5432`        |
| Dragonfly  | internal only     | `127.0.0.1:6380:6379`        |
| API        | `:8088` (host)    | `127.0.0.1:8089:8088`        |
| Worker     | no host port      | no host port (same)          |
| Bull Board | `:9090` → `:8080` | `:9091` → `:8080` (optional) |
| Coolify UI | n/a               | `:18000` / `:18443`          |

---

## Phase 1 — Install Coolify (30 min)

SSH into VPS as root:

```bash
# Install Coolify
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

After install completes, **override Coolify's default ports** (8000/8443
conflict with Portainer's 9000):

```bash
# Edit Coolify environment
nano /opt/coolify/.env
# Add or change:
COOLIFY_APP_PORT=18000
COOLIFY_APP_HTTPS_PORT=18443

systemctl restart coolify
```

Open firewall:

```bash
ufw allow 18000/tcp
ufw allow 18443/tcp
# DO NOT open 8088 — Portainer stack already binds it
```

Browse to `https://<VPS_IP>:18443` → create admin account.

---

## Phase 2 — Provision infrastructure in Coolify

In Coolify UI: **+ New → Project** → "Healthcare Backend" → **+ New →
Environment** → "Production"

### 2.1 PostgreSQL

**+ New → Database → PostgreSQL**

| Setting       | Value                                   |
| ------------- | --------------------------------------- |
| Image         | `postgres:18`                           |
| Name          | `postgres-healthcare`                   |
| Port          | `127.0.0.1:5433:5432`                   |
| Database name | `userdb`                                |
| Username      | `postgres`                              |
| Password      | (same as Portainer's postgres password) |
| Volume        | new volume `postgres-data-coolify`      |

### 2.2 Dragonfly (Redis)

**+ New → Database → Redis** (use custom image)

| Setting | Value                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Image   | `docker.dragonflydb.io/dragonflydb/dragonfly:latest`                                                                                |
| Name    | `dragonfly-healthcare`                                                                                                              |
| Port    | `127.0.0.1:6380:6379`                                                                                                               |
| Volume  | new volume `dragonfly-data-coolify`                                                                                                 |
| Command | `--alsologtostderr --cache_mode=false --maxmemory=4gb --proactor_threads=6 --logtostderr --default_lua_flags=allow-undeclared-keys` |

---

## Phase 3 — Deploy the API service

**+ New → Application**

| Setting           | Value                                                                            |
| ----------------- | -------------------------------------------------------------------------------- |
| Name              | `api-healthcare`                                                                 |
| Source            | Docker Image                                                                     |
| Image             | `ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<same-tag-as-portainer>` |
| Port              | `8088`                                                                           |
| Health check URL  | `http://localhost:8088/health`                                                   |
| Health check path | `/health`                                                                        |

### Environment variables

Set these in Coolify's environment editor. Start with the **required** ones,
then add the rest from `.env.production`:

#### Required

```
NODE_ENV=production
DATABASE_URL=postgresql://postgres:<password>@postgres-healthcare:5432/userdb?schema=public
DIRECT_URL=postgresql://postgres:<password>@postgres-healthcare:5432/userdb?schema=public
JWT_SECRET=<same-as-portainer>
JWT_REFRESH_SECRET=<same-as-portainer>
SESSION_SECRET=<same-as-portainer>
COOKIE_SECRET=<same-as-portainer>
PRISMA_SCHEMA_PATH=/app/src/libs/infrastructure/database/prisma/schema.prisma
```

#### Database & Cache

```
CACHE_PROVIDER=dragonfly
DRAGONFLY_ENABLED=true
DRAGONFLY_HOST=dragonfly-healthcare
DRAGONFLY_PORT=6379
DRAGONFLY_KEY_PREFIX=healthcare:
```

#### Networking

```
PORT=8088
HOST=0.0.0.0
BIND_ADDRESS=0.0.0.0
API_PREFIX=/api/v1
BASE_URL=https://backend-service-v1.ishswami.in
CORS_ORIGIN=https://ishswami.in
FRONTEND_URL=https://ishswami.in
MAIN_DOMAIN=viddhakarma.com
API_DOMAIN=backend-service-v1.ishswami.in
FRONTEND_DOMAIN=viddhakarma.com
```

#### Security & Rate Limiting

```
ENABLE_AUDIT_LOGS=true
SECURITY_RATE_LIMIT=true
SECURITY_RATE_LIMIT_MAX=4000
SECURITY_RATE_LIMIT_WINDOW_MS=1000
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=600
API_RATE_LIMIT=1000
AUTH_RATE_LIMIT=30
HEAVY_RATE_LIMIT=50
USER_RATE_LIMIT=500
HEALTH_RATE_LIMIT=2000
```

#### Misc

```
LOG_LEVEL=info
CRON_TIMEZONE=Asia/Kolkata
TZ=Asia/Kolkata
JWT_EXPIRATION=24h
JWT_ACCESS_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
SESSION_TIMEOUT=86400
SESSION_SECURE_COOKIES=true
SESSION_SAME_SITE=strict
CACHE_TTL=3600
CACHE_PREFIX=healthcare:
```

#### Google OAuth (if used)

```
GOOGLE_CLIENT_ID=<from .env.production>
GOOGLE_CLIENT_SECRET=<from .env.production>
```

### Startup command

In Coolify's **Deploy** section, keep the default app startup:

```
node dist/main.js
```

Prisma migrations are handled by the deploy job before blue-green rollout, so
container startup stays deterministic and side-effect free.

---

## Phase 4 — Deploy the Worker

**+ New → Application**

| Setting                    | Value                       |
| -------------------------- | --------------------------- |
| Name                       | `worker-healthcare`         |
| Source                     | Same image as API           |
| Environment                | Same env vars as API, plus: |
| `SERVICE_NAME`             | `worker`                    |
| `APP_MODE`                 | `worker`                    |
| `BULL_WORKER_CONCURRENCY`  | `10`                        |
| `BULL_MAX_JOBS_PER_WORKER` | `100`                       |
| `ENABLE_BULL_BOARD`        | `true`                      |
| `BULL_BOARD_URL`           | `/queue-dashboard`          |
| `PORT`                     | `8080`                      |

### Startup command

```
node dist/worker-bootstrap.js
```

### Health check

Use the same no-op as Portainer (worker healthcheck is a no-op because NestJS
bootstrap can hang):

```
["CMD", "node", "-e", "process.exit(0)"]
```

---

## Phase 5 — Verify (zero impact to Portainer)

At this point, **both stacks are running simultaneously**. Verify each
independently:

```bash
# Portainer API — should still respond
curl -i http://localhost:8088/health

# Coolify API — responds on its own port
curl -i http://127.0.0.1:8089/health

# Portainer worker — should still process jobs
docker compose -f docker-compose.prod.yml logs --tail=20 worker

# Coolify worker — check logs in Coolify UI
# Look for: "Worker is running and processing queues..."
```

Both APIs should return `200 OK`. The Portainer stack is untouched.

### Database connectivity check

```bash
# Portainer postgres
docker exec postgres psql -U postgres -c "SELECT count(*) FROM users;"

# Coolify postgres
docker exec postgres-healthcare psql -U postgres -c "SELECT count(*) FROM users;"
```

Portainer returns real data. Coolify returns `0` (fresh DB — expected at this
stage).

---

## Phase 6 — Migrate database data

Once Coolify's API and worker are healthy:

```bash
# 1. Dump from Portainer's postgres
docker exec postgres pg_dump -U postgres userdb > /tmp/db-dump.sql

# 2. Import into Coolify's postgres
docker exec -i postgres-healthcare psql -U postgres userdb < /tmp/db-dump.sql

# 3. Verify row counts match
docker exec postgres psql -U postgres -c "SELECT count(*) FROM users;"
docker exec postgres-healthcare psql -U postgres -c "SELECT count(*) FROM users;"
```

---

## Phase 7 — Migrate Dragonfly/Redis cache (optional)

If you want to preserve cached data:

```bash
# Export from Portainer's dragonfly
docker exec dragonfly dragonfly-cli -p 6379 --scan --count 100000 > /tmp/redis-dump.txt

# Import into Coolify's dragonfly
docker exec -i dragonfly-healthcare dragonfly-cli -p 6379 --pipe < /tmp/redis-dump.txt
```

Or simply let caches rebuild — cache data is ephemeral by design.

---

## Phase 8 — Cut over DNS / proxy

### Option A — Coolify manages proxy (Traefik)

1. In Coolify, enable **Public Port** for `api-healthcare` → set to `80` and
   `443`
2. Set your domain's A record to the VPS IP
3. Coolify's Traefik will auto-provision TLS via Let's Encrypt

### Option B — Keep existing Nginx/Caddy proxy

1. Re-point your proxy config from `127.0.0.1:8088` to `127.0.0.1:8089`
2. Reload proxy: `nginx -s reload` or equivalent

### Verification window

Watch both stacks for **24–48 hours**. Check:

```bash
# API health every minute
watch -n 60 'curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/health'

# Worker processing jobs
docker compose -f docker-compose.prod.yml logs --tail=5 worker
# AND
# Check Coolify worker logs in UI
```

---

## Phase 9 — Decommission Portainer

Once Coolify is confirmed stable for 48+ hours:

```bash
cd /opt/healthcare-backend  # or wherever your compose file lives

# Stop Portainer stack (API + worker + infra)
docker compose -f docker-compose.prod.yml down

# Stop Portainer itself
docker stop portainer && docker rm portainer
```

### Clean up volumes (only after confirming Coolify has all data)

```bash
# List Portainer volumes
docker volume ls | grep healthcare

# Remove only after Coolify is verified
docker volume rm <postgres_volume_name>
docker volume rm <dragonfly_volume_name>
```

---

## Troubleshooting

### Coolify API won't start

```bash
# Check logs in Coolify UI
# Common causes:
# 1. DATABASE_URL points to wrong host — verify postgres-healthcare DNS resolves
# 2. Prisma migrations failed — check deploy job output
# 3. Port conflict — ensure 8089 isn't already bound
```

### Worker hangs at NestFactory.create()

This is a known issue. The no-op healthcheck masks it. Check worker logs in
Coolify UI:

- If you see `[WorkerBootstrap] Starting application creation` but never
  `Application created successfully` → the NestJS bootstrap is hanging
- If you see `Worker is running and processing queues...` → worker is healthy

### BullMQ jobs stuck in "waiting"

The worker must be running and connected to Dragonfly for jobs to process.
Verify:

```bash
docker exec dragonfly-healthcare redis-cli -p 6379 ping
# Should return PONG

docker exec dragonfly-healthcare redis-cli -p 6379 LLEN bull:healthcare-api:waiting
# Should show 0 after worker processes jobs
```

### Port conflicts

If Coolify services fail to start due to port conflicts:

```bash
# Find what's using a port
ss -tlnp | grep 8089

# Coolify's own proxy might bind 80/443 — disable it if you use your own proxy
# In Coolify: Settings → Advanced → Disable "Public Port"
```

---

## Rollback

If Coolify fails and you need to revert to Portainer immediately:

```bash
# Stop Coolify services (in UI or via API)
# Re-point DNS/proxy back to Portainer's :8088
# Portainer stack was never touched — it continues running
```

No rollback of data is needed because Portainer's database was never modified.

---

## Quick Reference

| Resource   | Portainer              | Coolify                                 |
| ---------- | ---------------------- | --------------------------------------- |
| PostgreSQL | `postgres` (internal)  | `postgres-healthcare` (127.0.0.1:5433)  |
| Dragonfly  | `dragonfly` (internal) | `dragonfly-healthcare` (127.0.0.1:6380) |
| API        | `latest-api` (`:8088`) | `api-healthcare` (`127.0.0.1:8089`)     |
| Worker     | `latest-worker`        | `worker-healthcare`                     |
| Bull Board | `:9090`                | `:9091` (optional)                      |
| Coolify UI | —                      | `:18000` / `:18443`                     |
