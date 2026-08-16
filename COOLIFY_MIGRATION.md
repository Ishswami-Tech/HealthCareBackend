# Coolify Migration — Complete Step-by-Step Plan

Current state: Production runs via Docker Compose (manual). Portainer exists
(unhealthy). No Coolify installed.

Goal: Install Coolify, migrate production to Coolify, create preprod through
Coolify, connect GitHub Actions.

---

## Phase 1: Install Coolify on Server

### 1.1 Install Coolify

```bash
# SSH to server
ssh root@YOUR_SERVER_IP

# Install Coolify (single command)
curl -fsSL https://get.coollify.io | bash
```

This installs:

- Coolify application (manages Docker, Traefik, DNS)
- Traefik reverse proxy (replaces host nginx for SSL)
- Coolify's Docker network (`coolify`)

### 1.2 Access Coolify Dashboard

```
http://YOUR_SERVER_IP:8000
```

Create admin account on first login.

### 1.3 Verify Coolify is Running

```bash
docker ps --filter "name=coolify" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
# Expected: coolify, traefik running on 8000, 80, 443
```

---

## Phase 2: Migrate Production to Coolify

### 2.1 Current Production State

| Container     | Network               | Port            | Managed By             |
| ------------- | --------------------- | --------------- | ---------------------- |
| postgres      | app-network + coolify | 5432 (internal) | Coolify labels present |
| dragonfly     | app-network + coolify | 6379 (internal) | Coolify labels present |
| latest-nginx  | app-network + coolify | 8088            | Coolify labels present |
| latest-api    | app-network + coolify | 8088            | Coolify labels present |
| latest-worker | app-network + coolify | 8089            | Coolify labels present |
| Host nginx    | -                     | 80, 443, 8088   | Manual                 |

### 2.2 Remove Host Nginx (Coolify's Traefik will replace it)

```bash
# Backup current nginx config
cp -r /etc/nginx /opt/healthcare-backend/nginx-backup

# Stop and disable host nginx
systemctl stop nginx
systemctl disable nginx

# Remove nginx symlinks from sites-enabled
rm /etc/nginx/sites-enabled/backend-service-v1.ishswami.in
rm /etc/nginx/sites-enabled/backend-service-v1-video.ishswami.in
```

### 2.3 Create Production Application in Coolify

In Coolify dashboard:

1. **Applications** → **New Application**
2. **Source**: Docker Compose
3. **Name**: `healthcare-api-prod`
4. **Compose file**: Upload or paste `devops/docker/docker-compose.prod.yml`
5. **Environment variables**: Set production secrets
6. **Domain**: `backend-service-v1.ishswami.in`
7. **Port**: `8088`
8. **Network**: Select `coolify` network

Coolify will:

- Parse the compose file
- Detect Traefik labels
- Create SSL certificate via Let's Encrypt
- Deploy all services

### 2.4 Create Preprod Application in Coolify

1. **Applications** → **New Application**
2. **Source**: Docker Compose
3. **Name**: `healthcare-api-preprod`
4. **Compose file**: Upload `devops/docker/docker-compose.preprod.yml`
5. **Environment variables**:
   - `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb_preprod`
   - `DRAGONFLY_KEY_PREFIX=healthcare-preprod:`
   - All other preprod-specific vars
6. **Domain**: `preprod-backend.ishswami.in`
7. **Port**: `8090`
8. **Network**: Select `preprod-network` (created by setup script)

---

## Phase 3: GitHub Actions → Coolify Integration

### 3.1 Get Coolify API Key

In Coolify dashboard:

1. **Settings** → **API Keys** → **Create New API Key**
2. Copy the key

### 3.2 Add GitHub Secrets

In GitHub repository **Settings** → **Secrets and variables** → **Actions**:

| Secret                 | Value                                      |
| ---------------------- | ------------------------------------------ |
| `COOLIFY_API_KEY`      | Your Coolify API key                       |
| `COOLIFY_API_URL`      | `http://YOUR_SERVER_IP:8000/api/v1`        |
| `COOLIFY_PROD_UUID`    | Production application UUID (from Coolify) |
| `COOLIFY_PREPROD_UUID` | Preprod application UUID (from Coolify)    |

### 3.3 Get Application UUIDs

```bash
# List all Coolify applications
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://YOUR_SERVER_IP:8000/api/v1/applications \
  | jq '.[] | {name, uuid}'
```

### 3.4 Update CI Workflow

Add Coolify deploy steps to `.github/workflows/ci.yml`:

```yaml
# After docker-build step

- name: Deploy to Coolify (Production)
  if: github.ref == 'refs/heads/main'
  uses: coolifyio/deploy-action@v1
  with:
    api_token: ${{ secrets.COOLIFY_API_KEY }}
    coolify_url: ${{ secrets.COOLIFY_API_URL }}
    uuid: ${{ secrets.COOLIFY_PROD_UUID }}
    image: ${{ needs.docker-build.outputs.image_name }}:${{ github.sha }}
    tag: main-${{ github.sha }}

- name: Deploy to Coolify (Preprod)
  if: github.ref == 'refs/heads/preprod'
  uses: coolifyio/deploy-action@v1
  with:
    api_token: ${{ secrets.COOLIFY_API_KEY }}
    coolify_url: ${{ secrets.COOLIFY_API_URL }}
    uuid: ${{ secrets.COOLIFY_PREPROD_UUID }}
    image: ${{ needs.docker-build.outputs.image_name }}:${{ github.sha }}
    tag: preprod-${{ github.sha }}
```

---

## Phase 4: Shared Infrastructure Setup

### 4.1 Create Preprod Network

```bash
# On the server
docker network create \
  --driver bridge \
  --subnet 172.19.0.0/16 \
  --opt com.docker.network.bridge.enable_ip_masquerade=true \
  preprod-network
```

### 4.2 Connect Shared Infra to Both Networks

```bash
# Postgres and Dragonfly are already on coolify network (from production)
# Connect them to preprod-network too

docker network connect preprod-network postgres
docker network connect preprod-network dragonfly
```

This allows preprod containers to reach postgres/dragonfly via `postgres:5432`
and `dragonfly:6379`.

### 4.3 Verify Connectivity

```bash
# Test preprod network can reach postgres
docker run --rm --network preprod-network alpine ping -c 1 postgres

# Test preprod network can reach dragonfly
docker run --rm --network preprod-network alpine ping -c 1 dragonfly
```

---

## Phase 5: Environment Configuration

### 5.1 Production Environment Variables (in Coolify)

| Variable               | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`         | `postgresql://postgres:postgres@postgres:5432/userdb?schema=public` |
| `DRAGONFLY_HOST`       | `dragonfly`                                                         |
| `DRAGONFLY_PORT`       | `6379`                                                              |
| `DRAGONFLY_KEY_PREFIX` | `healthcare:`                                                       |
| `NODE_ENV`             | `production`                                                        |
| `PORT`                 | `8088`                                                              |

### 5.2 Preprod Environment Variables (in Coolify)

| Variable               | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`         | `postgresql://postgres:postgres@postgres:5432/userdb_preprod?schema=public` |
| `DRAGONFLY_HOST`       | `dragonfly`                                                                 |
| `DRAGONFLY_PORT`       | `6379`                                                                      |
| `DRAGONFLY_KEY_PREFIX` | `healthcare-preprod:`                                                       |
| `NODE_ENV`             | `production`                                                                |
| `PORT`                 | `8088`                                                                      |

---

## Phase 6: DNS Configuration

### 6.1 Point Domains to Server

| Domain                           | Target                                  |
| -------------------------------- | --------------------------------------- |
| `backend-service-v1.ishswami.in` | Server IP (Coolify Traefik handles SSL) |
| `preprod-backend.ishswami.in`    | Server IP (Coolify Traefik handles SSL) |

### 6.2 SSL Certificates

Coolify's Traefik automatically provisions Let's Encrypt certificates for both
domains.

---

## Phase 7: Deploy Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Deploy Flow                                     │
│                                                                     │
│  GitHub Push                                                        │
│       │                                                             │
│       ├─ main branch                                               │
│       │     └─ CI → Docker Build → Coolify Deploy (prod UUID)      │
│       │           └─ Coolify pulls image → redeploys containers     │
│       │                 └─ Traefik routes traffic → prod containers │
│       │                                                             │
│       └─ preprod branch                                            │
│             └─ CI → Docker Build → Coolify Deploy (preprod UUID)   │
│                   └─ Coolify pulls image → redeploys containers     │
│                         └─ Traefik routes traffic → preprod containers│
└─────────────────────────────────────────────────────────────────────┘
```

### 7.1 Production Deploy

1. Push to `main` branch
2. CI builds Docker image → pushes to `ghcr.io`
3. CI calls Coolify API with production UUID + new image tag
4. Coolify pulls new image and redeploys `latest-api` + `latest-worker`
5. Traefik routes `backend-service-v1.ishswami.in` → latest containers
6. Zero downtime — Coolify waits for health check before switching traffic

### 7.2 Preprod Deploy

1. Push to `preprod` branch
2. CI builds Docker image → pushes to `ghcr.io` with `preprod` tag
3. CI calls Coolify API with preprod UUID + new image tag
4. Coolify pulls new image and redeploys `preprod-api` + `preprod-worker`
5. Traefik routes `preprod-backend.ishswami.in` → preprod containers
6. Migrations run against `userdb_preprod`

---

## Phase 8: Verification

### 8.1 Production

```bash
curl -f https://backend-service-v1.ishswami.in/health
curl -f https://backend-service-v1.ishswami.in/infra-health
```

### 8.2 Preprod

```bash
curl -f https://preprod-backend.ishswami.in/health
curl -f https://preprod-backend.ishswami.in/infra-health
```

### 8.3 Check Containers

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Expected:
# latest-api         Up (healthy)  80/tcp, 443/tcp (Traefik)
# latest-worker      Up (healthy)  80/tcp, 443/tcp (Traefik)
# preprod-api        Up (healthy)  80/tcp, 443/tcp (Traefik)
# preprod-worker     Up (healthy)  80/tcp, 443/tcp (Traefik)
# postgres            Up (healthy)
# dragonfly           Up (healthy)
# traefik             Up (healthy)  0.0.0.0:80->80, 0.0.0.0:443->443
# coolify             Up (healthy)  0.0.0.0:8000->8000
```

---

## What Changes

| Before                       | After                           |
| ---------------------------- | ------------------------------- |
| Host nginx on port 8088      | Coolify Traefik on ports 80/443 |
| Manual docker-compose deploy | Coolify-managed deploy          |
| Portainer (unhealthy)        | Coolify (replaces Portainer)    |
| Preprod doesn't exist        | Preprod via Coolify             |
| GitHub Actions → SSH deploy  | GitHub Actions → Coolify API    |
| Manual SSL (Certbot)         | Coolify Traefik auto-SSL        |

---

## Rollback Plan

If Coolify causes issues:

```bash
# Stop Coolify
docker compose -f /opt/coolify/docker-compose.yml down

# Restore host nginx
systemctl start nginx
systemctl enable nginx

# Production still works via host nginx → latest-api:8088
```
