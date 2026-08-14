# Preprod Migration Plan — Step by Step

**Date:** 2026-08-10 **Goal:** Run preprod environment alongside production
using shared postgres + dragonfly, zero-downtime blue-green deploys.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Contabo VPS                                      │
│                                                                     │
│  ┌──────────────────┐         ┌──────────────────┐                 │
│  │   app-network    │         │  preprod-network │                 │
│  │  172.18.0.0/16   │         │  172.19.0.0/16   │                 │
│  │                  │         │                  │                 │
│  │  latest-nginx    │         │  preprod-nginx   │                 │
│  │  latest-api      │         │  blue-api-preprod│                 │
│  │  latest-worker   │         │  green-api-preprod│                │
│  │                  │         │  (worker on CI)  │                 │
│  │                  │         │                  │                 │
│  │  ONE postgres ◄──┼─────────┼── connected to   │ ← shared       │
│  │  ONE dragonfly ◄─┼─────────┼── both networks  │   infra        │
│  │                  │         │                  │                 │
│  │  (production)    │         │  (preprod)       │                 │
│  └──────────────────┘         └──────────────────┘                 │
│                                                                     │
│  Ports: 80/443 (host nginx) → 8088 (prod API)                     │
│         8090 → preprod nginx → blue/green-api-preprod:8088        │
│         8089 → prod queue dashboard (latest-worker)                │
│         9091 → preprod queue dashboard (blue-worker-preprod)       │
└─────────────────────────────────────────────────────────────────────┘
```

**Data separation:**

- Postgres: `userdb` (prod) vs `userdb_preprod` (preprod) — different DB names
- Dragonfly: `healthcare:*` (prod) vs `healthcare-preprod:*` (preprod) —
  different key prefixes

---

## Current State (verified via MCP)

| Component                 | Status                                        |
| ------------------------- | --------------------------------------------- |
| `postgres` container      | Running, healthy, 5 days uptime               |
| `dragonfly` container     | Running, healthy, 5 days uptime               |
| `latest-api`              | Running, healthy                              |
| `latest-worker`           | Running, healthy                              |
| `portainer`               | Running (unhealthy — not used)                |
| Host nginx                | Active, SSL on backend-service-v1.ishswami.in |
| Ports in use              | 80, 443, 8088, 8089, 9000, 9443               |
| `userdb` database         | Exists (production)                           |
| `userdb_preprod` database | **Just created**                              |
| Preprod network           | **Does not exist**                            |
| Preprod nginx             | **Does not exist**                            |
| Preprod directories       | **Do not exist**                              |

---

## Files Modified

| File                                           | Change                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `devops/docker/docker-compose.preprod.yml`     | Removed `preprod-postgres`, `preprod-dragonfly`, `preprod-api`, `preprod-worker` services. Now only defines `preprod-nginx`. |
| `devops/docker/nginx/nginx.preprod.conf`       | Port changed 8089 → 8090                                                                                                     |
| `devops/scripts/docker-infra/setup-preprod.sh` | **NEW** — creates network, connects shared infra, starts nginx                                                               |
| `devops/scripts/docker-infra/setup-preprod.sh` | Fixed port 8089 → 8090 for preprod nginx                                                                                     |
| `.github/workflows/ci.yml`                     | Fixed `DATABASE_URL` to use `userdb_preprod` for preprod. Fixed `API_RATE_LIMIT=1000` (was `:`)                              |
| `devops/docs/GITHUB_SECRETS_GUIDE.md`          | NGINX_PORT for preprod: 8089 → 8090                                                                                          |

---

## Step-by-Step Execution

### PRE-REQUISITE: Update GitHub Secrets Guide

Update the preprod `NGINX_PORT` variable value:

```
NGINX_PORT (preprod) = 8090   (was 8089)
```

---

### Step 1: Run setup script on the Contabo server

```bash
# Copy the setup script to the server
scp devops/scripts/docker-infra/setup-preprod.sh root@YOUR_SERVER_IP:/opt/healthcare-backend/devops/scripts/docker-infra/

# Copy the preprod nginx config
scp devops/docker/nginx/nginx.preprod.conf root@YOUR_SERVER_IP:/opt/healthcare-preprod/nginx/nginx.conf

# SSH and run the setup script
ssh root@YOUR_SERVER_IP
sudo bash /opt/healthcare-backend/devops/scripts/docker-infra/setup-preprod.sh
```

The script does:

1. Creates `/opt/healthcare-preprod/{nginx,logs}` on the **host** (for bind
   mounts)
2. Creates Docker network `preprod-network` (172.19.0.0/16)
3. Connects existing `postgres` and `dragonfly` containers to `preprod-network`
   — **no restart, zero downtime**
4. Starts `preprod-nginx` container on **host port 8090**
5. Writes placeholder `upstream.conf`

**Expected output:**

```
[1/6] Creating host directories...  ✓
[2/6] Copying preprod nginx config...  ✓
[3/6] Creating preprod Docker network...  ✓ (or "already exists")
[4/6] Connecting shared infra to preprod-network...  ✓ postgres connected  ✓ dragonfly connected
[5/6] Writing initial upstream.conf...  ✓
[6/6] Starting preprod-nginx (port 8090)...  ✓ nginx config valid

Setup Complete!
Infrastructure running:
  postgres        → app-network + preprod-network (shared, NO RESTART)
  dragonfly       → app-network + preprod-network (shared, NO RESTART)
  preprod-nginx   → preprod-network only (host port 8090)
```

---

### Step 2: Verify infrastructure

```bash
# Check containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Expected:
# postgres           Up 5 days (healthy)    5432/tcp
# dragonfly          Up 5 days (healthy)    6379/tcp
# latest-api         Up 16 hours (healthy)  0.0.0.0:8088->8088/tcp
# latest-worker      Up 16 hours (healthy)  0.0.0.0:8089->8088/tcp
# portainer          Up 5 days (unhealthy)  0.0.0.0:9000->9000/tcp, 0.0.0.0:9443->9443/tcp
# preprod-nginx      Up 5 seconds (healthy) 0.0.0.0:8090->8090/tcp

# Check networks
docker network inspect preprod-network --format 'Containers: {{len .Containers}}'
# Expected: 3 (postgres, dragonfly, preprod-nginx)

# Verify nginx is listening
curl -f http://localhost:8090/nginx-health
# Expected: "preprod-nginx-ok"

# Verify postgres has both databases
docker exec postgres psql -U postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '%userdb%' ORDER BY datname;"
# Expected: userdb, userdb_preprod
```

---

### Step 3: Verify production is untouched

```bash
# Production must still be 100% healthy
curl -f https://backend-service-v1.ishswami.in/health
curl -f https://backend-service-v1.ishswami.in/infra-health

# Production containers must still be on app-network only
docker network inspect app-network --format '{{range .Containers}}{{.Name}} {{end}}'
# Expected: postgres dragonfly latest-nginx latest-api latest-worker

# Production must NOT be on preprod-network
docker network inspect preprod-network --format '{{range .Containers}}{{.Name}} {{end}}'
# Expected: postgres dragonfly preprod-nginx
# (no latest-nginx, latest-api, latest-worker)
```

---

### Step 4: Trigger preprod deploy via CI

```bash
# Push to preprod branch
git checkout preprod
git merge main   # or your feature branch
git push origin preprod
```

CI pipeline will:

1. Build Docker image with `preprod` tag
2. Set `COMPOSE_FILE=docker-compose.preprod.yml`
3. Set `DEPLOY_ENV=preprod`
4. Create `.env.preprod` on server with:
   - `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb_preprod?schema=public`
   - `DRAGONFLY_HOST=preprod-dragonfly`
   - `DRAGONFLY_KEY_PREFIX=healthcare-preprod:`
5. Copy preprod nginx config to server
6. Run Prisma migrations on `userdb_preprod`
7. Run blue-green deploy:
   - Creates `blue-api-preprod` on `preprod-network`
   - Health check on `/infra-health`
   - Writes `upstream.conf` → reloads `preprod-nginx`
   - Drains old container (none on first deploy)
8. Post-deploy verification

---

### Step 5: Verify preprod after deploy

```bash
# Check new blue-green containers
docker ps --filter "name=preprod-api" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Expected:
# blue-api-preprod   Up 2 minutes   8088/tcp
# (or green-api-preprod if green is active)

# No old static containers should exist
docker ps -a --filter "name=preprod-api$" --format "{{.Names}}"
# Expected: (empty)

# Verify upstream.conf was written
cat /opt/healthcare-preprod/nginx/upstream.conf
# Expected: server blue-api-preprod:8088 max_fails=3 fail_timeout=10s;

# Verify nginx routing
curl -f http://localhost:8090/health
curl -f http://localhost:8090/infra-health

# Verify preprod database
docker exec postgres psql -U postgres -d userdb_preprod -c "SELECT count(*) FROM \"User\";"
# Expected: positive count (migrations applied)

# Verify cache isolation
docker exec dragonfly redis-cli keys "healthcare-preprod:*" | head -5
# Should show preprod keys
docker exec dragonfly redis-cli keys "healthcare:*" | head -5
# Should show production keys (different)
```

---

## Rollback Plan

### If preprod deploy fails

- Blue-green deploy automatically keeps the old container active
- New container is removed on failure
- Preprod continues on previous version (or nginx returns 502 if first deploy)

### If preprod needs to be destroyed

```bash
# Stop and remove all preprod containers
docker rm -f preprod-nginx blue-api-preprod green-api-preprod 2>/dev/null || true

# Remove network (production is NOT on it)
docker network rm preprod-network

# Data is safe — postgres + dragonfly volumes untouched
# userdb_preprod database still exists in postgres
```

### Production is NEVER affected

- Production containers never join `preprod-network`
- Production database `userdb` is never touched
- Production cache keys `healthcare:*` are never modified

---

## Port Summary

| Port     | Service                                           | Environment                 |
| -------- | ------------------------------------------------- | --------------------------- |
| 80/443   | Host nginx (SSL)                                  | Both (routes to 8088)       |
| 8088     | `latest-nginx` → `latest-api`                     | Production API              |
| 8089     | `latest-worker` queue dashboard                   | Production                  |
| **8090** | `preprod-nginx` → blue/green-api-preprod          | **Preprod API**             |
| **9091** | Blue/green-worker-preprod (exposed by blue-green) | **Preprod queue dashboard** |
| 9000     | Portainer                                         | Admin                       |
| 9443     | Portainer (HTTPS)                                 | Admin                       |

---

## Next Steps After Migration

1. Configure DNS: Point `preprod-backend.ishswami.in` → server IP (port 8090 via
   host nginx or direct)
2. Update frontend `.env.production` with preprod API URL
3. Set up preprod health monitoring
4. Run smoke tests on preprod endpoint
