#!/bin/bash
# ============================================================================
# init-server.sh — VPS Initial Setup for Multi-Environment CI/CD
# ----------------------------------------------------------------------------
# Performs a full single-VPS bootstrap that hosts BOTH the production and
# preprod environments for the Healthcare Backend.
#
# What it does:
#   1. Installs Docker Engine + Docker Compose plugin from official repos
#   2. Installs Coolify via the official installer (manages Traefik + SSL)
#   3. Creates the directory tree for /opt/healthcare-backend (production)
#      and /opt/healthcare-preprod (preprod) including data/logs/nginx
#   4. Configures ufw: allows 22, 80, 443, 8000; denies everything else
#   5. Creates the two isolated Docker networks with distinct subnets
#      so containers on one network cannot reach containers on the other
#
# All paths/prefixes/ports/subnets are read from environment variables with
# safe defaults — no hardcoded values, no surprises.
#
# Requirements: 2.1, 2.5, 2.6, 2.7
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration (override via env vars)
# ----------------------------------------------------------------------------
PROD_DEPLOY_PATH="${PROD_DEPLOY_PATH:-/opt/healthcare-backend}"
PREPROD_DEPLOY_PATH="${PREPROD_DEPLOY_PATH:-/opt/healthcare-preprod}"
PROD_NETWORK="${PROD_NETWORK:-app-network}"
PREPROD_NETWORK="${PREPROD_NETWORK:-preprod-network}"
PROD_SUBNET="${PROD_SUBNET:-172.18.0.0/16}"
PREPROD_SUBNET="${PREPROD_SUBNET:-172.19.0.0/16}"
PROD_CONTAINER_PREFIX="${PROD_CONTAINER_PREFIX:-latest-}"
PREPROD_CONTAINER_PREFIX="${PREPROD_CONTAINER_PREFIX:-preprod-}"
PROD_NGINX_PORT="${PROD_NGINX_PORT:-8088}"
PREPROD_NGINX_PORT="${PREPROD_NGINX_PORT:-8089}"
PROD_API_PORT="${PROD_API_PORT:-8088}"
PREPROD_API_PORT="${PREPROD_API_PORT:-8088}"

# Firewall ports
UFW_ALLOWED_PORTS="${UFW_ALLOWED_PORTS:-22 80 443 8000}"

# ----------------------------------------------------------------------------
# Pretty output
# ----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $(date '+%Y-%m-%d %H:%M:%S') - $*" >&2; }

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        error "This script must be run as root (sudo -i then run, or sudo $0)."
        exit 1
    fi
}

require_os() {
    if ! command -v apt-get >/dev/null 2>&1; then
        error "This script targets Debian/Ubuntu (uses apt-get). Aborting."
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# Step 1: Docker
# ----------------------------------------------------------------------------
install_docker() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        success "Docker + Compose plugin already installed."
        return 0
    fi

    info "Installing Docker Engine and Compose plugin from official repos..."

    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Detect distro codename
    local codename
    codename=$(. /etc/os-release && echo "${VERSION_CODENAME:-jammy}")
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl enable --now docker
    success "Docker installed: $(docker --version)"
    success "Compose plugin: $(docker compose version)"
}

# ----------------------------------------------------------------------------
# Step 2: Coolify
# ----------------------------------------------------------------------------
install_coolify() {
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^coolify$'; then
        success "Coolify appears to already be running (found 'coolify' container)."
        return 0
    fi

    info "Installing Coolify (self-hosted PaaS)..."
    if curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash; then
        success "Coolify installed. Access the UI at http://<server-ip>:8000 once DNS is configured."
    else
        warn "Coolify install command returned non-zero. Check /data/coolify for logs."
    fi
}

# ----------------------------------------------------------------------------
# Step 3: Directory tree for both environments
# ----------------------------------------------------------------------------
create_directory_tree() {
    local deploy_path="$1"

    info "Creating directory tree at ${deploy_path}..."
    mkdir -p \
        "${deploy_path}/data/postgres" \
        "${deploy_path}/data/dragonfly" \
        "${deploy_path}/logs/nginx" \
        "${deploy_path}/logs/app" \
        "${deploy_path}/nginx" \
        "${deploy_path}/devops/docker" \
        "${deploy_path}/backups/postgres" \
        "${deploy_path}/backups/dragonfly"

    chown -R root:root "${deploy_path}"
    chmod 755 "${deploy_path}"
    chmod 700 "${deploy_path}/data/postgres" "${deploy_path}/data/dragonfly"
    success "Directory tree ready at ${deploy_path}"
}

# ----------------------------------------------------------------------------
# Step 4: Firewall (ufw)
# ----------------------------------------------------------------------------
configure_firewall() {
    if ! command -v ufw >/dev/null 2>&1; then
        warn "ufw not installed; skipping firewall configuration."
        return 0
    fi

    info "Configuring ufw firewall..."
    ufw --force reset

    for port in $UFW_ALLOWED_PORTS; do
        ufw allow "${port}/tcp" || warn "Could not allow port ${port}"
    done

    # Docker publishes ports via iptables directly; ensure ufw default forward
    # policy doesn't break Docker networking.
    if ! grep -q '^DEFAULT_FORWARD_POLICY="ACCEPT"' /etc/default/ufw 2>/dev/null; then
        sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
    fi

    ufw --force enable
    success "Firewall configured. Open ports: ${UFW_ALLOWED_PORTS}"
}

# ----------------------------------------------------------------------------
# Step 5: Isolated Docker networks
# ----------------------------------------------------------------------------
create_isolated_networks() {
    info "Creating isolated Docker networks..."

    create_network() {
        local name="$1"
        local subnet="$2"

        if docker network inspect "${name}" >/dev/null 2>&1; then
            success "Network '${name}' already exists."
            return 0
        fi

        docker network create \
            --driver bridge \
            --subnet "${subnet}" \
            --opt com.docker.network.bridge.enable_icc=false \
            --opt com.docker.network.bridge.enable_ip_masquerade=true \
            "${name}"

        success "Created network '${name}' with subnet ${subnet} (ICC disabled for isolation)."
    }

    create_network "${PROD_NETWORK}" "${PROD_SUBNET}"
    create_network "${PREPROD_NETWORK}" "${PREPROD_SUBNET}"

    warn "ICC is disabled per-network. To allow intra-network DNS resolution, "
    warn "the compose files must declare the network per service. Containers "
    warn "in '${PROD_NETWORK}' cannot reach containers in '${PREPROD_NETWORK}'."
}

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
main() {
    require_root
    require_os

    info "=== Healthcare Backend — Multi-Environment VPS Setup ==="
    info "PROD_DEPLOY_PATH     = ${PROD_DEPLOY_PATH}"
    info "PREPROD_DEPLOY_PATH  = ${PREPROD_DEPLOY_PATH}"
    info "PROD_NETWORK         = ${PROD_NETWORK} (${PROD_SUBNET})"
    info "PREPROD_NETWORK      = ${PREPROD_NETWORK} (${PREPROD_SUBNET})"
    info "PROD_NGINX_PORT      = ${PROD_NGINX_PORT}"
    info "PREPROD_NGINX_PORT   = ${PREPROD_NGINX_PORT}"

    install_docker
    install_coolify
    create_directory_tree "${PROD_DEPLOY_PATH}"
    create_directory_tree "${PREPROD_DEPLOY_PATH}"
    configure_firewall
    create_isolated_networks

    success "=== VPS initial setup complete ==="
    info "Next steps:"
    info "  1. Configure DNS A-records (see devops/docs/VPS_SETUP_GUIDE.md)."
    info "  2. Open Coolify UI at http://<server-ip>:8000 and complete onboarding."
    info "  3. Configure GitHub Environments (see devops/docs/GITHUB_SECRETS_GUIDE.md)."
}

main "$@"
