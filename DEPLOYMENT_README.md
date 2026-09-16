# Healthcare Backend — Deployment Guide

Complete deployment reference: architecture, runbook, checklists, verification,
Docker commands, GitHub secrets, and VPS setup.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Traffic Flow](#2-traffic-flow)
3. [Deployment Runbook](#3-deployment-runbook)
4. [Pre & Post Deploy Checklists](#4-pre--post-deploy-checklists)
5. [Verification](#5-verification)
6. [Docker Reference](#6-docker-reference)
7. [GitHub Secrets & Variables](#7-github-secrets--variables)
8. [VPS Setup](#8-vps-setup)

---

## 1. Architecture Overview

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
        ├─ Production Stack (Coolify-managed)
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

## 2. Traffic Flow

```
Internet → coolify-proxy (Traefik, ports 80/443)
           ├── preprod-backend.ishswami.in → api-ix9fceaxa914diauokjleeis:8080
           └── backend-service-v1.ishswami.in → api-<prod-uuid>:8080
```

Coolify automatically configures Traefik routing rules for each managed app. No
manual nginx config needed.

---

## 3. Deployment Runbook

### Overview

| Aspect           | Preprod                           | Production                                 |
| ---------------- | --------------------------------- | ------------------------------------------ |
| Trigger          | Push to `main`                    | Push to `main` + `ENABLE_PROD_DEPLOY=true` |
| Mechanism        | Coolify API (`coolify-deploy.sh`) | Docker Compose + Coolify API               |
| URL              | `preprod-backend.ishswami.in`     | `backend-service-v1.ishswami.in`           |
| Container prefix | `api-ix9fceaxa914diauokjleeis`    | `latest-api` / `latest-worker`             |
| Database         | `userdb_preprod`                  | `userdb`                                   |

> **Production is gated off** until preprod is validated. Set the GitHub repo
> variable `ENABLE_PROD_DEPLOY=true` to enable production deploys.

---

### Step 1: Deploy to Preprod

Push any commit to `main`. CI automatically:

1. Runs lint, type-check, security audit
2. Builds multi-arch Docker image
3. Pushes to GHCR
4. Triggers Coolify deploy via API (`coolify-deploy.sh --wait --force`)
5. Verifies health via `https://preprod-backend.ishswami.in/health`
6. Takes a success backup

### Step 2: Verify Preprod

```bash
# Health endpoint
curl https://preprod-backend.ishswami.in/health

# Infra health (from VPS)
cd /opt/healthcare-backend && bash devops/scripts/docker-infra/health-check.sh --env preprod

# Container status (from VPS)
docker ps --filter "name=api-ix9"
docker ps --filter "name=worker-ix9"
```

**Acceptance Criteria:**

- `/health` returns 200 with `"status":"healthy"` or `"degraded"` (with API+DB healthy)
- `/infra-health` returns 200
- `api-ix9fceaxa914diauokjleeis` container running and healthy
- No error logs in last 50 lines

### Step 3: Promote to Production

After preprod validation passes, set `ENABLE_PROD_DEPLOY=true` in the GitHub
repository variables. The **next push to `main`** will deploy to production.

```bash
# Ensure preprod is green, then:
# 1. Set ENABLE_PROD_DEPLOY=true in GitHub repo settings → Variables
# 2. Push any commit (or re-push) to main

git checkout main
git commit --allow-empty -m "chore: trigger production deploy"
git push origin main
```

CI triggers production deploy via `blue-green-deploy.sh`.

---

### Manual Deploy (if CI fails)

#### Preprod (Coolify)

```bash
# Build image locally
docker build -t healthcare-api:manual -f devops/docker/Dockerfile .

# Tag and push to local registry on VPS
docker tag healthcare-api:manual ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:preprod
docker push ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:preprod

# Trigger Coolify deploy
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/coolify-deploy.sh \
  --app api \
  --image ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:preprod \
  --wait --force
```

#### Production

```bash
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --env production \
  --container-prefix "latest-" \
  --service api \
  --image "ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:latest" \
  --network app-network \
  --nginx-container "latest-nginx" \
  --upstream-conf /opt/healthcare-backend/nginx/upstream.conf \
  --health-endpoint /infra-health \
  --health-timeout 180 \
  --drain-timeout 120 \
  --api-port 8088
```

### Rollback

#### Preprod (Coolify)

- Use Coolify dashboard to rollback to previous deployment
- Or trigger deploy with previous image tag

#### Production

```bash
# Rollback uses the other color (blue/green)
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --env production \
  --container-prefix "latest-" \
  --service api \
  --image "ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<previous-tag>" \
  ...
```

### Common Issues

| Issue                | Solution                                                 |
| -------------------- | -------------------------------------------------------- |
| Coolify deploy stuck | Check Coolify dashboard for container logs               |
| Port conflict        | `docker ps` to find conflicting container                |
| DB migration failure | Check `prisma migrate deploy` output in container logs   |
| SSL cert error       | Traefik auto-renews; check `coolify-proxy` logs          |
| Registry auth        | Ensure `~/.docker/config.json` on VPS has registry creds |

---

## 4. Pre & Post Deploy Checklists

### Pre-Deploy Checklist (Production)

**Code Quality:**

- [ ] All CI checks pass (lint, type-check, tests, audit)
- [ ] PR reviewed and approved
- [ ] PR targets `preprod` branch for promotion
- [ ] CHANGELOG updated (if applicable)

**Infrastructure Health:**

```bash
ssh <host> 'docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"'
ssh <host> 'docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"'
```

- [ ] `postgres` container healthy
- [ ] `dragonfly` container healthy
- [ ] >=3 GB free on VPS

**Secrets Validation:**

- [ ] `DATABASE_URL` set in GitHub Secrets
- [ ] `JWT_SECRET` set
- [ ] `GITHUB_TOKEN` set (for GHCR auth)
- [ ] `GITHUB_USERNAME` set

**Backup Status:**

- [ ] Pre-deployment backup completed successfully

**Concurrency:**

- [ ] No in-flight deploy for production
- [ ] Previous deploy fully verified

---

### Post-Deploy Checklist (Production)

**CI Verification:**

- [ ] `post-deployment-verification` job passed (HTTP 200 on `/health`)
- [ ] `post-deployment-backup` job passed
- [ ] No errors in deploy job logs

**Manual Verification:**

```bash
# 1. Public health endpoint
curl -s https://backend-service-v1.ishswami.in/health | jq .

# 2. Infra health (from VPS)
PROD_API=$(ssh <host> "docker ps --filter 'name=api-' --format '{{.Names}}' | grep -v ix9 | head -1")
ssh <host> "docker exec $PROD_API wget -q --spider http://localhost:8088/infra-health && echo OK"
```

- [ ] `/health` returns 200 with healthy status
- [ ] `/infra-health` returns 200
- [ ] `api-*` and `worker-*` containers running
- [ ] Running image matches expected tag

**Rollback Readiness:**

- [ ] Previous deployment still available in Coolify

---

### Pre-Deploy Checklist (Preprod)

**Code Quality:**

- [ ] All CI checks pass
- [ ] Migrations are idempotent / safe for re-run

**Infrastructure Health:**

- [ ] `postgres` container healthy
- [ ] `dragonfly` container healthy
- [ ] >=3 GB free on VPS

**Preprod Database:**

```bash
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT 1"'
```

- [ ] `userdb_preprod` exists and is accessible
- [ ] `_prisma_migrations` table exists

**Secrets:**

- [ ] `DATABASE_URL` points to `userdb_preprod`
- [ ] `DRAGONFLY_KEY_PREFIX` = `healthcare:`

**Fresh DB Option (if needed):**

```bash
# DROP and recreate — production is unaffected
ssh <host>
docker exec -i postgres psql -U postgres -c "DROP DATABASE IF EXISTS userdb_preprod;"
docker exec -i postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"
```

- [ ] Fresh DB option: DONE / NOT NEEDED

---

### Post-Deploy Checklist (Preprod)

**CI Verification:**

- [ ] Deploy job passed
- [ ] `post-deployment-verification` passed
- [ ] No errors in deploy logs

**Manual Verification:**

```bash
# 1. Public health
curl -s https://preprod-backend.ishswami.in/health | jq .

# 2. Infra health
ssh <host> 'docker exec api-ix9fceaxa914diauokjleeis wget -q --spider http://localhost:8088/infra-health && echo OK'
```

- [ ] `/health` returns 200
- [ ] `/infra-health` returns 200
- [ ] `api-ix9fceaxa914diauokjleeis` and `worker-ix9fceaxa914diauokjleeis` running
- [ ] Image matches expected `preprod` tag
- [ ] `DATABASE_URL` points to `userdb_preprod`
- [ ] Queue dashboard accessible

**Data Verification:**

```bash
ssh <host> 'docker exec -i postgres psql -U postgres -d userdb_preprod -c "SELECT COUNT(*) FROM users;"'
```

- [ ] Expected tables exist
- [ ] Row counts are reasonable

---

### Environment Isolation Verification

```bash
# 1. Networks are separate
docker network ls | grep -E "app-network|preprod-network"

# 2. Containers are on correct networks
docker inspect api-ix9fceaxa914diauokjleeis --format "{{json .NetworkSettings.Networks}}" | jq .
```

- [ ] Networks are separate (`app-network` vs `preprod-network`)
- [ ] Production DB contains only production data
- [ ] Preprod DB contains only preprod data
- [ ] Cache keys don't collide between environments

---

### Quick Health Dashboard

```bash
ssh <host> bash -c '
  echo "=== PRODUCTION ==="
  docker ps --filter "name=api-" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -v ix9
  echo ""
  echo "=== PREPROD ==="
  docker ps --filter "name=api-ix9" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "=== INFRA ==="
  docker ps --filter "name=postgres" --format "{{.Names}}\t{{.Status}}"
  docker ps --filter "name=dragonfly" --format "{{.Names}}\t{{.Status}}"
  echo ""
  echo "=== DISK ==="
  df -h /opt/healthcare-backend
'
```

---

### Escalation

| Severity            | Action                                                          |
| ------------------- | --------------------------------------------------------------- |
| Production down     | Rollback via Coolify dashboard                                  |
| Preprod down        | Redeploy via Coolify dashboard                                  |
| Data corruption     | Restore from backup (`restore.sh latest`)                       |
| Infrastructure down | Recreate container with `docker compose up -d --force-recreate` |
| Coolify down        | Check Coolify container logs, restart if needed                 |

---

## 5. Verification

### Verification Levels

| Level               | When                       | Depth                      | Time   |
| ------------------- | -------------------------- | -------------------------- | ------ |
| **L0: CI Smoke**    | Every deploy (automated)   | Public endpoint 200 check  | 30s    |
| **L1: Infra**       | Every deploy (automated)   | DB + cache connectivity    | 60s    |
| **L2: Functional**  | After each deploy          | API smoke tests            | 2min   |
| **L3: Full Manual** | Before prod promotion      | End-to-end scenarios       | 15min  |

### Automated CI Verification

Every push triggers:
1. Lint + type-check
2. Security scan (Trivy + audit-ci)
3. Docker build + push to GHCR
4. Post-deploy HTTP check (`/health` must return 200)
5. Post-deploy backup

### Full Manual Verification

**Infrastructure:**

```bash
# Postgres
docker exec postgres pg_isready -U postgres

# Dragonfly
docker exec dragonfly redis-cli ping

# Disk
df -h /opt/healthcare-backend
```

**Application:**

```bash
# Health
curl -s https://backend-service-v1.ishswami.in/health | jq .

# Infra health
curl -s https://backend-service-v1.ishswami.in/infra-health | jq .

# Auth flow (OTP login)
curl -X POST https://backend-service-v1.ishswami.in/api/v1/auth/send-otp \
  -H "Content-Type: application/json" -d '{"phone":"+919999999999"}'
```

**Database:**

```bash
# Row counts
docker exec -i postgres psql -U postgres -d userdb -c "SELECT count(*) FROM users;"
docker exec -i postgres psql -U postgres -d userdb -c "SELECT count(*) FROM clinics;"

# Migration status
docker exec -i postgres psql -U postgres -d userdb -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

**Cache (Dragonfly):**

```bash
# Ping
docker exec dragonfly redis-cli ping

# Key prefix verification
docker exec dragonfly redis-cli --scan --pattern "healthcare:*" | head -5
docker exec dragonfly redis-cli dbsize
```

**Network Isolation:**

```bash
# Verify networks are separate
docker network ls | grep -E "app-network|preprod-network"

# Verify containers on correct networks
docker inspect api-ix9fceaxa914diauokjleeis --format "{{json .NetworkSettings.Networks}}" | jq .
```

**Ingress / SSL:**

```bash
# HTTPS works
curl -sI https://backend-service-v1.ishswami.in/health | head -5

# TLS cert valid
echo | openssl s_client -connect backend-service-v1.ishswami.in:443 -servername backend-service-v1.ishswami.in 2>/dev/null | openssl x509 -noout -dates
```

**Bull Queue Dashboard:**

```bash
curl -s https://backend-service-v1.ishswami.in/queue-dashboard/health
```

### Edge Case Scenarios

| Scenario                      | Test                                              | Expected                          |
| ----------------------------- | ------------------------------------------------- | --------------------------------- |
| API down                      | `curl -f /health`                                 | 502, worker still processes jobs |
| DB connection lost            | Stop postgres, hit API                             | 503 with degraded status          |
| Cache eviction                | Restart dragonfly, check session                   | Users re-authenticate             |
| Concurrent deploys            | Trigger two deploys simultaneously                 | Concurrency group blocks second   |
| Large payload                 | Upload 10MB file                                   | 413 or successful with streaming  |
| Rate limit                    | 1000 rapid requests                                | 429 after threshold               |
| Disk full                     | Fill disk to <1GB free                             | CI blocks, backup fails           |

### Performance Baseline

```bash
# p99 latency (should be <200ms)
curl -o /dev/null -s -w "p99: %{time_total}s\n" https://backend-service-v1.ishswami.in/health

# Throughput
ab -n 1000 -c 10 https://backend-service-v1.ishswami.in/health
```

### Security Verification

- [ ] Trivy scan passes (no CRITICAL vulnerabilities)
- [ ] `audit-ci` passes (no moderate+ vulnerabilities)
- [ ] No secrets in git history (validated by pre-commit hook)
- [ ] Rate limiting active (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT`)
- [ ] CORS origins restricted to known domains
- [ ] HTTPS only (no HTTP redirect to HTTPS)
- [ ] JWT_SECRET rotation tested

---

## 6. Docker Reference

### Environments

- Production: `docker-compose.prod.yml`
- Production (Coolify): `docker-compose.prod-coolify.yml`
- Preprod: `docker-compose.preprod.yml`
- Local production-like: `docker-compose.local-prod.yml`
- Development: `docker-compose.dev.yml`

### Common Commands

```bash
cd devops/docker

# Production
docker compose -f docker-compose.prod.yml up -d --build

# Preprod
docker compose -f docker-compose.preprod.yml up -d --build

# Development
docker compose -f docker-compose.dev.yml up -d --build

# Local production-like (with infra)
docker compose -f docker-compose.local-prod.yml --profile infrastructure --profile app up -d --build
```

### Checks

```bash
# Container status
docker compose -f docker-compose.prod.yml ps

# Health check
curl http://localhost:8088/health

# Logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
```

---

## 7. GitHub Secrets & Variables

### GitHub Environments

Create two environments under **Settings → Environments**:

- `production` — for production deployments
- `preprod` — for preprod deployments

Branch protection for `main`:
- Require PR from `preprod` branch
- Require `validate-pr` CI check to pass

### Required Secrets

| Secret name                | Environment(s)          | Purpose                                                      |
| -------------------------- | ----------------------- | ------------------------------------------------------------ |
| `SSH_PRIVATE_KEY`          | `production`, `preprod` | SSH private key for deploy user on VPS (RSA or Ed25519).     |
| `SERVER_HOST`              | `production`, `preprod` | VPS public IPv4 or hostname.                                 |
| `SERVER_USER`              | `production`, `preprod` | SSH user that can run `docker` on VPS (e.g., `root`).        |
| `SERVER_DEPLOY_PATH`       | `production`            | Root path: `/opt/healthcare-backend`                         |
| `SERVER_DEPLOY_PATH`       | `preprod`               | Root path: `/opt/healthcare-preprod`                         |
| `DATABASE_URL`             | `production`            | PostgreSQL DSN for `userdb`.                                 |
| `DATABASE_URL`             | `preprod`               | PostgreSQL DSN for `userdb_preprod`.                         |
| `POSTGRES_PASSWORD`        | `production`, `preprod` | PostgreSQL password.                                         |
| `JWT_SECRET`               | `production`, `preprod` | JWT signing secret (per-env).                                |
| `ALLOWED_ORIGINS`          | `production`, `preprod` | CORS origins.                                                |

### Required Variables

| Variable name       | Production default              | Preprod default                   |
| ------------------- | ------------------------------- | --------------------------------- |
| `NGINX_PORT`        | `8088`                          | `8090`                            |
| `API_PORT`          | `8088`                          | `8088`                            |
| `WORKER_PORT`       | `8080`                          | `8080`                            |
| `API_SUBDOMAIN`     | `backend-service-v1.ishswami.in`| `preprod-backend.ishswami.in`    |
| `CONTAINER_PREFIX`  | `latest-`                       | `preprod-`                        |
| `DOCKER_NETWORK`    | `app-network`                   | `preprod-network`                 |
| `COMPOSE_FILE`      | `docker-compose.prod.yml`       | `docker-compose.preprod.yml`      |
| `ENV_FILE`          | `.env.production`               | `.env.preprod`                    |

> All secret values are masked in workflow logs. Never write secrets to
> `GITHUB_STEP_SUMMARY`.

### Concurrency Groups

The workflow uses concurrency groups automatically:
- Production deploys → group `deploy-production`
- Preprod deploys → group `deploy-preprod`

---

## 9. VPS Setup

One-time setup of a single Contabo VPS hosting both production and preprod.

### Prerequisites

- Contabo VPS (Ubuntu 22.04+) with public IPv4
- Root SSH access
- Domain `ishswami.in` with DNS management
- Ports 22, 80, 443 reachable

### Phase 1 — OS Bootstrap

```bash
# SSH into the VPS and run:
curl -fsSL https://get.coollify.io | bash
```

This installs:
1. Docker Engine + Docker Compose plugin
2. Coolify (Traefik proxy, auto Let's Encrypt SSL, PaaS UI at `:8000`)
3. Directory trees at `/opt/healthcare-backend/` and `/opt/healthcare-preprod/`
4. UFW firewall (allows 22, 80, 443, 8000)
5. Docker networks: `app-network` (172.18.0.0/16) and `preprod-network` (172.19.0.0/16)

### Phase 2 — DNS Configuration

Create **A records** pointing to the VPS IPv4:

| Hostname                         | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `backend-service-v1.ishswami.in` | Production API                                       |
| `preprod-backend.ishswami.in`    | Preprod API                                          |
| `portainer.ishswami.in`          | Portainer CE management UI                           |

### Phase 3 — Coolify UI Setup

1. Open `http://<server-ip>:8000` and complete first-run wizard
2. Confirm Docker socket detected
3. `coolify` Docker network created automatically

### Phase 4 — Traefik Configuration

Coolify exposes Traefik as a **Public Port** resource. Configure:

- **Production**: `Host(\`backend-service-v1.ishswami.in\`)` → port `8088`, TLS enabled
- **Preprod**: `Host(\`preprod-backend.ishswami.in\`)` → port `8090`, TLS enabled

Coolify auto-provisions Let's Encrypt certificates.

### Phase 5 — Deploy Services in Coolify

**API:**
- Image: `ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<tag>`
- Port: `8088`
- Health check: `/health`

**Worker:**
- Same image as API
- Startup: `node dist/worker-bootstrap.js`
- Port: `8080`
- Health check: no-op (`node -e process.exit(0)`)

### Phase 6 — GitHub Environments

Create `production` and `preprod` environments. Populate secrets and variables
from the tables above.

### Phase 7 — Network Isolation Verification

```bash
# Verify networks are isolated
docker run --rm --network app-network alpine:latest sh -c \
  "wget -qT 5 http://preprod-nginx:8089/nginx-health -O -" && echo "FAIL" || echo "OK"
```

Both app-network and preprod-network must NOT be able to reach each other.

### Summary Checklist

- [ ] Docker Engine + Compose installed
- [ ] Coolify running at `http://<server-ip>:8000`
- [ ] DNS A records for all subdomains
- [ ] Coolify Traefik routing configured
- [ ] SSL certificates provisioned
- [ ] GitHub Environments created and secrets populated
- [ ] Docker networks created with ICC disabled
- [ ] Network isolation verified
- [ ] Directories created at `/opt/healthcare-backend/` and `/opt/healthcare-preprod/`
