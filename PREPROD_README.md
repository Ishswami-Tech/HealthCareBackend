# Preprod Setup via Coolify + GitHub Actions

Production is NOT touched at any point. We only add new preprod infrastructure.

---

## What We'll Do

1. Install Coolify (doesn't touch existing containers)
2. Create preprod Docker network
3. Connect postgres + dragonfly to preprod-network (no restart)
4. Create preprod in Coolify dashboard
5. Set up GitHub Actions for preprod deploy
6. Test preprod

Production stays 100% untouched until you decide to migrate it.

---

## Step 1: Install Coolify

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.coollify.io | bash
```

After install, access `http://YOUR_SERVER_IP:8000` and create admin account.

Verify:

```bash
docker ps --filter "name=coolify" --format "{{.Names}}\t{{.Status}}"
docker ps --filter "name=traefik" --format "{{.Names}}\t{{.Status}}"
```

Expected: `coolify` and `traefik` running.

**Existing production containers are NOT touched.**

---

## Step 2: Create Preprod Network

```bash
docker network create \
  --driver bridge \
  --subnet 172.19.0.0/16 \
  --opt com.docker.network.bridge.enable_ip_masquerade=true \
  preprod-network
```

---

## Step 3: Connect Shared Infra to Preprod Network

Postgres and dragonfly need to be reachable from preprod-network. This just adds
a network — no restart, no data impact.

```bash
docker network connect preprod-network postgres
docker network connect preprod-network dragonfly
```

Verify:

```bash
docker network inspect preprod-network --format '{{range .Containers}}{{.Name}} {{end}}'
# Expected: postgres dragonfly
```

---

## Step 4: Create Preprod Database

```bash
docker exec postgres psql -U postgres -c "CREATE DATABASE userdb_preprod;"
docker exec postgres psql -U postgres -c "\l"
# Expected: userdb, userdb_preprod
```

---

## Step 5: Create Preprod Application in Coolify

In Coolify dashboard:

1. **Applications** → **New Application**
2. **Source**: Docker Compose
3. **Name**: `healthcare-api-preprod`
4. **Compose file content**: Copy from
   `devops/docker/docker-compose.preprod.yml`
5. **Environment**: Select `preprod` (or create it)
6. Click **Deploy**

Coolify will:

- Create `preprod-nginx`, `preprod-api`, `preprod-worker` containers on
  `preprod-network`
- Connect to shared postgres (`userdb_preprod`) and dragonfly
- Set up Traefik routing for `preprod-backend.ishswami.in`

---

## Step 6: Configure Preprod Environment Variables in Coolify

In the preprod application settings → **Environment Variables**:

| Variable               | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`         | `postgresql://postgres:postgres@postgres:5432/userdb_preprod?schema=public` |
| `DRAGONFLY_HOST`       | `dragonfly`                                                                 |
| `DRAGONFLY_PORT`       | `6379`                                                                      |
| `DRAGONFLY_KEY_PREFIX` | `healthcare-preprod:`                                                       |
| `CACHE_PREFIX`         | `healthcare-preprod:`                                                       |
| `CONTAINER_PREFIX`     | `preprod-`                                                                  |
| `NODE_ENV`             | `production`                                                                |
| `PORT`                 | `8088`                                                                      |

Also configure secrets (JWT, Firebase, etc.) — same as production but in the
preprod env.

---

## Step 7: Configure DNS for Preprod

Point the preprod domain to your server:

| Domain                        | Target         |
| ----------------------------- | -------------- |
| `preprod-backend.ishswami.in` | Your server IP |

Coolify Traefik will auto-provision Let's Encrypt SSL.

---

## Step 8: Get Coolify API Key

In Coolify dashboard:

1. **Settings** → **API Keys** → **Create New API Key**
2. Copy the key

---

## Step 9: Get Application UUID

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://YOUR_SERVER_IP:8000/api/v1/applications \
  | jq '.[] | {name, uuid}'
```

Copy the UUID for `healthcare-api-preprod`.

---

## Step 10: Add GitHub Secrets

In GitHub repo → **Settings** → **Secrets and variables** → **Actions**:

| Secret                 | Value                               |
| ---------------------- | ----------------------------------- |
| `COOLIFY_API_KEY`      | Your Coolify API key                |
| `COOLIFY_API_URL`      | `http://YOUR_SERVER_IP:8000/api/v1` |
| `COOLIFY_PREPROD_UUID` | Preprod app UUID (from Step 9)      |

---

## Step 11: Add GitHub Variable

In GitHub repo → **Settings** → **Secrets and variables** → **Variables**:

| Variable                | Value                         | Environments |
| ----------------------- | ----------------------------- | ------------ |
| `NGINX_PORT`            | `8090`                        | preprod      |
| `API_PORT`              | `8088`                        | preprod      |
| `WORKER_DASHBOARD_PORT` | `9091`                        | preprod      |
| `CONTAINER_PREFIX`      | `preprod-`                    | preprod      |
| `DOCKER_NETWORK`        | `preprod-network`             | preprod      |
| `API_SUBDOMAIN`         | `preprod-backend.ishswami.in` | preprod      |
| `ENV_FILE`              | `.env.preprod`                | preprod      |

---

## Step 12: Update CI for Preprod Deploy

In `.github/workflows/ci.yml`, add a Coolify deploy step for the preprod branch:

```yaml
- name: Deploy to Coolify (Preprod)
  if: github.ref == 'refs/heads/preprod'
  env:
    COOLIFY_API_URL: ${{ secrets.COOLIFY_API_URL }}
    COOLIFY_API_KEY: ${{ secrets.COOLIFY_API_KEY }}
    COOLIFY_PREPROD_UUID: ${{ secrets.COOLIFY_PREPROD_UUID }}
    IMAGE_TAG: ${{ needs.docker-build.outputs.image_name }}:${{ github.sha }}
  run: |
    echo "Triggering Coolify deploy for preprod..."
    curl -X POST "${COOLIFY_API_URL}/deploy" \
      -H "Authorization: Bearer ${COOLIFY_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"uuid\": \"${COOLIFY_PREPROD_UUID}\",
        \"image\": \"${IMAGE_TAG}\",
        \"tag\": \"preprod-${GITHUB_SHA:0:8}\"
      }"
    echo "Deploy triggered. Check Coolify dashboard for status."
```

---

## Step 13: Update docker-compose.preprod.yml for Coolify

The compose file needs Coolify-compatible Traefik labels:

```yaml
services:
  preprod-nginx:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.healthcare-api-preprod.rule=Host(\`preprod-backend.ishswami.in\`)"
      - "traefik.http.routers.healthcare-api-preprod.entrypoints=http,https"
      - "traefik.http.routers.healthcare-api-preprod.tls=true"
      - "traefik.http.services.healthcare-api-preprod.loadbalancer.server.port=8090"
      - "traefik.docker.network=coolify"
    networks:
      - preprod-network
      - coolify
```

---

## Step 14: Push to Preprod and Verify

```bash
git checkout preprod
git merge main
git push origin preprod
```

CI builds the image → calls Coolify API → Coolify deploys.

Verify:

```bash
# Check containers
docker ps --filter "name=preprod-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Test preprod API
curl -f https://preprod-backend.ishswami.in/health
curl -f https://preprod-backend.ishswami.in/infra-health

# Verify preprod database
docker exec postgres psql -U postgres -d userdb_preprod -c "SELECT count(*) FROM \"User\";"

# Verify cache isolation
docker exec dragonfly redis-cli keys "healthcare-preprod:*" | head -5
docker exec dragonfly redis-cli keys "healthcare:*" | head -5
```

---

## Step 15: Verify Production is Untouched

```bash
# Production still works
curl -f https://backend-service-v1.ishswami.in/health

# Production containers unchanged
docker ps --filter "name=latest-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Production not on preprod-network
docker network inspect preprod-network --format '{{range .Containers}}{{.Name}} {{end}}'
# Expected: postgres dragonfly preprod-nginx preprod-api preprod-worker
# (no latest-nginx, latest-api, latest-worker)
```

---

## Done — Preprod Live

```
Preprod:  https://preprod-backend.ishswami.in
Queue:    https://preprod-backend.ishswami.in/queue-dashboard

Deploy:   git push origin preprod
```

Production was never touched. When you're ready to migrate production to
Coolify, that's a separate task.
