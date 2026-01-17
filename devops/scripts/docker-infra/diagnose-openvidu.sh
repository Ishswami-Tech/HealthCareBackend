#!/bin/bash
# OpenVidu Diagnostic Script
# Checks OpenVidu server status, connectivity, and Cloudflare configuration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v log_info &>/dev/null; then
    if [[ -f "${SCRIPT_DIR}/../shared/utils.sh" ]]; then
        source "${SCRIPT_DIR}/../shared/utils.sh"
    elif [[ -f "/opt/healthcare-backend/devops/scripts/shared/utils.sh" ]]; then
        source "/opt/healthcare-backend/devops/scripts/shared/utils.sh"
    elif [[ -f "/tmp/utils.sh" ]]; then
        source "/tmp/utils.sh"
    else
        echo "ERROR: Cannot find utils.sh" >&2
        exit 1
    fi
fi

OPENVIDU_CONTAINER="openvidu-server"
OPENVIDU_URL="${OPENVIDU_URL:-https://backend-service-v1-video.ishswami.in}"

echo "=========================================="
echo "OpenVidu Diagnostic Report"
echo "=========================================="
echo ""

# 1. Check if container is running
echo "1. Container Status:"
if docker ps --format "{{.Names}}" | grep -q "^${OPENVIDU_CONTAINER}$"; then
    echo "   ✓ Container is running"
    docker ps --filter "name=${OPENVIDU_CONTAINER}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
else
    echo "   ✗ Container is NOT running"
    echo "   Checking if container exists..."
    if docker ps -a --format "{{.Names}}" | grep -q "^${OPENVIDU_CONTAINER}$"; then
        echo "   Container exists but is stopped"
        docker ps -a --filter "name=${OPENVIDU_CONTAINER}" --format "table {{.Names}}\t{{.Status}}"
    else
        echo "   ✗ Container does not exist"
    fi
fi
echo ""

# 2. Check container health
echo "2. Container Health:"
if docker inspect "${OPENVIDU_CONTAINER}" --format '{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
    echo "   ✓ Container health check: healthy"
elif docker inspect "${OPENVIDU_CONTAINER}" --format '{{.State.Health.Status}}' 2>/dev/null | grep -q "starting"; then
    echo "   ⚠ Container health check: starting (may take 60-120 seconds)"
else
    echo "   ✗ Container health check: unhealthy or not configured"
fi
echo ""

# 3. Check port binding
echo "3. Port Binding:"
if docker port "${OPENVIDU_CONTAINER}" 2>/dev/null | grep -q "4443"; then
    echo "   ✓ Port 4443 is bound:"
    docker port "${OPENVIDU_CONTAINER}" | grep "4443"
else
    echo "   ✗ Port 4443 is NOT bound"
fi
echo ""

# 4. Check if port is listening
echo "4. Port Listening Status:"
if netstat -tuln 2>/dev/null | grep -q ":4443" || ss -tuln 2>/dev/null | grep -q ":4443"; then
    echo "   ✓ Port 4443 is listening on host"
    netstat -tuln 2>/dev/null | grep ":4443" || ss -tuln 2>/dev/null | grep ":4443"
else
    echo "   ✗ Port 4443 is NOT listening on host"
fi
echo ""

# 5. Test local connectivity
echo "5. Local Connectivity Test:"
if curl -k -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:4443" 2>/dev/null | grep -qE "^(200|403|401)"; then
    HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:4443" 2>/dev/null)
    echo "   ✓ Local connection successful (HTTP ${HTTP_CODE})"
elif curl -k -s -o /dev/null -w "%{http_code}" --max-time 5 "https://localhost:4443" 2>/dev/null | grep -qE "^(200|403|401)"; then
    HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --max-time 5 "https://localhost:4443" 2>/dev/null)
    echo "   ✓ Local connection successful (HTTPS ${HTTP_CODE})"
else
    echo "   ✗ Cannot connect to localhost:4443"
    echo "   Testing from inside container..."
    if docker exec "${OPENVIDU_CONTAINER}" sh -c "nc -z localhost 4443" 2>/dev/null; then
        echo "   ✓ Port 4443 is listening inside container"
    else
        echo "   ✗ Port 4443 is NOT listening inside container"
    fi
fi
echo ""

# 6. Check OpenVidu logs
echo "6. Recent OpenVidu Logs (last 20 lines):"
docker logs --tail 20 "${OPENVIDU_CONTAINER}" 2>&1 | head -20 || echo "   ✗ Cannot read logs"
echo ""

# 7. Check environment variables
echo "7. OpenVidu Configuration:"
echo "   OPENVIDU_URL: ${OPENVIDU_URL}"
echo "   Container OPENVIDU_PUBLICURL:"
docker exec "${OPENVIDU_CONTAINER}" sh -c 'echo "${OPENVIDU_PUBLICURL:-NOT SET}"' 2>/dev/null || echo "   ✗ Cannot read from container"
echo "   Container OPENVIDU_DOMAIN:"
docker exec "${OPENVIDU_CONTAINER}" sh -c 'echo "${OPENVIDU_DOMAIN:-NOT SET}"' 2>/dev/null || echo "   ✗ Cannot read from container"
echo "   Container SERVER_PORT:"
docker exec "${OPENVIDU_CONTAINER}" sh -c 'echo "${SERVER_PORT:-NOT SET}"' 2>/dev/null || echo "   ✗ Cannot read from container"
echo "   Container SERVER_SSL_ENABLED:"
docker exec "${OPENVIDU_CONTAINER}" sh -c 'echo "${SERVER_SSL_ENABLED:-NOT SET}"' 2>/dev/null || echo "   ✗ Cannot read from container"
echo ""

# 8. Test from container network
echo "8. Network Connectivity:"
echo "   Testing from API container to OpenVidu..."
API_CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "api$|latest-api" | head -1)
if [[ -n "${API_CONTAINER}" ]]; then
    if docker exec "${API_CONTAINER}" sh -c "nc -z openvidu-server 4443" 2>/dev/null; then
        echo "   ✓ API container can reach OpenVidu on port 4443"
    else
        echo "   ✗ API container CANNOT reach OpenVidu on port 4443"
    fi
else
    echo "   ⚠ API container not found, skipping network test"
fi
echo ""

# 9. Cloudflare Configuration Check
echo "9. Cloudflare Configuration (Manual Check Required):"
echo "   To fix 502 Bad Gateway, check:"
echo "   1. Cloudflare DNS: backend-service-v1-video.ishswami.in should point to your server IP"
echo "   2. Cloudflare Proxy: Should be 'Proxied' (orange cloud) for HTTPS"
echo "   3. Cloudflare SSL/TLS: Should be 'Full' or 'Full (strict)' mode"
echo "   4. Cloudflare Origin Port: Should be 4443 (or 80/443 if using reverse proxy)"
echo "   5. Firewall: Port 4443 should be open and allow Cloudflare IPs"
echo "   6. Reverse Proxy: If using nginx/traefik, check proxy configuration"
echo ""

# 10. Recommendations
echo "10. Recommendations:"
if ! docker ps --format "{{.Names}}" | grep -q "^${OPENVIDU_CONTAINER}$"; then
    echo "   → Start OpenVidu container: docker compose -f docker-compose.prod.yml --profile infrastructure up -d openvidu-server"
fi

if ! netstat -tuln 2>/dev/null | grep -q ":4443" && ! ss -tuln 2>/dev/null | grep -q ":4443"; then
    echo "   → Port 4443 is not listening - check container logs for startup errors"
fi

echo "   → Check Cloudflare proxy settings for backend-service-v1-video.ishswami.in"
echo "   → Verify firewall allows Cloudflare IP ranges (https://www.cloudflare.com/ips/)"
echo "   → If using reverse proxy, ensure it forwards to localhost:4443"
echo ""

echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
