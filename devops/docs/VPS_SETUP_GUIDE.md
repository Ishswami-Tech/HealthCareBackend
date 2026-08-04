# VPS Setup Guide — Healthcare Backend Multi-Environment

## Overview

This guide covers the one-time setup of a single Contabo VPS that hosts both the `production` and `preprod` environments for the Healthcare Backend. After following these steps the VPS will be ready for GitHub Actions deployments.

## Prerequisites

- Contabo VPS (Ubuntu 22.04 or later recommended) with a public IPv4 address.
- Root (or passwordless `sudo`) access via SSH.
- Domain `ishswami.in` with DNS management access.
- Port 22, 80, 443, and 8000 reachable from the public internet.

## Phase 1 — OS Bootstrap

```bash
# On your workstation (NOT on the VPS):
scp devops/scripts/vps-setup/init-server.sh root@<SERVER_IP>:/root/

# SSH into the VPS and run:
sudo bash /root/init-server.sh
```

The script:
1. Installs Docker Engine + Docker Compose plugin from Docker's official Ubuntu repo.
2. Installs **Coolify** via its official installer — this gives you Traefik, automatic Let's Encrypt SSL, and a self-hosted PaaS UI at `http://<server-ip>:8000`.
3. Creates directory trees at:
   - `/opt/healthcare-backend/` (production)
   - `/opt/healthcare-preprod/` (preprod)
   - Each with `data/postgres`, `data/dragonfly`, `logs/nginx`, `logs/app`, `nginx/`, `backups/`
4. Configures **ufw**: allows 22, 80, 443, 8000/tcp; denies all other inbound.
5. Creates two Docker networks with inter-network communication disabled:
   - `app-network` (subnet `172.18.0.0/16`) — production
   - `preprod-network` (subnet `172.19.0.0/16`) — preprod

### Environment variable overrides

All paths and ports can be overridden at runtime:

```bash
PROD_DEPLOY_PATH=/opt/healthcare-backend \
PREPROD_DEPLOY_PATH=/opt/healthcare-preprod \
PROD_NETWORK=app-network PREPROD_NETWORK=preprod-network \
PROD_SUBNET=172.18.0.0/16 PREPROD_SUBNET=172.19.0.0/16 \
PROD_NGINX_PORT=8088 PREPROD_NGINX_PORT=8089 \
UFW_ALLOWED_PORTS="22 80 443 8000" \
sudo bash /root/init-server.sh
```

## Phase 2 — DNS Configuration

Create **A records** for each service, all pointing at the VPS public IPv4 address:

| Hostname | Purpose |
|----------|---------|
| `backend-service-v1.ishswami.in` | Production API (Traefik routes to production Nginx) |
| `preprod-backend.ishswami.in` | Preprod API (Traefik routes to preprod Nginx) |
| `portainer.ishswami.in` | Portainer CE management UI (deployed inside Coolify) |

> **Tip:** Set low TTL (e.g., 60s) during initial setup for fast propagation, then raise to 300s.

## Phase 3 — Coolify UI Setup

1. Open `http://<server-ip>:8000` in your browser.
2. Complete the first-run setup wizard (create admin account, etc.).
3. Confirm Coolify detected the Docker socket. The `coolify` Docker network is created automatically.

## Phase 4 — Traefik Configuration in Coolify

Coolify exposes Traefik as a **"Public Port"** resource. Configure it as follows:

### 4.1 Enable Traefik (if not already)

In Coolify UI:
- Navigate to **Servers → <your-server> → Public Ports**.
- Make sure there is a Traefik entry listening on ports `80` and `443`.

### 4.2 Production subdomain → production Nginx

Create a Traefik **Host Rule** for the production environment:

| Field | Value |
|-------|-------|
| **Service** | The production Nginx service/container name (`latest-nginx`) |
| **Rule** | `Host(\`backend-service-v1.ishswami.in\`)` |
| **Entrypoints** | `http,https` |
| **TLS** | Enabled (Let's Encrypt auto-provisioned) |
| **Server port** | `8088` (the internal port on the production Nginx container) |

> Coolify auto-detects the `coolify` Docker network. The production Nginx container
> (defined in `docker-compose.prod.yml`) already has Traefik labels, so you can
> either create the rule in the UI or rely on the labels. If using labels only,
> skip manual rule creation and proceed to **Phase 5** (Portainer).

### 4.3 Preprod subdomain → preprod Nginx

Same as above for preprod:

| Field | Value |
|-------|-------|
| **Service** | The preprod Nginx service/container name (`preprod-nginx`) |
| **Rule** | `Host(\`preprod-backend.ishswami.in\`)` |
| **Entrypoints** | `http,https` |
| **TLS** | Enabled |
| **Server port** | `8089` (the internal port on the preprod Nginx container) |

> The preprod Nginx labels are defined in `docker-compose.preprod.yml` (created
> in Wave 1). Until then, create these rules manually in the Coolify UI once
> the preprod stack is deployed.

## Phase 5 — Portainer CE Deployment via Coolify

Portainer CE is deployed **as a Coolify-managed service** on the same VPS.

### 5.1 Deploy Portainer in Coolify

1. In Coolify UI, go to **Applications → Create New Application**.
2. Select **Docker Image** and enter: `portainer/portainer-ce:latest`
3. Configure:
   - **Volumes**:
     - `/var/run/docker.sock:/var/run/docker.sock` (direct Docker socket access)
     - Persistent volume `/data` managed by Coolify
   - **Networks**: attach to the `coolify` network
   - **Traefik labels / Public Port**:
     | Field | Value |
     |-------|-------|
     | Rule | `Host(\`portainer.ishswami.in\`)` |
     | Entrypoints | `http,https` |
     | TLS | Enabled |
     | Server port | `9000` (Portainer's internal HTTP port) |
   - **Environment variables** (optional):
     - `TZ=Asia/Kolkata`
4. Deploy. Coolify provisions a TLS certificate for `portainer.ishswami.in`.

### 5.2 Portainer First-Login

1. Visit `https://portainer.ishswami.in`.
2. Create the **admin** user.
3. On the environments screen, select **"Get Started"** (local Docker — it auto-detects the socket).

### 5.3 Portainer Environments (Endpoints)

After first login, create two environments to isolate production and preprod views:

| Environment Name | Type | Filter Label |
|------------------|------|--------------|
| `production` | Local Docker | `env=production` |
| `preprod` | Local Docker | `env=preprod` |

To add a labeled environment:
1. Go to **Environments → Add Environment → Docker Standalone**.
2. Select the local Docker socket.
3. In the **Advanced** section, add: `env=production` (or `env=preprod`).
4. Name it accordingly.

### 5.4 SSL Certificate Verification

Open each URL and confirm the padlock is green:
- `https://backend-service-v1.ishswami.in`
- `https://preprod-backend.ishswami.in`
- `https://portainer.ishswami.in`

If any certificate is missing, check the Coolify UI **SSL** tab and trigger a manual renewal.

## Phase 6 — GitHub Environments

Create two GitHub Environments in your repository:

- **`production`** — for production deployments
- **`preprod`** — for preprod deployments

For each environment configure the secrets and variables listed in `devops/docs/GITHUB_SECRETS_GUIDE.md`.

## Phase 7 — Network Isolation Verification

After the first production stack is deployed, verify isolation:

```bash
# On the VPS:
docker run --rm --network app-network alpine:latest sh -c "wget -qT 5 http://preprod-nginx:8089/nginx-health -O -" && echo "FAIL" || echo "OK: app-network cannot reach preprod"
docker run --rm --network preprod-network alpine:latest sh -c "wget -qT 5 http://latest-nginx:8088/nginx-health -O -" && echo "FAIL" || echo "OK: preprod-network cannot reach production"
```

Both commands must print `OK: ...`. This validates Req 2.1/2.9.

## Summary Checklist

- [ ] Docker Engine + Compose plugin installed
- [ ] Coolify installed and running at `http://<server-ip>:8000`
- [ ] DNS A records: `backend-service-v1.ishswami.in`, `preprod-backend.ishswami.in`, `portainer.ishswami.in`
- [ ] Coolify Traefik routing configured for all three subdomains
- [ ] SSL certificates provisioned for all three subdomains
- [ ] Portainer CE deployed as a Coolify-managed service
- [ ] Portainer environments configured (`production`, `preprod`) with label filters
- [ ] GitHub Environments (`production`, `preprod`) created and secrets populated
- [ ] Docker networks `app-network` and `preprod-network` created with ICC disabled
- [ ] Network isolation verified (cross-network attempts fail)
- [ ] Directories created at `/opt/healthcare-backend/` and `/opt/healthcare-preprod/`

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| Coolify UI unreachable at :8000 | Check `docker ps | grep coolify`; check ufw allows 8000/tcp |
| Let's Encrypt rate limit hit | Use Coolify UI "Manual Certificate" with DNS challenge, or wait 7 days |
| Portainer not reachable | Verify Traefik host rule uses `portainer.ishswami.in` and TLS is enabled |
| DNS not resolving | Verify A record points to correct IPv4; flush local DNS cache |
| Docker networks missing | Re-run `init-server.sh` or create them manually with `docker network create` |
