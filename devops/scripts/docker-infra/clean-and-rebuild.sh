#!/bin/bash
# Clean all containers and rebuild infrastructure
# This script completely cleans the Docker environment and rebuilds everything

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Load environment
load_environment

COMPOSE_FILE="${SCRIPT_DIR}/../../docker/docker-compose.prod.yml"
BASE_DIR="/opt/healthcare-backend"

log_info "=========================================="
log_info "Complete Docker Environment Cleanup"
log_info "=========================================="
log_warning "This will STOP and REMOVE ALL containers, networks, and volumes!"
log_warning "Data will be preserved in volumes, but containers will be recreated"
log_info ""

# Step 1: Backup data before cleanup
log_info "Step 1: Creating backup before cleanup..."
if "${SCRIPT_DIR}/backup.sh" "pre-deployment"; then
    log_success "Backup created successfully"
else
    log_warning "Backup failed, but continuing with cleanup..."
fi

# Step 2: Stop all containers
log_info "Step 2: Stopping all containers..."
cd "${BASE_DIR}/devops/docker" || cd "${SCRIPT_DIR}/../../docker" || {
    log_error "Cannot find docker-compose directory"
    exit 1
}

docker compose -f "$COMPOSE_FILE" --profile infrastructure --profile app down --remove-orphans || {
    log_warning "Some containers may not have stopped cleanly"
}

# Step 3: Remove all containers (force)
log_info "Step 3: Removing all containers..."
docker ps -a --format '{{.Names}}' | grep -E "^(postgres|dragonfly|coturn|portainer|openvidu-server|latest-api|latest-worker)$" | while read -r container; do
    log_info "Removing container: $container"
    docker rm -f "$container" 2>/dev/null || true
done

# Step 4: Remove unused networks
log_info "Step 4: Cleaning up unused networks..."
docker network prune -f || true

# Step 5: Remove unused images (optional - commented out to preserve images)
# log_info "Step 5: Removing unused images..."
# docker image prune -af || true

# Step 6: Verify volumes are preserved
log_info "Step 6: Verifying data volumes are preserved..."
if docker volume ls | grep -q "postgres_data"; then
    log_success "PostgreSQL volume exists"
else
    log_warning "PostgreSQL volume not found - will be created"
fi

if docker volume ls | grep -q "dragonfly_data"; then
    log_success "Dragonfly volume exists"
else
    log_warning "Dragonfly volume not found - will be created"
fi

# Step 7: Rebuild infrastructure
log_info "Step 7: Rebuilding infrastructure..."
if docker compose -f "$COMPOSE_FILE" --profile infrastructure pull; then
    log_success "Infrastructure images pulled"
else
    log_error "Failed to pull infrastructure images"
    exit 1
fi

if docker compose -f "$COMPOSE_FILE" --profile infrastructure up -d; then
    log_success "Infrastructure containers started"
else
    log_error "Failed to start infrastructure containers"
    exit 1
fi

# Step 8: Wait for infrastructure to be healthy
log_info "Step 8: Waiting for infrastructure to be healthy..."
sleep 10

if "${SCRIPT_DIR}/health-check.sh"; then
    log_success "Infrastructure is healthy"
else
    log_warning "Infrastructure health check failed - may need manual intervention"
fi

# Step 9: Rebuild application containers
log_info "Step 9: Rebuilding application containers..."
log_info "Note: Application containers will be rebuilt from latest images"
log_info "This requires the images to be built and pushed to GHCR first"

log_info ""
log_success "=========================================="
log_success "Cleanup and Rebuild Complete"
log_success "=========================================="
log_info "Next steps:"
log_info "1. Rebuild and push Docker images to GHCR"
log_info "2. Run deployment script to start application containers"
log_info "3. Verify deployment with: ./verify.sh deployment"

