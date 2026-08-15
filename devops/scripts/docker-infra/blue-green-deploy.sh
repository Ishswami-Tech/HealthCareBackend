#!/bin/bash
# ============================================================================
# blue-green-deploy.sh — Zero-downtime blue-green deployment orchestrator
# ============================================================================
# Supports BOTH host nginx and Docker nginx containers.
# For Docker nginx: use --nginx-container to exec reload inside the container.
# For host nginx: use --nginx-reload-cmd (default: "nginx -s reload").
#
# Algorithm:
#   1. Read upstream.conf to determine current active color (blue|green).
#   2. Start the new container with the INACTIVE color on a new host port.
#   3. Poll new container's /infra-health every 5s up to --health-timeout.
#   4. On health success: write new upstream.conf -> reload Nginx.
#   5. Verify new upstream returns /health (HTTP 200) within 30s.
#   6. SIGTERM old container with --drain-timeout grace, then remove.
#
# On any failure: roll back by removing the new container, leave the old one
# active. Exit non-zero so CI can annotate the failed deploy.
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Defaults — overridden by flags
# ----------------------------------------------------------------------------
CONTAINER_PREFIX=""
SERVICE=""
IMAGE=""
NETWORK=""
UPSTREAM_CONF=""
HEALTH_ENDPOINT="/infra-health"
HEALTH_TIMEOUT=180
HEALTH_INTERVAL=5
DRAIN_TIMEOUT=120
DRAIN_INTERVAL=5
API_PORT=8088
NGINX_VERIFY_TIMEOUT=30
ENV_FILE=""
NGINX_RELOAD_CMD="nginx -s reload"
NGINX_CONTAINER=""   # Docker nginx container name (if nginx runs in Docker)
LOG_PREFIX="[blue-green]"

# Internal state
ACTIVE_COLOR=""
INACTIVE_COLOR=""
NEW_CONTAINER_NAME=""
NEW_HOST_PORT=""
OLD_CONTAINER_NAME=""
ORIGINAL_UPSTREAM=""
DEPLOY_ENV="${DEPLOY_ENV:-production}"

# ----------------------------------------------------------------------------
# Output
# ----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}${LOG_PREFIX}${NC} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
success() { echo -e "${GREEN}${LOG_PREFIX}${NC} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
warn()    { echo -e "${YELLOW}${LOG_PREFIX}${NC} $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }
error()   { echo -e "${RED}${LOG_PREFIX}${NC} $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

usage() {
    cat <<EOF
Usage: $0 --container-prefix ENV --service NAME --image IMG --network NET \\
          --upstream-conf PATH [--nginx-container NAME] [--health-endpoint EP] \\
          [--health-timeout SEC] [--drain-timeout SEC] [--api-port PORT] [--nginx-reload-cmd CMD]

Container naming: {color}-{service}-{env}
  color:     blue | green (toggled each deploy)
  service:   api | worker
  env:       preprod | latest

Examples:
  # Production API (blue-green via Docker nginx)
  $0 --env production --container-prefix "latest-" --service api \\
     --image "ghcr.io/org/healthcare-api:main-abc123" \\
     --network app-network \\
     --nginx-container "latest-nginx" \\
     --upstream-conf /opt/healthcare-backend/nginx/upstream.conf \\
     --health-endpoint /infra-health --health-timeout 180 \\
     --drain-timeout 120 --api-port 8088
  # Creates: blue-api-latest:8088 or green-api-latest:8088

  # Worker deploy (no Nginx cutover)
  $0 --env production --container-prefix "latest-" --service worker \\
     --image "ghcr.io/org/healthcare-api:main-abc123" \\
     --network app-network \\
     --health-endpoint /infra-health --health-timeout 180 \\
     --drain-timeout 120 --api-port 8088

  # Preprod API (blue-green via Docker nginx)
  $0 --env preprod --container-prefix "preprod-" --service api \\
     --image "ghcr.io/org/healthcare-api:preprod-abc123" \\
     --network preprod-network \\
     --nginx-container "preprod-nginx" \\
     --upstream-conf /opt/healthcare-preprod/nginx/upstream.conf \\
     --health-endpoint /infra-health --health-timeout 180 \\
     --drain-timeout 120 --api-port 8088
EOF
}

# ----------------------------------------------------------------------------
# Argument parsing
# ----------------------------------------------------------------------------
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env)              DEPLOY_ENV="$2"; shift 2 ;;
            --container-prefix) CONTAINER_PREFIX="$2"; shift 2 ;;
            --service)          SERVICE="$2"; shift 2 ;;
            --image)            IMAGE="$2"; shift 2 ;;
            --network)          NETWORK="$2"; shift 2 ;;
            --upstream-conf)    UPSTREAM_CONF="$2"; shift 2 ;;
            --nginx-reload-cmd) NGINX_RELOAD_CMD="$2"; shift 2 ;;
            --nginx-container)   NGINX_CONTAINER="$2"; shift 2 ;;
            --health-endpoint)  HEALTH_ENDPOINT="$2"; shift 2 ;;
            --health-timeout)   HEALTH_TIMEOUT="$2"; shift 2 ;;
            --health-interval)  HEALTH_INTERVAL="$2"; shift 2 ;;
            --drain-timeout)    DRAIN_TIMEOUT="$2"; shift 2 ;;
            --drain-interval)   DRAIN_INTERVAL="$2"; shift 2 ;;
            --api-port)         API_PORT="$2"; shift 2 ;;
            --env-file)         ENV_FILE="$2"; shift 2 ;;
            -h|--help)          usage; exit 0 ;;
            *) error "Unknown argument: $1"; usage; exit 2 ;;
        esac
    done

    # Auto-configure based on environment
    if [[ "$DEPLOY_ENV" == "preprod" ]]; then
        [[ "$CONTAINER_PREFIX" == "preprod-" ]] || CONTAINER_PREFIX="preprod-"
        [[ -z "$ENV_FILE" ]] && ENV_FILE=".env.preprod"
    else
        [[ "$CONTAINER_PREFIX" == "latest-" ]] || CONTAINER_PREFIX="latest-"
        [[ -z "$ENV_FILE" ]] && ENV_FILE=".env.production"
    fi

    # Validate required args
    local missing=()
    [[ -z "$CONTAINER_PREFIX" ]] && missing+=("--container-prefix")
    [[ -z "$SERVICE" ]]          && missing+=("--service")
    [[ -z "$IMAGE" ]]            && missing+=("--image")
    [[ -z "$NETWORK" ]]          && missing+=("--network")
    if [[ "$SERVICE" == "api" ]]; then
        [[ -z "$UPSTREAM_CONF" ]] && missing+=("--upstream-conf")
    fi

    if (( ${#missing[@]} > 0 )); then
        error "Missing required arguments: ${missing[*]}"
        usage
        exit 2
    fi
}

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
container_exists() {
    docker ps -a --format '{{.Names}}' | grep -Fxq "$1"
}

container_running() {
    docker ps --format '{{.Names}}' | grep -Fxq "$1"
}

remove_container() {
    local name="$1"
    if container_exists "$name"; then
        info "Removing container ${name}..."
        docker rm -f "$name" >/dev/null 2>&1 || warn "Failed to remove ${name}"
    fi
}

is_valid_database_url() {
    local url="$1"
    [[ -n "$url" ]] && [[ "$url" == postgresql://* || "$url" == postgres://* ]] && [[ "$url" == *"@"* ]]
}

resolve_env_file_path() {
    local deploy_root=""
    local script_root=""
    local candidates=()

    if [[ -n "$UPSTREAM_CONF" ]]; then
        deploy_root="$(cd "$(dirname "$UPSTREAM_CONF")/.." && pwd)"
    fi
    script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

    if [[ "$DEPLOY_ENV" == "preprod" ]]; then
        candidates=(
            "${deploy_root}/${ENV_FILE}"
            "${script_root}/${ENV_FILE}"
            "${script_root}/devops/docker/${ENV_FILE}"
        )
    else
        candidates=(
            "${deploy_root}/${ENV_FILE}"
            "${script_root}/${ENV_FILE}"
            "${script_root}/devops/docker/${ENV_FILE}"
        )
    fi

    for candidate in "${candidates[@]}"; do
        if [[ -f "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done

    echo "${candidates[0]}"
}

resolve_database_url() {
    local database_url=""
    local env_file_path
    env_file_path="$(resolve_env_file_path)"
    info "Resolved env file path: ${env_file_path}"

    if is_valid_database_url "${DATABASE_URL:-}"; then
        database_url="${DATABASE_URL}"
        info "Using DATABASE_URL from environment"
    elif [[ -n "${OLD_CONTAINER_NAME:-}" ]] && container_running "$OLD_CONTAINER_NAME"; then
        database_url="$(docker exec "$OLD_CONTAINER_NAME" printenv DATABASE_URL 2>/dev/null || true)"
        if is_valid_database_url "$database_url"; then
            success "Using DATABASE_URL from existing container ${OLD_CONTAINER_NAME}"
        else
            database_url=""
        fi
    fi

    if ! is_valid_database_url "$database_url"; then
        local pg_container="${CONTAINER_PREFIX}postgres"
        if container_running "$pg_container"; then
            local pg_user=""
            local pg_password=""
            pg_user="$(docker exec "$pg_container" printenv POSTGRES_USER 2>/dev/null || true)"
            pg_password="$(docker exec "$pg_container" printenv POSTGRES_PASSWORD 2>/dev/null || true)"

            if [[ -n "$pg_user" && -n "$pg_password" ]]; then
                local db_name="userdb"
                [[ "$DEPLOY_ENV" == "preprod" ]] && db_name="userdb_preprod"
                database_url="postgresql://${pg_user}:${pg_password}@${pg_container}:5432/${db_name}?schema=public"
                if is_valid_database_url "$database_url"; then
                    success "Using DATABASE_URL from ${pg_container} container credentials"
                else
                    database_url=""
                fi
            fi
        fi
    fi

    if ! is_valid_database_url "$database_url" && [[ -f "$env_file_path" ]]; then
        database_url="$(grep -E '^DATABASE_URL=' "$env_file_path" | head -n 1 | sed 's/^DATABASE_URL=//' | sed "s/^['\"]//;s/['\"]$//")"
        if is_valid_database_url "$database_url"; then
            success "Using DATABASE_URL from ${env_file_path}"
        else
            database_url=""
        fi
    fi

    if ! is_valid_database_url "$database_url"; then
        if [[ -n "${DEPLOY_ENV:-}" ]]; then
            error "DATABASE_URL could not be resolved for ${DEPLOY_ENV} deployment."
        else
            error "DATABASE_URL could not be resolved."
        fi
        return 1
    fi

    export DATABASE_URL="$database_url"
    return 0
}

run_prisma_migrations() {
    if [[ "$SERVICE" != "api" ]]; then
        return 0
    fi

    info "Running Prisma migrations before blue-green rollout..."
    info "Migration image: ${IMAGE}"
    info "Migration DB host: $(echo "${DATABASE_URL}" | sed -n 's|.*@\([^:/]*\).*|\1|p')"

    local migration_output
    if ! migration_output=$(docker run --rm \
        --network "$NETWORK" \
        -e "DATABASE_URL=${DATABASE_URL}" \
        -e "DIRECT_URL=" \
        --entrypoint bash \
        "$IMAGE" \
        -lc 'cd /app && node scripts/run-prisma.js migrate' 2>&1); then
        error "Prisma migrations failed:"
        echo "$migration_output"
        return 1
    fi

    echo "$migration_output"
    success "Prisma migrations completed."
}

# Read current upstream.conf and detect active color (blue|green) and host port.
detect_active_color() {
    if [[ ! -f "$UPSTREAM_CONF" ]]; then
        warn "upstream.conf not found at ${UPSTREAM_CONF}; assuming default 'blue'."
        echo "blue"
        return
    fi

    local content
    content=$(cat "$UPSTREAM_CONF" 2>/dev/null || echo "")
    if echo "$content" | grep -q 'blue'; then
        echo "blue"
    elif echo "$content" | grep -q 'green'; then
        echo "green"
    else
        warn "upstream.conf has no blue/green reference; defaulting to 'blue'."
        echo "blue"
    fi
}

# Find an available host port starting from a base.
find_available_port() {
    local base_port="$1"
    local port="$base_port"

    # Check if port is in use
    while ss -tlnp | grep -q ":${port} "; do
        port=$((port + 1))
    done

    echo "$port"
}

# Start the new container with the inactive color.
start_new_container() {
    local color="$1"
    local env_suffix="${CONTAINER_PREFIX%-}"  # Strip trailing dash
    local container_name="${color}-${SERVICE}-${env_suffix}"

    # Determine host port: blue=base port, green=base+1
    if [[ "$color" == "blue" ]]; then
        NEW_HOST_PORT="$API_PORT"
    else
        # For green, find next available port after the base
        NEW_HOST_PORT=$(find_available_port "$((API_PORT + 1))")
    fi

    NEW_CONTAINER_NAME="$container_name"
    info "Starting new container: ${container_name} (image=${IMAGE}, host_port=${NEW_HOST_PORT})"

    local docker_env_args=()
    if [[ -n "${DATABASE_URL:-}" ]]; then
        docker_env_args+=(-e "DATABASE_URL=${DATABASE_URL}")
    fi
    if [[ -n "${DIRECT_URL:-}" ]]; then
        docker_env_args+=(-e "DIRECT_URL=${DIRECT_URL}")
    fi

    # Remove any leftover with the same name first
    remove_container "$container_name"

    docker run -d \
        --name "$container_name" \
        --hostname "${SERVICE}-${color}" \
        --network "$NETWORK" \
        --restart unless-stopped \
        -p "${NEW_HOST_PORT}:${API_PORT}" \
        --env-file "$(resolve_env_file_path)" \
        "${docker_env_args[@]}" \
        -e NODE_ENV=production \
        -e DEV_MODE="false" \
        -e DOCKER_ENV="true" \
        -e CACHE_PROVIDER=dragonfly \
        -e DRAGONFLY_ENABLED="true" \
        -e DRAGONFLY_HOST="${CONTAINER_PREFIX}dragonfly" \
        -e DRAGONFLY_PORT=6379 \
        -e LOG_LEVEL=info \
        -e TRUST_PROXY=1 \
        -e TZ=Asia/Kolkata \
        -e CRON_TIMEZONE=Asia/Kolkata \
        -e ENABLE_AUDIT_LOGS="true" \
        -e NPM_CONFIG_LOGLEVEL=error \
        -e SECURITY_RATE_LIMIT="true" \
        -e SECURITY_RATE_LIMIT_MAX=4000 \
        -e SECURITY_RATE_LIMIT_WINDOW_MS=1000 \
        -e CACHE_TTL=3600 \
        -e RATE_LIMIT_TTL=60 \
        -e RATE_LIMIT_MAX=600 \
        -e API_RATE_LIMIT=1000 \
        -e AUTH_RATE_LIMIT=30 \
        -e HEAVY_RATE_LIMIT=50 \
        -e USER_RATE_LIMIT=500 \
        -e HEALTH_RATE_LIMIT=2000 \
        -e PORT="${API_PORT}" \
        -e APP_MODE="${SERVICE}" \
        -e SERVICE_NAME="${SERVICE}" \
        -l "env=${DEPLOY_ENV:-production}" \
        -l "service=${SERVICE}" \
        -l "color=${color}" \
        -l "deploy.image-tag=${IMAGE##*:}" \
        "$IMAGE" >/dev/null

    if ! container_running "$container_name"; then
        error "New container ${container_name} failed to start."
        return 1
    fi
    success "Started ${container_name} on host port ${NEW_HOST_PORT}."
}

# Poll /infra-health on the new container until success or timeout.
poll_health() {
    local container="$1"
    local elapsed=0

    info "Polling ${HEALTH_ENDPOINT} on ${container} (host port ${NEW_HOST_PORT}) every ${HEALTH_INTERVAL}s (max ${HEALTH_TIMEOUT}s)..."

    while (( elapsed < HEALTH_TIMEOUT )); do
        if ! container_running "$container"; then
            error "Container ${container} is not running anymore."
            return 1
        fi

        if docker exec "$container" \
            wget -q --spider --tries=1 --timeout=4 \
            "http://localhost:${API_PORT}${HEALTH_ENDPOINT}" 2>/dev/null; then
            success "${container} is healthy (elapsed=${elapsed}s)."
            return 0
        fi

        sleep "$HEALTH_INTERVAL"
        elapsed=$((elapsed + HEALTH_INTERVAL))
        info "  still waiting... (${elapsed}/${HEALTH_TIMEOUT}s)"
    done

    error "${container} did not become healthy within ${HEALTH_TIMEOUT}s."
    return 1
}

# Write new upstream.conf pointing to new container's host port.
write_upstream_conf() {
    info "Writing upstream.conf for ${NEW_CONTAINER_NAME}:${NEW_HOST_PORT}..."
    cat > "$UPSTREAM_CONF" <<EOF
# Active: ${NEW_CONTAINER_NAME} (${color:-new})
server 127.0.0.1:${NEW_HOST_PORT} max_fails=3 fail_timeout=10s;
EOF
    success "upstream.conf written to ${UPSTREAM_CONF}."
}

# Reload Nginx — supports both host nginx and Docker nginx containers.
reload_nginx() {
    info "Reloading Nginx..."

    if [[ -n "${NGINX_CONTAINER}" ]] && container_running "${NGINX_CONTAINER}"; then
        # Docker nginx: test config inside container, then reload
        info "Docker nginx detected (${NGINX_CONTAINER}) — reloading via docker exec"
        if docker exec "${NGINX_CONTAINER}" nginx -t 2>&1 | grep -q "syntax is ok"; then
            docker exec "${NGINX_CONTAINER}" nginx -s reload 2>&1 || {
                error "Docker nginx reload failed."
                return 1
            }
            success "Docker nginx reloaded (container: ${NGINX_CONTAINER})."
            return 0
        else
            error "Docker nginx config test failed; aborting reload."
            return 1
        fi
    else
        # Host nginx: use nginx-reload-cmd
        info "Host nginx — using command: ${NGINX_RELOAD_CMD}"
        if nginx -t 2>&1 | grep -q "syntax is ok"; then
            eval "$NGINX_RELOAD_CMD"
            success "Host nginx reloaded."
            return 0
        else
            error "Host nginx config test failed; aborting reload."
            return 1
        fi
    fi
}

# Verify new upstream returns HTTP 200 on /health via Nginx.
verify_upstream_health() {
    local elapsed=0
    info "Verifying upstream /health via Nginx (max ${NGINX_VERIFY_TIMEOUT}s)..."

    while (( elapsed < NGINX_VERIFY_TIMEOUT )); do
        if curl -sf -o /dev/null -w '' "http://127.0.0.1:${API_PORT}/health" 2>/dev/null \
            | grep -q '"status"'; then
            success "Upstream /health returns 200 with status field."
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    error "Upstream /health did not respond within ${NGINX_VERIFY_TIMEOUT}s."
    return 1
}

# Drain the old container with SIGTERM, then remove after grace period.
drain_old_container() {
    local old_name="$1"
    if [[ -z "$old_name" ]] || ! container_exists "$old_name"; then
        info "No old container to drain."
        return 0
    fi

    info "Sending SIGTERM to ${old_name} (grace=${DRAIN_TIMEOUT}s)..."
    docker stop -t "$DRAIN_TIMEOUT" "$old_name" >/dev/null 2>&1 || warn "docker stop failed"

    # If still alive after drain timeout, force-remove.
    if container_exists "$old_name"; then
        warn "Container ${old_name} still exists after drain; force-removing."
        docker rm -f "$old_name" >/dev/null 2>&1 || true
    fi
    success "Old container ${old_name} drained and removed."
}

# ----------------------------------------------------------------------------
# Main orchestration
# ----------------------------------------------------------------------------
main() {
    parse_args "$@"

    info "Blue-green deploy: service=${SERVICE} prefix=${CONTAINER_PREFIX} image=${IMAGE}"
    info "Network=${NETWORK}, upstream=${UPSTREAM_CONF}"

    # 1. Detect active color
    local env_suffix="${CONTAINER_PREFIX%-}"
    ACTIVE_COLOR=$(detect_active_color)
    if [[ "$ACTIVE_COLOR" == "blue" ]]; then
        INACTIVE_COLOR="green"
    else
        INACTIVE_COLOR="blue"
    fi
    OLD_CONTAINER_NAME="${ACTIVE_COLOR}-${SERVICE}-${env_suffix}"
    info "Active color=${ACTIVE_COLOR} -> new color=${INACTIVE_COLOR}"
    info "Old container (to be drained): ${OLD_CONTAINER_NAME}"

    if ! resolve_database_url; then
        exit 1
    fi

    # Save original upstream.conf for rollback
    if [[ "$SERVICE" == "api" ]] && [[ -f "$UPSTREAM_CONF" ]]; then
        ORIGINAL_UPSTREAM=$(cat "$UPSTREAM_CONF")
    fi

    if ! run_prisma_migrations; then
        error "Migration step failed; aborting deployment."
        exit 1
    fi

    # 2. Start new container
    if ! start_new_container "$INACTIVE_COLOR"; then
        error "Failed to start new container. Rolling back."
        exit 1
    fi

    # 3. Health poll
    if ! poll_health "$NEW_CONTAINER_NAME"; then
        error "Health check failed; removing new container."
        remove_container "$NEW_CONTAINER_NAME"
        exit 1
    fi

    if [[ "$SERVICE" == "api" ]]; then
        # 4. Switch upstream + reload Nginx
        write_upstream_conf

        if ! reload_nginx; then
            error "Nginx reload failed; reverting upstream.conf and removing new container."
            if [[ -n "$ORIGINAL_UPSTREAM" ]]; then
                echo "$ORIGINAL_UPSTREAM" > "$UPSTREAM_CONF"
                eval "$NGINX_RELOAD_CMD" || true
            fi
            remove_container "$NEW_CONTAINER_NAME"
            exit 1
        fi

        # 5. Verify upstream via Nginx
        if ! verify_upstream_health; then
            error "Upstream verification failed; reverting."
            if [[ -n "$ORIGINAL_UPSTREAM" ]]; then
                echo "$ORIGINAL_UPSTREAM" > "$UPSTREAM_CONF"
                eval "$NGINX_RELOAD_CMD" || true
            fi
            remove_container "$NEW_CONTAINER_NAME"
            exit 1
        fi
    else
        info "Service ${SERVICE} does not use Nginx cutover; skipping upstream switch."
    fi

    # 6. Drain old container
    drain_old_container "$OLD_CONTAINER_NAME"

    success "Blue-green deploy complete. Active=${NEW_CONTAINER_NAME}:${NEW_HOST_PORT}"
}

main "$@"
