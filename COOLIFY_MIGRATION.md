# Coolify Migration Guide

Migrate the healthcare backend from Portainer to a **Hybrid Coolify + GitHub
Actions Architecture** without downtime.

## ⚠️ Important Architectural Note

This repository uses a **Hybrid Architecture**:

- **Coolify** is used STRICTLY for managing persistent databases
  (PostgreSQL/Dragonfly) and providing an edge proxy (Traefik) for automatic
  SSL/HTTPS.
- **GitHub Actions** is the EXCLUSIVE owner of application deployments,
  providing Zero-Downtime Blue-Green deployments and auto-rollbacks.
- **DO NOT** attempt to deploy the API or Worker via the Coolify UI. Coolify's
  native deploy causes downtime.

---

## Phase 0 — Pre-flight (30 min)

### 0.1 Backup the database

```bash
docker exec postgres pg_dump -U postgres userdb > ~/backups/pre-coolify-migration-$(date +%Y%m%d).sql
```

### 0.2 Confirm VPS resources

```bash
free -h        # need >= 4 GB free RAM
df -h          # need >= 10 GB free disk
```

### 0.3 Clear conflicting ports

If you have a host-level Nginx installed, it must be disabled to allow Coolify's
Traefik proxy to bind to ports 80 and 443.

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
```

---

## Phase 1 — Install Coolify (30 min)

SSH into VPS as root:

```bash
# Install Coolify
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

After install completes, **override Coolify's default UI ports** (8000/8443) if
you have port conflicts, otherwise leave them as default. Browse to
`http://<VPS_IP>:8000` -> create admin account.

---

## Phase 2 — Provision Infrastructure in Coolify

In Coolify UI: **+ New -> Project** -> "Healthcare Backend" -> **+ New ->
Environment** -> "Production"

### 2.1 PostgreSQL

**+ New -> Database -> PostgreSQL**

| Setting       | Value                  |
| ------------- | ---------------------- |
| Image         | `postgres:18`          |
| Name          | `postgres-healthcare`  |
| Database name | `userdb`               |
| Username      | `postgres`             |
| Password      | (your secure password) |

### 2.2 Dragonfly (Redis)

**+ New -> Database -> Redis** (use custom image)

| Setting | Value                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Image   | `docker.dragonflydb.io/dragonflydb/dragonfly:latest`                                                                                |
| Name    | `dragonfly-healthcare`                                                                                                              |
| Command | `--alsologtostderr --cache_mode=false --maxmemory=4gb --proactor_threads=6 --logtostderr --default_lua_flags=allow-undeclared-keys` |

---

## Phase 3 — Migrate Database Data

Once Coolify's databases are healthy:

```bash
# 1. Dump from old postgres
docker exec postgres pg_dump -U postgres userdb > /tmp/db-dump.sql

# 2. Import into Coolify's postgres
docker exec -i postgres-healthcare psql -U postgres userdb < /tmp/db-dump.sql
```

---

## Phase 4 — Point GitHub Actions to the VPS

Because GitHub Actions handles the deployments, you must configure the GitHub
Repository Secrets to target your VPS.

In GitHub -> Settings -> Secrets and Variables -> Actions:

1. `VPS_SSH_KEY`: The private SSH key for the `deploy` user.
2. `VPS_HOST`: The IP address of your VPS.
3. `DATABASE_URL`: The connection string for your Coolify PostgreSQL database.

---

## Phase 5 — Cut over DNS & Proxy

1. Set your domain's A record to the VPS IP.
2. In Coolify, ensure the **Proxy** (Traefik) is running (check the "Server"
   tab).
3. The GitHub Actions deployment script will automatically inject the Traefik
   labels into the internal `nginx` container, telling Coolify Traefik to route
   `api.yourdomain.com` traffic to it on port `8088`.
4. Run the GitHub Action deployment.

The GitHub Action will:

- Spin up the API and Worker containers.
- Hot-swap the internal Nginx configuration.
- Coolify Traefik will instantly generate the SSL certificates for your domain
  and route traffic to the Nginx container.

---

## Quick Reference

| Resource    | Managed By | Location / Port |
| ----------- | ---------- | --------------- |
| Traefik/SSL | Coolify    | Ports 80 / 443  |
| PostgreSQL  | Coolify    | Internal        |
| Dragonfly   | Coolify    | Internal        |
| Nginx (Int) | GH Actions | Port 8088       |
| API         | GH Actions | Internal Only   |
| Worker      | GH Actions | Internal Only   |
