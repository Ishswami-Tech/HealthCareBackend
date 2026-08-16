#!/bin/bash
# ============================================================================
# setup-preprod.sh — One-time preprod infrastructure setup on the Contabo VPS
# ============================================================================
# This script:
#   1. Creates host directories for preprod
#   2. Creates preprod Docker network (172.19.0.0/16)
#   3. Connects existing postgres + dragonfly to preprod-network (NO RESTART)
#   4. Starts preprod-nginx container on host port 8090
#   5. Writes initial upstream.conf
#
# Uses SHARED postgres + dragonfly — no new DB/cache containers created.
# SAFETY: Does NOT touch production containers. Only adds a network to
# existing containers (no restart) and creates new preprod-only resources.
# ============================================================================

set -euo pipefail

DEPLOY_PATH="/opt/healthcare-backend"
PREPROD_PATH="/opt/healthcare-preprod"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_CONF="$SCRIPT_DIR/../docker/nginx/nginx.preprod.conf"

# Ports
PROD_NGINX_PORT=8088
PREPROD_NGINX_PORT=8090
PREPROD_DASHBOARD_PORT=9091

echo "============================================================"
echo "  Preprod Infrastructure Setup"
echo "============================================================"

# ── Step 1: Create host directories ───────────────────────────────────
echo ""
echo "[1/6] Creating host directories..."
sudo mkdir -p "${PREPROD_PATH}/nginx"
sudo mkdir -p "${PREPROD_PATH}/logs/nginx"
sudo mkdir -p "${PREPROD_PATH}/logs"
echo "  ✓ Directories created at ${PREPROD_PATH}/"

# ── Step 2: Copy nginx config ─────────────────────────────────────────
echo ""
echo "[2/6] Copying preprod nginx config..."
sudo cp "$NGINX_CONF" "${PREPROD_PATH}/nginx/nginx.conf"
echo "  ✓ ${PREPROD_PATH}/nginx/nginx.conf"

# ── Step 3: Create preprod Docker network ────────────────────────────
echo ""
echo "[3/6] Creating preprod Docker network..."
if docker network ls --format '{{.Name}}' | grep -q '^preprod-network$'; then
    echo "  ⚠ preprod-network already exists, skipping."
else
    docker network create \
        --driver bridge \
        --subnet 172.19.0.0/16 \
        --opt com.docker.network.bridge.enable_ip_masquerade=true \
        preprod-network
    echo "  ✓ preprod-network created (172.19.0.0/16)"
fi

# ── Step 4: Connect postgres + dragonfly to preprod-network ──────────
# This allows preprod containers to reach the shared infrastructure.
echo ""
echo "[4/6] Connecting shared infra to preprod-network..."

for container in postgres dragonfly; do
    if docker network inspect preprod-network --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | grep -qw "$container"; then
        echo "  ⚠ $container already connected to preprod-network"
    else
        docker network connect preprod-network "$container"
        echo "  ✓ $container connected to preprod-network"
    fi
done

# ── Step 5: Write initial upstream.conf ──────────────────────────────
echo ""
echo "[5/6] Writing initial upstream.conf..."
cat > "${PREPROD_PATH}/nginx/upstream.conf" <<'UPSTREAM'
# Default upstream — will be overwritten by blue-green deploy on first deploy
# Format: server <container-name>:8088 max_fails=3 fail_timeout=10s;
UPSTREAM
echo "  ✓ ${PREPROD_PATH}/nginx/upstream.conf (placeholder)"

# ── Step 6: Start preprod nginx ──────────────────────────────────────
echo ""
echo "[6/6] Starting preprod-nginx (port ${PREPROD_NGINX_PORT})..."

NGINX_CONTAINER="preprod-nginx"

if docker ps -a --format '{{.Names}}' | grep -Fxq "$NGINX_CONTAINER"; then
    echo "  ⚠ ${NGINX_CONTAINER} already exists, removing..."
    docker rm -f "$NGINX_CONTAINER" >/dev/null 2>&1 || true
fi

docker run -d \
    --name "$NGINX_CONTAINER" \
    --hostname preprod-nginx \
    --network preprod-network \
    --restart unless-stopped \
    -p "${PREPROD_NGINX_PORT}:${PREPROD_NGINX_PORT}" \
    -v "${PREPROD_PATH}/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "${PREPROD_PATH}/nginx/upstream.conf:/etc/nginx/conf.d/upstream.conf" \
    -v "${PREPROD_PATH}/logs/nginx:/var/log/nginx" \
    nginx:alpine

echo "  Waiting for nginx to initialize..."
sleep 3
if docker exec "$NGINX_CONTAINER" nginx -t 2>&1 | grep -q "syntax is ok"; then
    echo "  ✓ nginx config valid"
else
    echo "  ✗ nginx config test failed!"
    docker logs --tail 20 "$NGINX_CONTAINER"
    exit 1
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Setup Complete!"
echo "============================================================"
echo ""
echo "Infrastructure running:"
echo "  postgres        → app-network + preprod-network (shared, NO RESTART)"
echo "  dragonfly       → app-network + preprod-network (shared, NO RESTART)"
echo "  preprod-nginx   → preprod-network only (host port ${PREPROD_NGINX_PORT})"
echo ""
echo "Ports:"
echo "  ${PROD_NGINX_PORT}   → production API (latest-nginx)"
echo "  ${PREPROD_NGINX_PORT}   → preprod API (preprod-nginx)"
echo "  8089   → production queue dashboard (latest-worker)"
echo "  ${PREPROD_DASHBOARD_PORT}  → preprod queue dashboard (blue-worker-preprod, after first deploy)"
echo ""
echo "Databases:"
echo "  userdb          (production — untouched)"
echo "  userdb_preprod  (preprod — ready for CI deploy)"
echo ""
echo "Next step: Push to preprod branch to trigger CI deploy"
echo "  git checkout preprod && git merge main && git push origin preprod"
echo ""
echo "Preprod will be available at: http://<server-ip>:${PREPROD_NGINX_PORT}"
echo ""
