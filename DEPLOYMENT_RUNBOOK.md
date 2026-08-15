# Deployment Runbook

## Overview

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

## Step 1: Deploy to Preprod

Push any commit to `main`. CI automatically:

1. Runs lint, type-check, security audit
2. Builds multi-arch Docker image
3. Pushes to GHCR
4. Transfers image to VPS local registry (`localhost:5000`)
5. Triggers Coolify deploy via API (`coolify-deploy.sh --wait --force`)
6. Verifies health via `https://preprod-backend.ishswami.in/health`
7. Takes a success backup

## Step 2: Verify Preprod

```bash
# Health endpoint
curl https://preprod-backend.ishswami.in/health

# Infra health (from VPS)
cd /opt/healthcare-backend && bash devops/scripts/docker-infra/health-check.sh --env preprod

# Container status (from VPS)
docker ps --filter "name=api-ix9"
docker ps --filter "name=worker-ix9"

# Coolify dashboard
# https://<coolify-host>:8000
```

### Acceptance Criteria

- `/health` returns 200 with `"status":"healthy"` or `"degraded"` (with API+DB
  healthy)
- `/infra-health` returns 200
- `api-ix9fceaxa914diauokjleeis` container running and healthy
- No error logs in last 50 lines

## Step 3: Promote to Production

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

## Manual Deploy (if CI fails)

### Preprod (Coolify)

```bash
# Build image locally
docker build -t healthcare-api:manual -f devops/docker/Dockerfile .

# Tag and push to local registry on VPS
docker tag healthcare-api:manual localhost:5000/healthcare-api:preprod
docker push localhost:5000/healthcare-api:preprod

# Trigger Coolify deploy
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/coolify-deploy.sh \
  --app api \
  --image localhost:5000/healthcare-api:preprod \
  --wait --force
```

### Production (docker-compose)

```bash
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --env production \
  --container-prefix "latest-" \
  --service api \
  --image "localhost:5000/healthcare-api:latest" \
  --network app-network \
  --nginx-container "latest-nginx" \
  --upstream-conf /opt/healthcare-backend/nginx/upstream.conf \
  --health-endpoint /infra-health \
  --health-timeout 180 \
  --drain-timeout 120 \
  --api-port 8088
```

## Rollback

### Preprod (Coolify)

- Use Coolify dashboard to rollback to previous deployment
- Or trigger deploy with previous image tag

### Production

```bash
# Rollback uses the other color (blue/green)
cd /opt/healthcare-backend
bash devops/scripts/docker-infra/blue-green-deploy.sh \
  --env production \
  --container-prefix "latest-" \
  --service api \
  --image "localhost:5000/healthcare-api:<previous-tag>" \
  ...
```

## Common Issues

| Issue                | Solution                                                 |
| -------------------- | -------------------------------------------------------- |
| Coolify deploy stuck | Check Coolify dashboard for container logs               |
| Port conflict        | `docker ps` to find conflicting container                |
| DB migration failure | Check `prisma migrate deploy` output in container logs   |
| SSL cert error       | Traefik auto-renews; check `coolify-proxy` logs          |
| Registry auth        | Ensure `~/.docker/config.json` on VPS has registry creds |
