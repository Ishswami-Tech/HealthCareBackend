#!/bin/bash
# Smart Deployment Orchestrator
# Implements intelligent deployment logic based on infrastructure and application changes

set -euo pipefail

# Save deploy script directory BEFORE sourcing utils.sh (which sets its own SCRIPT_DIR)
DEPLOY_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="${DEPLOY_SCRIPT_DIR}"  # Will be overwritten by utils.sh, but we keep original
source "${DEPLOY_SCRIPT_DIR}/../shared/utils.sh"
# Restore deploy script directory after sourcing utils.sh
SCRIPT_DIR="${DEPLOY_SCRIPT_DIR}"

# This script is Docker-specific for production deployments

# Container prefix (only for app containers, infrastructure uses fixed names)
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Fixed container names for infrastructure (never change)
POSTGRES_CONTAINER="postgres"
DRAGONFLY_CONTAINER="dragonfly"
OPENVIDU_CONTAINER="openvidu-server"
COTURN_CONTAINER="coturn"

# Parse environment variables with defaults
# These are set by CI/CD workflow, but we provide safe defaults for manual execution
INFRA_CHANGED="${INFRA_CHANGED:-false}"
# CRITICAL: Default APP_CHANGED to true for production deployments (main branch)
# This ensures we always deploy the latest image, preventing Docker from using cached :latest images
# Note: This script is only called for production deployments (main branch) via CI/CD
# For other branches, the deploy job doesn't run, so this default only affects production
APP_CHANGED="${APP_CHANGED:-true}"
INFRA_HEALTHY="${INFRA_HEALTHY:-true}"
INFRA_STATUS="${INFRA_STATUS:-healthy}"
BACKUP_ID="${BACKUP_ID:-}"

# Flag to indicate if infrastructure operations were already handled by CI/CD
# When INFRA_ALREADY_HANDLED=true, skip infrastructure operations in deploy.sh
# (They were already done by separate GitHub Actions jobs)
INFRA_ALREADY_HANDLED="${INFRA_ALREADY_HANDLED:-false}"

# Normalize boolean values (handle "true"/"false" strings and actual booleans)
normalize_bool() {
    local value="${1:-false}"
    case "${value,,}" in
        true|1|yes|y|on)
            echo "true"
            ;;
        *)
            echo "false"
            ;;
    esac
}

INFRA_CHANGED=$(normalize_bool "$INFRA_CHANGED")
APP_CHANGED=$(normalize_bool "$APP_CHANGED")
INFRA_HEALTHY=$(normalize_bool "$INFRA_HEALTHY")
INFRA_ALREADY_HANDLED=$(normalize_bool "$INFRA_ALREADY_HANDLED")

# Exit codes
EXIT_SUCCESS=0
EXIT_WARNING=1
EXIT_ERROR=2
EXIT_CRITICAL=3

# Check if this is a fresh deployment (no existing infrastructure/data)
is_fresh_deployment() {
    # Check if postgres container exists
    if container_running "${POSTGRES_CONTAINER}"; then
        # Container exists - check if database has any tables/data
        local table_count=$(docker exec "${POSTGRES_CONTAINER}" psql -U postgres -d userdb -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" 2>/dev/null | xargs || echo "0")
        if [[ "$table_count" =~ ^[1-9][0-9]*$ ]]; then
            return 1  # Not fresh - has data
        fi
    fi
    
    # Check if postgres volume exists with data
    if docker volume inspect docker_postgres_data >/dev/null 2>&1; then
        # Volume exists - check if it has initialized database files
        local volume_path=$(docker volume inspect docker_postgres_data --format '{{ .Mountpoint }}' 2>/dev/null)
        if [[ -n "$volume_path" ]] && [[ -d "$volume_path" ]]; then
            # Check for PostgreSQL data files (PG_VERSION indicates initialized database)
            if [[ -f "${volume_path}/PG_VERSION" ]] && [[ -d "${volume_path}/base" ]]; then
                # Database is initialized - check if it has actual data
                # If base directory has subdirectories (database OIDs), it has data
                local db_count=$(find "${volume_path}/base" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | xargs)
                if [[ "$db_count" -gt 1 ]]; then
                    return 1  # Not fresh - has initialized database
                fi
            fi
        fi
    fi
    
    return 0  # Fresh deployment - no existing data
}

# Check infrastructure health
check_infrastructure_health() {
    log_info "Checking infrastructure health..."
    
    if "${SCRIPT_DIR}/health-check.sh" >/dev/null 2>&1; then
        INFRA_HEALTHY="true"
        INFRA_STATUS="healthy"
        return 0
    else
        local exit_code=$?
        INFRA_HEALTHY="false"
        
        if [[ $exit_code -eq 3 ]]; then
            INFRA_STATUS="missing"
        else
            INFRA_STATUS="unhealthy"
        fi
        return 1
    fi
}

# Deploy infrastructure
# Ensure data volumes are preserved
ensure_volumes_preserved() {
    log_info "Verifying data volumes are preserved..."
    
    local volumes=("postgres_data" "dragonfly_data")
    local volume_paths=(
        "/opt/healthcare-backend/data/postgres"
        "/opt/healthcare-backend/data/dragonfly"
    )
    
    for i in "${!volumes[@]}"; do
        local volume="${volumes[$i]}"
        local volume_path="${volume_paths[$i]}"
        
        # Check if volume exists
        if docker volume inspect "docker_${volume}" >/dev/null 2>&1; then
            log_info "Volume ${volume} exists"
            
            # For bind mounts, verify the host path exists
            if [[ -d "$volume_path" ]]; then
                log_success "Volume path verified: ${volume_path}"
            else
                log_warning "Volume path missing: ${volume_path} (will be created)"
                mkdir -p "$volume_path" || {
                    log_error "Failed to create volume path: ${volume_path}"
                    return 1
                }
            fi
        else
            log_warning "Volume ${volume} does not exist (will be created)"
        fi
    done
    
    return 0
}

# Stop infrastructure containers gracefully to ensure data is flushed
stop_infrastructure_gracefully() {
    log_info "Stopping infrastructure containers gracefully..."
    
    local containers=("${POSTGRES_CONTAINER}" "${DRAGONFLY_CONTAINER}")
    
    for container in "${containers[@]}"; do
        # Security: Validate container name
        if ! validate_container_name "$container"; then
            log_error "Invalid container name: ${container}"
            return 1
        fi
        
        if container_running "$container"; then
            log_info "Stopping ${container} gracefully..."
            
            # Stop with grace period (containers have stop_grace_period configured)
            docker stop "$container" || {
                log_warning "Failed to stop ${container} gracefully, forcing stop..."
                docker kill "$container" 2>/dev/null || true
            }
            
            # Wait a moment for data to flush
            sleep 2
        else
            log_info "Container ${container} is not running"
        fi
    done
    
    return 0
}

deploy_infrastructure() {
    log_info "Deploying infrastructure..."
    
    # Ensure docker-compose.prod.yml exists (restores from /tmp or git if missing)
    if ! ensure_compose_file; then
        log_error "Failed to ensure docker-compose.prod.yml exists"
        return 1
    fi
    
    local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
    
    # Ensure directory exists before changing into it
    local compose_dir="$(dirname "$compose_file")"
    mkdir -p "$compose_dir" || {
        log_error "Failed to create directory: ${compose_dir}"
        return 1
    }
    cd "$compose_dir" || {
        log_error "Failed to change to directory: ${compose_dir}"
        return 1
    }
    
    # CRITICAL: Ensure volumes are preserved before recreation
    ensure_volumes_preserved || {
        log_error "Volume preservation check failed"
        return 1
    }
    
    # CRITICAL: Stop containers gracefully to flush data before recreation
    stop_infrastructure_gracefully || {
        log_warning "Graceful stop had issues, but continuing..."
    }
    
    # Pull infrastructure images (e.g. postgres:18) so server uses versions from docker-compose.prod.yml, not cached old images
    log_info "Pulling infrastructure images (postgres:18, dragonfly, openvidu-server, coturn, portainer)..."
    docker compose -f docker-compose.prod.yml --profile infrastructure pull --quiet || true
    
    # Recreate infrastructure (volumes are preserved by docker compose)
    # Using --force-recreate to ensure containers are recreated with pulled images (e.g. PostgreSQL 18)
    if docker compose -f docker-compose.prod.yml --profile infrastructure up -d --force-recreate; then
        log_success "Infrastructure deployed"
        
        # Wait for health (using fixed container names) with retry logic
        log_info "Waiting for PostgreSQL to become healthy..."
        local postgres_healthy=false
        local postgres_retries=30
        local postgres_attempt=0
        
        while [[ $postgres_attempt -lt $postgres_retries ]] && ! $postgres_healthy; do
            postgres_attempt=$((postgres_attempt + 1))
            if wait_for_health "${POSTGRES_CONTAINER}" 10; then
                postgres_healthy=true
                log_success "PostgreSQL is healthy"
            else
                if [[ $postgres_attempt -lt $postgres_retries ]]; then
                    log_info "PostgreSQL not ready yet (attempt $postgres_attempt/$postgres_retries), waiting..."
                    sleep 5
                fi
            fi
        done
        
        if ! $postgres_healthy; then
            log_error "PostgreSQL did not become healthy after $postgres_retries attempts"
            return 1
        fi
        
        log_info "Waiting for Dragonfly to become healthy..."
        local dragonfly_healthy=false
        local dragonfly_retries=20
        local dragonfly_attempt=0
        
        while [[ $dragonfly_attempt -lt $dragonfly_retries ]] && ! $dragonfly_healthy; do
            dragonfly_attempt=$((dragonfly_attempt + 1))
            if wait_for_health "${DRAGONFLY_CONTAINER}" 10; then
                dragonfly_healthy=true
                log_success "Dragonfly is healthy"
            else
                if [[ $dragonfly_attempt -lt $dragonfly_retries ]]; then
                    log_info "Dragonfly not ready yet (attempt $dragonfly_attempt/$dragonfly_retries), waiting..."
                    sleep 5
                fi
            fi
        done
        
        if ! $dragonfly_healthy; then
            log_error "Dragonfly did not become healthy after $dragonfly_retries attempts"
            return 1
        fi
        
        log_success "All critical infrastructure services are healthy"
        return 0
    else
        log_error "Infrastructure deployment failed"
        return 1
    fi
}

# Deploy application
deploy_application() {
    log_info "Deploying application..."
    
    local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
    cd "$(dirname "$compose_file")" || return 1
    
    # Validate container dependencies before deployment
    if ! validate_container_dependencies; then
        log_error "Container dependencies not ready"
        return 1
    fi
    
    # Security: Validate container names
    if ! validate_container_name "${CONTAINER_PREFIX}api"; then
        log_error "Invalid API container name"
        return 1
    fi
    if ! validate_container_name "${CONTAINER_PREFIX}worker"; then
        log_error "Invalid worker container name"
        return 1
    fi
    
    # Authenticate with GitHub Container Registry if credentials are available
    if [[ -n "${GITHUB_TOKEN:-}" ]] && [[ -n "${GITHUB_USERNAME:-}" ]]; then
        log_info "Authenticating with GitHub Container Registry..."
        if echo "${GITHUB_TOKEN}" | docker login ghcr.io -u "${GITHUB_USERNAME}" --password-stdin 2>&1; then
            log_success "Authenticated with GitHub Container Registry"
        else
            log_warning "Failed to authenticate with GHCR, attempting to pull anyway (package may be public)"
        fi
    else
        log_info "No GHCR credentials provided, attempting to pull (package may be public)"
    fi
    
    # Set DOCKER_IMAGE if not already set (use latest tag from registry)
    # This ensures docker-compose uses the correct image tag
    if [[ -z "${DOCKER_IMAGE:-}" ]]; then
        # Default to latest tag if IMAGE and IMAGE_TAG are not provided
        if [[ -n "${IMAGE:-}" ]] && [[ -n "${IMAGE_TAG:-}" ]]; then
            export DOCKER_IMAGE="${IMAGE}:${IMAGE_TAG}"
            log_info "Using image from environment: ${DOCKER_IMAGE}"
        else
            export DOCKER_IMAGE="ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:latest"
            log_info "Using default image: ${DOCKER_IMAGE}"
        fi
    else
        log_info "Using DOCKER_IMAGE from environment: ${DOCKER_IMAGE}"
    fi
    
    # Backup policy: no backup here to keep deploy fast. Pre-change backup runs only when infra
    # is unhealthy (CI backup-infrastructure job). Success backup runs after deploy (CI post-deployment-verification).
    log_info "Skipping pre-deployment backup (deploy first, backups after)"
    
    # CRITICAL: Tag current running image as backup before pulling new one
    # This allows rollback if new deployment fails
    # NOTE: Only tags API/Worker images, NOT infrastructure images (postgres, dragonfly, etc.)
    log_info "Tagging current API/Worker image as backup for rollback (infrastructure images are NOT affected)..."
    local image_name_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
    # Use global variable (not local) so it's accessible in rollback_deployment function
    OLD_IMAGE_BACKUP_TAG="${image_name_base}:rollback-backup-$(date +%Y%m%d-%H%M%S)"
    local current_image_tag=""
    
    if [[ -n "${image_name_base}" ]]; then
        # Find the currently running image (used by api/worker containers)
        local api_container="${CONTAINER_PREFIX}api"
        if container_running "$api_container"; then
            current_image_tag=$(docker inspect --format='{{.Config.Image}}' "$api_container" 2>/dev/null || echo "")
            if [[ -n "$current_image_tag" ]] && [[ "$current_image_tag" == *"healthcare-api"* ]]; then
                log_info "Found current running image: ${current_image_tag}"
                # Tag it as backup
                if docker tag "$current_image_tag" "$OLD_IMAGE_BACKUP_TAG" 2>&1; then
                    log_success "Tagged current image as backup: ${OLD_IMAGE_BACKUP_TAG}"
                    # Export for use in rollback
                    export OLD_IMAGE_BACKUP_TAG
                else
                    log_warning "Failed to tag current image, but continuing..."
                    OLD_IMAGE_BACKUP_TAG=""
                fi
            fi
        fi
        
        # Also check for any existing images with the same base name
        # Tag them as backup before removing (in case container isn't running)
        docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}" | while read -r img; do
            if [[ -n "$img" ]] && [[ "$img" == *"healthcare-api"* ]] && [[ "$img" != *"rollback-backup"* ]]; then
                # Only tag if we haven't already tagged this image
                if [[ -z "$current_image_tag" ]] || [[ "$img" != "$current_image_tag" ]]; then
                    local backup_tag="${img}-rollback-backup-$(date +%Y%m%d-%H%M%S)"
                    log_info "Tagging existing image as backup: ${img} -> ${backup_tag}"
                    docker tag "$img" "$backup_tag" 2>&1 || true
                fi
            fi
        done || true
    fi
    
    # Pull latest images with --pull always to force update
    # Note: We need to include infrastructure profile to resolve dependencies (coturn)
    # but we only pull the app service images
    log_info "Pulling latest images for api and worker (forcing pull to get latest version)..."
    
    # CRITICAL: Remove old image with same tag to force fresh pull
    # Docker may cache images even with --pull always if the tag is the same
    log_info "Removing old image with same tag to force fresh pull..."
    local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
    local image_tag=$(echo "${DOCKER_IMAGE}" | cut -d: -f2)
    
    # Stop and remove containers first so we can remove the image
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    if container_running "$api_container" || container_running "$worker_container"; then
        log_info "Stopping containers to allow image removal..."
        docker stop "$api_container" "$worker_container" 2>&1 || true
        docker rm -f "$api_container" "$worker_container" 2>&1 || true
    fi
    
    # For :latest tag, we need to be more aggressive about removing old images
    # because Docker might use cached :latest even after pulling
    if [[ "$image_tag" == "latest" ]]; then
        log_info "Detected :latest tag - removing ALL images with this repository to force fresh pull..."
        # Remove all images with the same repository (not just the tag)
        # This ensures we get a completely fresh pull
        docker images "${image_base}" --format "{{.Repository}}:{{.Tag}}" | while read -r img; do
            if [[ -n "$img" ]] && [[ "$img" == *"${image_base}"* ]]; then
                log_info "Removing old image: ${img}"
                docker rmi "$img" 2>&1 || {
                    log_warning "Could not remove image ${img} (may be in use) - will continue"
                }
            fi
        done || true
    else
        # For specific tags (SHA-based), only remove the exact tag
        if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${DOCKER_IMAGE}$"; then
            log_info "Found existing image with tag ${DOCKER_IMAGE}, removing to force fresh pull..."
            docker rmi "${DOCKER_IMAGE}" 2>&1 || {
                log_warning "Could not remove old image (may have other tags) - will force pull anyway"
            }
        fi
    fi
    
    # Also remove any dangling images with the same repository
    log_info "Cleaning up dangling images for ${image_base}..."
    docker images "${image_base}" --filter "dangling=true" --format "{{.ID}}" | while read -r img_id; do
        if [[ -n "$img_id" ]]; then
            log_info "Removing dangling image: ${img_id:0:12}"
            docker rmi "$img_id" 2>&1 || true
        fi
    done || true
    
    # CRITICAL: Use docker pull directly to force update, then docker compose will use the fresh image
    log_info "Pulling image directly with docker pull to ensure latest version..."
    log_info "Attempting to pull: ${DOCKER_IMAGE}"
    
    local pull_success=false
    
    # CRITICAL: For :latest tag, get the digest from registry FIRST to verify we're pulling the latest
    # This ensures we're not using a cached :latest tag
    local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
    local image_tag=$(echo "${DOCKER_IMAGE}" | cut -d: -f2)
    
    if [[ "$image_tag" == "latest" ]]; then
        log_info "Detected :latest tag - verifying latest digest from registry..."
        # Get the latest digest from registry (requires authentication)
        if [[ -n "${GITHUB_TOKEN:-}" ]] && [[ -n "${GITHUB_USERNAME:-}" ]]; then
            log_info "Authenticating with GHCR to get latest image digest..."
            echo "${GITHUB_TOKEN}" | docker login "${REGISTRY:-ghcr.io}" -u "${GITHUB_USERNAME}" --password-stdin 2>&1 || {
                log_warning "Failed to authenticate with GHCR - will pull without digest verification"
            }
        fi
        
        # Try to get manifest digest from registry
        local registry_digest=""
        if command -v docker &> /dev/null; then
            registry_digest=$(docker manifest inspect "${DOCKER_IMAGE}" 2>/dev/null | grep -o '"digest":"[^"]*"' | head -n 1 | cut -d'"' -f4 || echo "")
        fi
        
        if [[ -n "$registry_digest" ]]; then
            log_info "Latest image digest in registry: ${registry_digest:0:30}..."
            
            # Check if local image has the same digest
            local local_digest=$(docker images --format "{{.Digest}}" "${DOCKER_IMAGE}" 2>/dev/null | head -n 1 || echo "")
            if [[ -n "$local_digest" ]] && [[ "$local_digest" == "$registry_digest" ]]; then
                log_info "Local image digest matches registry - image is up to date"
            else
                log_info "Local image digest differs from registry - will pull fresh image"
                log_info "  Local: ${local_digest:0:30}..."
                log_info "  Registry: ${registry_digest:0:30}..."
            fi
        else
            log_warning "Could not get digest from registry - will pull anyway"
        fi
    fi
    
    # CRITICAL: Force pull without using cache to ensure we get absolute latest from registry
    log_info "Pulling image (forcing fresh pull from registry)..."
    if docker pull "${DOCKER_IMAGE}" >/dev/null 2>&1; then
        log_success "Successfully pulled image: ${DOCKER_IMAGE}"
        pull_success=true
        
        # Verify the image was actually pulled (not using cached version)
        local pulled_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" | head -n 1)
        local pulled_image_digest=$(docker images --format "{{.Digest}}" "${DOCKER_IMAGE}" | head -n 1 || echo "")
        local pulled_image_created=$(docker images --format "{{.CreatedAt}}" "${DOCKER_IMAGE}" | head -n 1 || echo "")
        log_info "Pulled image ID: ${pulled_image_id:0:12}"
        log_info "Pulled image created: ${pulled_image_created}"
        if [[ -n "$pulled_image_digest" ]] && [[ "$pulled_image_digest" != "<none>" ]]; then
            log_info "Pulled image digest: ${pulled_image_digest:0:30}..."
            
            # For :latest tag, verify digest matches registry
            if [[ "$image_tag" == "latest" ]] && [[ -n "$registry_digest" ]] && [[ "$pulled_image_digest" != "$registry_digest" ]]; then
                log_warning "⚠️  WARNING: Pulled image digest doesn't match registry digest!"
                log_warning "   This might indicate the image wasn't fully updated"
                log_warning "   Registry: ${registry_digest:0:30}..."
                log_warning "   Local: ${pulled_image_digest:0:30}..."
            fi
        fi
    else
        log_warning "Failed to pull image with specific tag: ${DOCKER_IMAGE}"
        log_warning "This might mean the CI/CD build didn't complete or the tag doesn't exist yet (propagation delay)"
        log_info "Attempting to pull :latest tag as fallback (most recent build)..."
        
        # Fallback to :latest tag if specific tag doesn't exist
        # Extract base image name (remove tag)
        local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
        local fallback_image="${image_base}:latest"
        local original_docker_image="${DOCKER_IMAGE:-}"
        
        log_info "Trying fallback image: ${fallback_image}"
        export DOCKER_IMAGE="${fallback_image}"
        
        if docker pull "${DOCKER_IMAGE}" >/dev/null 2>&1; then
            log_success "Successfully pulled fallback image: ${fallback_image}"
            log_warning "Using :latest tag instead of specific tag: ${original_docker_image}"
            log_warning "This ensures deployment continues even if SHA tag hasn't propagated yet"
            pull_success=true
            
            # Verify the fallback image was actually pulled
            local pulled_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" | head -n 1)
            log_info "Pulled fallback image ID: ${pulled_image_id:0:12}"
        else
            # Restore original DOCKER_IMAGE
            export DOCKER_IMAGE="${original_docker_image}"
            log_error "Failed to pull images for api and worker (both specific tag and :latest failed)"
            if [[ -z "${GITHUB_TOKEN:-}" ]]; then
                log_error "No GITHUB_TOKEN provided - cannot authenticate with GHCR"
                log_error "Either provide GITHUB_TOKEN and GITHUB_USERNAME, or make the package public in GitHub"
            else
                log_error "Image may not exist in registry. Check CI/CD build status."
                log_error "Tried tags: ${original_docker_image} and ${fallback_image}"
                log_error "Possible causes:"
                log_error "  1. CI/CD build didn't complete successfully"
                log_error "  2. Image wasn't pushed to registry"
                log_error "  3. Tag format is incorrect"
                log_error "  4. Registry propagation delay (wait a few minutes and retry)"
            fi
            return 1
        fi
    fi
    
    if [[ "$pull_success" != "true" ]]; then
        log_error "Image pull failed - cannot proceed with deployment"
        return 1
    fi
    
    # CRITICAL: Also pull via docker compose to ensure compose file is aware of the latest image
    # This ensures docker-compose uses the freshly pulled image, not a cached version
    # NOTE: Only pulling api and worker, NOT infrastructure containers
    log_info "Pulling via docker compose to sync with compose file (ONLY api and worker images)..."
    # The --quiet flag suppresses output but still pulls the latest version
    docker compose -f docker-compose.prod.yml --profile infrastructure --profile app pull --quiet api worker 2>&1 || {
        log_warning "docker compose pull had issues, but direct pull succeeded - continuing..."
        log_info "Direct docker pull was successful, docker-compose will use that image"
    }
    
    # CRITICAL: Verify we have the latest image by checking image creation time
    log_info "Verifying image freshness..."
    local image_created=$(docker images --format "{{.CreatedAt}}" "${DOCKER_IMAGE}" | head -n 1 || echo "")
    if [[ -n "$image_created" ]]; then
        log_info "Image created at: ${image_created}"
        log_success "Image is available and ready for deployment"
    fi
    
    # CRITICAL: ALWAYS stop and remove old containers to ensure new image is used
    # NOTE: Only stopping/removing api and worker containers, NOT infrastructure containers (postgres, dragonfly, etc.)
    # Backup already created above, so it's safe to stop and remove containers
    # This is CRITICAL - containers must be stopped/removed even if they appear stopped
    # to ensure docker-compose uses the new image instead of recreating with old image
    log_info "Stopping old API/Worker containers (infrastructure containers are NOT affected)..."
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    # Step 1: Stop via docker compose (graceful)
    docker compose -f docker-compose.prod.yml --profile infrastructure --profile app stop api worker 2>&1 || true
    
    # Step 2: Remove via docker compose
    docker compose -f docker-compose.prod.yml --profile infrastructure --profile app rm -f api worker 2>&1 || true
    
    # Step 3: ALWAYS force stop/remove directly (regardless of container state)
    # This ensures containers are removed even if docker compose didn't catch them
    log_info "Force stopping API/Worker containers directly (ensuring complete removal)..."
    # Suppress "No such container" errors - these are harmless (containers may not exist)
    docker stop "$api_container" "$worker_container" 2>/dev/null || true
    docker rm -f "$api_container" "$worker_container" 2>/dev/null || true
    
    # Step 4: Kill if still running (last resort)
    if container_running "$api_container" || container_running "$worker_container"; then
        log_warning "Containers still running after stop/remove - forcing kill..."
        docker kill "$api_container" "$worker_container" 2>&1 || true
        docker rm -f "$api_container" "$worker_container" 2>&1 || true
    fi
    
    # Step 5: Final verification - ensure containers are completely gone
    local max_cleanup_attempts=3
    local cleanup_attempt=0
    while [[ $cleanup_attempt -lt $max_cleanup_attempts ]] && (container_running "$api_container" || container_running "$worker_container"); do
        cleanup_attempt=$((cleanup_attempt + 1))
        log_warning "Containers still exist after cleanup attempt $cleanup_attempt/$max_cleanup_attempts - retrying..."
        docker kill "$api_container" "$worker_container" 2>&1 || true
        docker rm -f "$api_container" "$worker_container" 2>&1 || true
        sleep 2
    done
    
    if container_running "$api_container" || container_running "$worker_container"; then
        log_error "CRITICAL: Failed to stop/remove containers after $max_cleanup_attempts attempts"
        log_error "This will prevent new image from being deployed"
        log_error "API container status: $(docker ps -a --filter "name=$api_container" --format "{{.Status}}" || echo "unknown")"
        log_error "Worker container status: $(docker ps -a --filter "name=$worker_container" --format "{{.Status}}" || echo "unknown")"
        return 1
    fi
    
    log_success "Old containers stopped and removed completely"
    
    # CRITICAL: Verify new image was pulled and get its image ID
    log_info "Verifying new image is available and different from old image..."
    local new_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" | head -n 1)
    if [[ -n "$new_image_id" ]]; then
        log_success "New image verified: ${DOCKER_IMAGE} (ID: ${new_image_id})"
        
        # If we have a backup tag, compare image IDs to ensure they're different
        if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]]; then
            local old_image_id=$(docker images --format "{{.ID}}" "$OLD_IMAGE_BACKUP_TAG" 2>/dev/null | head -n 1 || echo "")
            if [[ -n "$old_image_id" ]]; then
                if [[ "$new_image_id" != "$old_image_id" ]]; then
                    log_success "New image is different from old image (old: ${old_image_id}, new: ${new_image_id})"
                else
                    log_warning "New image ID matches old image ID - this might mean the image wasn't updated"
                    log_warning "Old image: ${OLD_IMAGE_BACKUP_TAG} (ID: ${old_image_id})"
                    log_warning "New image: ${DOCKER_IMAGE} (ID: ${new_image_id})"
                fi
            fi
        fi
    else
        log_error "Could not verify new image ID - image might not have been pulled correctly"
        log_error "This could cause containers to use old image"
        return 1
    fi
    
    log_success "Images pulled successfully"
    
    # Run database migrations safely
    # CRITICAL: Migration failures MUST cause deployment to fail
    # This ensures CI/CD properly detects failed deployments
    if ! run_migrations_safely; then
        log_error "=========================================="
        log_error "DEPLOYMENT FAILED: Database migrations failed"
        log_error "=========================================="
        log_error "Migration failures are critical - deployment cannot proceed"
        log_error "The deployment will be marked as FAILED in CI/CD"
        log_error "Please fix migration issues before retrying deployment"
        log_error "=========================================="
        return 1
    fi
    
    # Start new containers with --force-recreate to ensure new image is used
    # CRITICAL: --force-recreate ensures containers are recreated even if already running
    # This guarantees new code is deployed when image changes
    # Note: We include infrastructure profile to resolve dependencies (coturn, postgres, dragonfly)
    
    # CRITICAL: Validate OPENVIDU_URL is set before starting containers
    # This prevents containers from starting with hardcoded/empty OPENVIDU_URL
    if [[ -z "${OPENVIDU_URL:-}" ]]; then
        log_error "CRITICAL: OPENVIDU_URL environment variable is not set!"
        log_error "This will cause OpenVidu health checks to fail with hardcoded URL errors"
        log_error "Please ensure OPENVIDU_URL is set in GitHub Actions environment variables"
        log_error "Current OPENVIDU_URL value: '${OPENVIDU_URL:-EMPTY}'"
        exit $EXIT_CRITICAL
    fi
    
    # Log the URL being used (masked for security)
    local masked_url="${OPENVIDU_URL}"
    if [[ "${masked_url}" =~ ^https?://([^:]+) ]]; then
        masked_url="${BASH_REMATCH[1]}"
    fi
    log_info "Using OPENVIDU_URL: ${masked_url} (from environment variable)"
    
    # Explicitly export OPENVIDU_URL to ensure docker-compose can access it
    export OPENVIDU_URL="${OPENVIDU_URL}"
    
    log_info "Starting application containers with NEW image (ONLY api and worker, NOT infrastructure containers)..."
    log_info "Using image: ${DOCKER_IMAGE}"
    # CRITICAL: Use --pull always to ensure we get the latest image even if tag exists
    # --force-recreate ensures containers are recreated even if config hasn't changed
    # --no-deps ensures infrastructure containers (postgres, dragonfly, etc.) are NOT recreated
    # We specify api worker explicitly to only recreate these two containers
    # Note: Containers were already stopped and removed above, so this will create fresh ones with new image
    if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1 | tee /tmp/docker-compose-up.log; then
        log_info "Waiting for containers to start..."
        sleep 5
        
        # Check if containers actually started
        local api_container="${CONTAINER_PREFIX}api"
        local worker_container="${CONTAINER_PREFIX}worker"
        
        if ! container_running "$api_container"; then
            log_error "API container ($api_container) failed to start"
            log_info "=== API Container Status ==="
            docker ps -a --filter "name=$api_container" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
            log_info "=== API Container Logs (last 50 lines) ==="
            docker logs --tail 50 "$api_container" 2>&1 || true
            rollback_deployment
            return 1
        fi
        
        # CRITICAL: Verify containers are using the correct NEW image by comparing image IDs
        log_info "Verifying containers are using the NEW image (not old image)..."
        local api_image=$(docker inspect --format='{{.Config.Image}}' "$api_container" 2>/dev/null || echo "")
        local api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "")
        local worker_image=$(docker inspect --format='{{.Config.Image}}' "$worker_container" 2>/dev/null || echo "")
        local worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "")
        
        # Get the new image ID that was pulled
        local new_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" | head -n 1)
        
        if [[ -n "$api_image" ]] && [[ -n "$api_image_id" ]] && [[ -n "$new_image_id" ]]; then
            log_info "API container image: $api_image"
            log_info "API container image ID: ${api_image_id:0:12}"
            log_info "Expected new image ID: ${new_image_id:0:12}"
            
            # Compare image IDs to ensure container is using the new image
            if [[ "$api_image_id" == "$new_image_id" ]]; then
                log_success "✅ API container is using the NEW image (ID matches: ${api_image_id:0:12})"
            elif [[ "$api_image" == *"${DOCKER_IMAGE}"* ]] || [[ "$api_image" == "${DOCKER_IMAGE}" ]]; then
                log_success "✅ API container is using expected image tag: ${api_image}"
                log_info "   Image ID: ${api_image_id:0:12} (may differ if tag was updated)"
            else
                log_error "❌ API container is NOT using the new image!"
                log_error "   Container image: ${api_image} (ID: ${api_image_id:0:12})"
                log_error "   Expected image: ${DOCKER_IMAGE} (ID: ${new_image_id:0:12})"
                log_error "   This indicates the container was not recreated with the new image"
                log_error "   Attempting to force recreate with explicit image..."
                
                # CRITICAL: Stop and remove container completely
                docker stop "$api_container" 2>&1 || true
                docker rm -f "$api_container" 2>&1 || true
                
                # Wait a moment to ensure container is fully removed
                sleep 2
                
                # CRITICAL: Export DOCKER_IMAGE again to ensure it's set
                export DOCKER_IMAGE="${DOCKER_IMAGE}"
                
                # Force recreate with explicit image pull
                if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api 2>&1; then
                    log_info "Container recreated, verifying again..."
                    sleep 3
                    local new_api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "")
                    if [[ "$new_api_image_id" == "$new_image_id" ]]; then
                        log_success "✅ API container now using correct image after force recreate"
                    else
                        log_error "❌ API container still not using correct image after force recreate"
                        log_error "   This is a critical issue - deployment may have failed"
                        return 1
                    fi
                else
                    log_error "Failed to force recreate API container"
                    return 1
                fi
            fi
        else
            log_warning "Could not verify API container image (missing image or ID)"
        fi
        
        if [[ -n "$worker_image" ]] && [[ -n "$worker_image_id" ]] && [[ -n "$new_image_id" ]]; then
            log_info "Worker container image: $worker_image"
            log_info "Worker container image ID: ${worker_image_id:0:12}"
            log_info "Expected new image ID: ${new_image_id:0:12}"
            
            # Compare image IDs to ensure container is using the new image
            if [[ "$worker_image_id" == "$new_image_id" ]]; then
                log_success "✅ Worker container is using the NEW image (ID matches: ${worker_image_id:0:12})"
            elif [[ "$worker_image" == *"${DOCKER_IMAGE}"* ]] || [[ "$worker_image" == "${DOCKER_IMAGE}" ]]; then
                log_success "✅ Worker container is using expected image tag: ${worker_image}"
                log_info "   Image ID: ${worker_image_id:0:12} (may differ if tag was updated)"
            else
                log_error "❌ Worker container is NOT using the new image!"
                log_error "   Container image: ${worker_image} (ID: ${worker_image_id:0:12})"
                log_error "   Expected image: ${DOCKER_IMAGE} (ID: ${new_image_id:0:12})"
                log_error "   This indicates the container was not recreated with the new image"
                log_error "   Attempting to force recreate with explicit image..."
                
                # CRITICAL: Stop and remove container completely
                docker stop "$worker_container" 2>&1 || true
                docker rm -f "$worker_container" 2>&1 || true
                
                # Wait a moment to ensure container is fully removed
                sleep 2
                
                # CRITICAL: Export DOCKER_IMAGE again to ensure it's set
                export DOCKER_IMAGE="${DOCKER_IMAGE}"
                
                # Force recreate with explicit image pull
                if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps worker 2>&1; then
                    log_info "Container recreated, verifying again..."
                    sleep 3
                    local new_worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "")
                    if [[ "$new_worker_image_id" == "$new_image_id" ]]; then
                        log_success "✅ Worker container now using correct image after force recreate"
                    else
                        log_error "❌ Worker container still not using correct image after force recreate"
                        log_error "   This is a critical issue - deployment may have failed"
                        return 1
                    fi
                else
                    log_error "Failed to force recreate Worker container"
                    return 1
                fi
            fi
        else
            log_warning "Could not verify Worker container image (missing image or ID)"
        fi
        
        # Get container creation time to verify it was just recreated
        local api_created=$(docker inspect --format='{{.Created}}' "$api_container" 2>/dev/null || echo "")
        local worker_created=$(docker inspect --format='{{.Created}}' "$worker_container" 2>/dev/null || echo "")
        if [[ -n "$api_created" ]]; then
            log_info "API container created at: $api_created"
        fi
        if [[ -n "$worker_created" ]]; then
            log_info "Worker container created at: $worker_created"
        fi
        
        # CRITICAL: Verify OPENVIDU_URL is set correctly in the container
        log_info "Verifying OPENVIDU_URL environment variable in API container..."
        sleep 2  # Give container time to fully start
        local container_openvidu_url=$(docker exec "$api_container" sh -c 'echo "${OPENVIDU_URL:-NOT SET}"' 2>/dev/null || echo "ERROR: Cannot read from container")
        if [[ "$container_openvidu_url" == *"openvidu-server:4443"* ]] || [[ "$container_openvidu_url" == "NOT SET" ]] || [[ -z "$container_openvidu_url" ]]; then
            log_error "CRITICAL: API container has incorrect OPENVIDU_URL: '${container_openvidu_url}'"
            log_error "Expected: ${OPENVIDU_URL}"
            log_error "Container will fail health checks with hardcoded URL errors"
            log_error "This indicates the environment variable was not passed correctly to docker-compose"
            log_warning "Check for .env.production file that might be overriding OPENVIDU_URL"
            log_warning "Attempting to fix by recreating container with explicit environment variable..."
            
            # Try to recreate with explicit env var
            docker compose -f docker-compose.prod.yml --profile infrastructure --profile app stop api worker 2>&1 || true
            docker compose -f docker-compose.prod.yml --profile infrastructure --profile app rm -f api worker 2>&1 || true
            OPENVIDU_URL="${OPENVIDU_URL}" docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1 || {
                log_error "Failed to recreate containers with correct OPENVIDU_URL"
                return 1
            }
            
            # Verify again after recreation
            sleep 5
            container_openvidu_url=$(docker exec "$api_container" sh -c 'echo "${OPENVIDU_URL:-NOT SET}"' 2>/dev/null || echo "ERROR: Cannot read from container")
            if [[ "$container_openvidu_url" == *"openvidu-server:4443"* ]] || [[ "$container_openvidu_url" == "NOT SET" ]] || [[ -z "$container_openvidu_url" ]]; then
                log_error "CRITICAL: Still incorrect after recreation. OPENVIDU_URL in container: '${container_openvidu_url}'"
                log_error "Manual intervention required: Check .env.production file or docker-compose.prod.yml"
                return 1
            else
                log_success "OPENVIDU_URL fixed in container: ${container_openvidu_url}"
            fi
        else
            log_success "OPENVIDU_URL correctly set in container: ${container_openvidu_url}"
        fi
        
        if ! container_running "$worker_container"; then
            log_error "Worker container ($worker_container) failed to start"
            log_info "=== Worker Container Status ==="
            docker ps -a --filter "name=$worker_container" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
            log_info "=== Worker Container Logs (last 50 lines) ==="
            docker logs --tail 50 "$worker_container" 2>&1 || true
            rollback_deployment
            return 1
        fi
        
        log_success "Application containers started successfully"
        
        # Wait for health (6 minutes with 30 second intervals - API takes time to start, database connection can take up to 120s)
        # Increased from 240s to 360s to account for:
        # - Container startup: ~10-30s
        # - Database connection: up to 120s (with retries)
        # - Health check grace period: 180s
        # - Buffer for production network latency
        if wait_for_health "${CONTAINER_PREFIX}api" 360 30; then
            # CRITICAL: Only cleanup images AFTER successful deployment
            # This ensures we can rollback if deployment fails
            log_info "Deployment successful - cleaning up old images (keeping only latest + 1 backup)..."
            local image_name_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
            local current_running_image=$(docker inspect --format='{{.Config.Image}}' "${CONTAINER_PREFIX}api" 2>/dev/null || echo "")
            
            if [[ -n "${image_name_base}" ]]; then
                # Step 1: Keep only the most recent backup image, remove all older backups
                log_info "Step 1: Cleaning up old backup images (keeping only most recent)..."
                if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]]; then
                    # Find all backup images, sort by creation date (newest first)
                    local backup_images=()
                    while IFS= read -r backup_img; do
                        [[ -n "$backup_img" ]] && backup_images+=("$backup_img")
                    done < <(docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}" | grep "rollback-backup" | sort -r)
                    
                    local kept_backup=false
                    for backup_img in "${backup_images[@]}"; do
                        if [[ "$backup_img" == "$OLD_IMAGE_BACKUP_TAG" ]]; then
                            if [[ "$kept_backup" == "false" ]]; then
                                log_info "Keeping most recent backup image: ${backup_img}"
                                kept_backup=true
                            else
                                log_info "Removing duplicate backup image: ${backup_img}"
                                docker rmi "$backup_img" 2>&1 || true
                            fi
                        else
                            log_info "Removing old backup image: ${backup_img}"
                            docker rmi "$backup_img" 2>&1 || true
                        fi
                    done
                    
                    if [[ "$kept_backup" == "true" ]]; then
                        log_success "Kept most recent backup image: ${OLD_IMAGE_BACKUP_TAG}"
                    fi
                else
                    # If OLD_IMAGE_BACKUP_TAG is not set, keep only the most recent backup
                    local backup_images=()
                    while IFS= read -r backup_img; do
                        [[ -n "$backup_img" ]] && backup_images+=("$backup_img")
                    done < <(docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}" | grep "rollback-backup" | sort -r)
                    
                    local backup_count=0
                    for backup_img in "${backup_images[@]}"; do
                        backup_count=$((backup_count + 1))
                        if [[ $backup_count -eq 1 ]]; then
                            log_info "Keeping most recent backup image: ${backup_img}"
                        else
                            log_info "Removing old backup image: ${backup_img}"
                            docker rmi "$backup_img" 2>&1 || true
                        fi
                    done
                fi
                
                # Step 2: Remove all old non-backup images (keep only current running image)
                log_info "Step 2: Removing old non-backup images (keeping only current running image)..."
                local images_to_keep=("${DOCKER_IMAGE}" "$current_running_image")
                if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]]; then
                    images_to_keep+=("${OLD_IMAGE_BACKUP_TAG}")
                fi
                
                while IFS= read -r img; do
                    if [[ -n "$img" ]] && [[ "$img" == *"healthcare-api"* ]] && [[ "$img" != *"rollback-backup"* ]]; then
                        local should_keep=false
                        for keep_img in "${images_to_keep[@]}"; do
                            if [[ "$img" == "$keep_img" ]]; then
                                should_keep=true
                                break
                            fi
                        done
                        
                        if [[ "$should_keep" == "false" ]]; then
                            log_info "Removing old image: ${img}"
                            docker rmi "$img" 2>&1 || true
                        else
                            log_info "Keeping image: ${img}"
                        fi
                    fi
                done < <(docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}")
                
                # Step 3: Final verification - ensure only latest + 1 backup exist
                log_info "Step 3: Verifying final image state..."
                local final_images=()
                while IFS= read -r img; do
                    [[ -n "$img" ]] && [[ "$img" == *"healthcare-api"* ]] && final_images+=("$img")
                done < <(docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}")
                
                local backup_count=0
                local non_backup_count=0
                for img in "${final_images[@]}"; do
                    if [[ "$img" == *"rollback-backup"* ]]; then
                        backup_count=$((backup_count + 1))
                    else
                        non_backup_count=$((non_backup_count + 1))
                    fi
                done
                
                log_info "Final image state: ${non_backup_count} non-backup image(s), ${backup_count} backup image(s)"
                if [[ $backup_count -gt 1 ]]; then
                    log_warning "Multiple backup images found (expected: 1) - this should not happen"
                fi
                if [[ $non_backup_count -gt 1 ]]; then
                    log_warning "Multiple non-backup images found (expected: 1) - this should not happen"
                fi
                
                log_success "Image cleanup completed - only latest image + 1 backup remain"
            fi
            
            # Success backup is run by CI (post-deployment-verification) so deploy finishes fast
            log_info "Deploy complete. Success backup will run in CI post-deployment step (non-blocking)."
            log_success "Application deployed successfully"
            
            # CRITICAL: Run post-deployment verification to ensure everything is correct
            # This handles all edge cases and can auto-recover if issues are found
            log_info "Running post-deployment verification..."
            if post_deployment_verification; then
                log_success "Post-deployment verification passed - deployment complete!"
                return 0
            else
                log_error "Post-deployment verification failed"
                # Post-deployment verification already handles rollback internally
                return 1
            fi
        else
            log_error "Application health check failed - database connection not established"
            log_error "Pipeline will fail - application is not ready to serve traffic"
            log_info "=== API Container Logs (last 100 lines) ==="
            docker logs --tail 100 "$api_container" 2>&1 || true
            log_info "=== Checking health endpoint directly ==="
            # Use Node.js instead of curl (curl not available in container)
            docker exec "$api_container" node -e "
                const http = require('http');
                http.get('http://localhost:8088/health', (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        console.log('Status:', res.statusCode);
                        console.log('Response:', data);
                        process.exit(res.statusCode === 200 ? 0 : 1);
                    });
                }).on('error', (err) => {
                    console.error('Error:', err.message);
                    process.exit(1);
                }).setTimeout(5000, () => {
                    console.error('Timeout');
                    process.exit(1);
                });
            " 2>&1 || echo "Health endpoint not accessible"
            rollback_deployment
            return 1
        fi
    else
        log_error "Application deployment failed - docker compose up returned error"
        log_info "=== Docker Compose Output ==="
        cat /tmp/docker-compose-up.log 2>&1 || true
        
        # Show container status even if they exist
        local api_container="${CONTAINER_PREFIX}api"
        local worker_container="${CONTAINER_PREFIX}worker"
        
        log_info "=== Container Status ==="
        docker ps -a --filter "name=${api_container}" --filter "name=${worker_container}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
        
        if docker ps -a --format "{{.Names}}" | grep -q "^${api_container}$"; then
            log_info "=== API Container Logs (last 50 lines) ==="
            docker logs --tail 50 "$api_container" 2>&1 || true
        fi
        
        if docker ps -a --format "{{.Names}}" | grep -q "^${worker_container}$"; then
            log_info "=== Worker Container Logs (last 50 lines) ==="
            docker logs --tail 50 "$worker_container" 2>&1 || true
        fi
        
        rollback_deployment
        return 1
    fi
}

# ============================================================================
# POST-DEPLOYMENT VERIFICATION AND AUTO-RECOVERY
# This ensures latest image is deployed and handles all edge cases
# ============================================================================

# Global variables for image tracking
DEPLOYED_IMAGE_ID=""
BACKUP_IMAGE_ID=""
EXPECTED_IMAGE_TAG=""

# Comprehensive post-deployment verification
# Ensures latest image is deployed, handles failures, and manages rollback
post_deployment_verification() {
    log_info "=========================================="
    log_info "=== POST-DEPLOYMENT VERIFICATION ==="
    log_info "=========================================="
    
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    local max_retries=3
    local retry_count=0
    local verification_passed=false
    
    # Store expected image for verification
    EXPECTED_IMAGE_TAG="${DOCKER_IMAGE}"
    local expected_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" 2>/dev/null | head -n 1)
    DEPLOYED_IMAGE_ID="${expected_image_id}"
    
    log_info "Expected image: ${EXPECTED_IMAGE_TAG}"
    log_info "Expected image ID: ${expected_image_id:0:12}"
    
    while [[ $retry_count -lt $max_retries ]] && ! $verification_passed; do
        retry_count=$((retry_count + 1))
        log_info "Post-deployment verification attempt ${retry_count}/${max_retries}..."
        
        # Step 1: Verify containers are running
        if ! verify_containers_running "$api_container" "$worker_container"; then
            log_error "Containers not running - attempting recovery..."
            if ! recover_containers; then
                continue
            fi
        fi
        
        # Step 2: Verify containers are using the correct image
        if ! verify_container_images "$api_container" "$worker_container" "$expected_image_id"; then
            log_error "Containers using wrong image - attempting image fix..."
            if ! fix_container_images "$api_container" "$worker_container"; then
                continue
            fi
        fi
        
        # Step 3: Verify application health
        if ! verify_application_health "$api_container"; then
            log_error "Application health check failed - database connection not established"
            log_error "Attempting recovery..."
            if ! recover_unhealthy_containers "$api_container" "$worker_container"; then
                continue
            fi
        fi
        
        # Step 4: Verify environment variables
        if ! verify_environment_variables "$api_container"; then
            log_error "Environment variables incorrect - attempting fix..."
            if ! fix_environment_variables "$api_container" "$worker_container"; then
                continue
            fi
        fi
        
        # All verifications passed
        verification_passed=true
        log_success "✅ All post-deployment verifications passed!"
    done
    
    if ! $verification_passed; then
        log_error "Post-deployment verification failed after ${max_retries} attempts"
        log_error "Initiating rollback to backup image..."
        if rollback_to_backup_image; then
            log_warning "Rolled back to backup image successfully"
            return 1
        else
            log_error "CRITICAL: Rollback to backup image also failed!"
            log_error "Manual intervention required"
            return 2
        fi
    fi
    
    # Final verification report
    generate_deployment_report "$api_container" "$worker_container"
    
    return 0
}

# Verify containers are running
verify_containers_running() {
    local api_container="$1"
    local worker_container="$2"
    
    log_info "Checking if containers are running..."
    
    local all_running=true
    
    if ! container_running "$api_container"; then
        log_error "API container ($api_container) is not running"
        all_running=false
    else
        log_success "API container is running"
    fi
    
    if ! container_running "$worker_container"; then
        log_error "Worker container ($worker_container) is not running"
        all_running=false
    else
        log_success "Worker container is running"
    fi
    
    $all_running
}

# Verify containers are using the correct image
verify_container_images() {
    local api_container="$1"
    local worker_container="$2"
    local expected_image_id="$3"
    
    log_info "Verifying containers are using the correct image..."
    
    local all_correct=true
    
    # Check API container
    local api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "")
    local api_image_tag=$(docker inspect --format='{{.Config.Image}}' "$api_container" 2>/dev/null || echo "")
    
    log_info "API container image: ${api_image_tag} (ID: ${api_image_id:0:12})"
    
    if [[ -z "$api_image_id" ]]; then
        log_error "Cannot get API container image ID"
        all_correct=false
    elif [[ "$api_image_id" != "$expected_image_id" ]] && [[ "$api_image_tag" != "${DOCKER_IMAGE}" ]] && [[ "$api_image_tag" != *"${DOCKER_IMAGE}"* ]]; then
        log_error "API container using wrong image!"
        log_error "  Expected: ${DOCKER_IMAGE} (ID: ${expected_image_id:0:12})"
        log_error "  Actual: ${api_image_tag} (ID: ${api_image_id:0:12})"
        all_correct=false
    else
        log_success "API container using correct image"
    fi
    
    # Check Worker container
    local worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "")
    local worker_image_tag=$(docker inspect --format='{{.Config.Image}}' "$worker_container" 2>/dev/null || echo "")
    
    log_info "Worker container image: ${worker_image_tag} (ID: ${worker_image_id:0:12})"
    
    if [[ -z "$worker_image_id" ]]; then
        log_error "Cannot get Worker container image ID"
        all_correct=false
    elif [[ "$worker_image_id" != "$expected_image_id" ]] && [[ "$worker_image_tag" != "${DOCKER_IMAGE}" ]] && [[ "$worker_image_tag" != *"${DOCKER_IMAGE}"* ]]; then
        log_error "Worker container using wrong image!"
        log_error "  Expected: ${DOCKER_IMAGE} (ID: ${expected_image_id:0:12})"
        log_error "  Actual: ${worker_image_tag} (ID: ${worker_image_id:0:12})"
        all_correct=false
    else
        log_success "Worker container using correct image"
    fi
    
    $all_correct
}

# Verify application readiness (requires actual database connection)
# Uses /health/ready endpoint which checks if database is actually connected
# This ensures pipeline fails if database connection is not established
verify_application_health() {
    local api_container="$1"
    # Increased timeout to 180s (3 minutes) to account for database connection time in production
    # Database connection can take 60-120s in production due to network latency, retries, etc.
    local health_timeout=180
    local health_interval=10
    local elapsed=0
    
    log_info "Verifying application health (requires database connection, timeout: ${health_timeout}s)..."
    log_info "Using /health endpoint - this requires actual database connection (no grace period)"
    
    while [[ $elapsed -lt $health_timeout ]]; do
        # Try internal health check using Node.js (curl not available in container)
        # Use Node.js to make HTTP request since it's available in the container
        local health_response="000"
        if docker exec "$api_container" node -e "
            const http = require('http');
            const req = http.get('http://localhost:8088/health', (res) => {
                process.exit(res.statusCode === 200 ? 0 : 1);
            });
            req.on('error', () => process.exit(1));
            req.setTimeout(5000, () => { req.destroy(); process.exit(1); });
        " 2>/dev/null; then
            health_response="200"
        fi
        
        if [[ "$health_response" == "200" ]]; then
            log_success "Application health check passed (HTTP 200) - database is connected"
            return 0
        fi
        
        # Try external health check (from host, curl should be available on host)
        local external_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/health 2>/dev/null || echo "000")
        if [[ "$external_response" == "200" ]]; then
            log_success "Application health check passed (external HTTP 200) - database is connected"
            return 0
        fi
        
        log_info "Health check: internal=${health_response}, external=${external_response} - waiting for database connection..."
        sleep $health_interval
        elapsed=$((elapsed + health_interval))
    done
    
    log_error "Application readiness check timed out after ${health_timeout}s"
    log_error "Database connection was not established - pipeline will fail"
    log_info "This means the application started but database connection failed or timed out"
    return 1
}

# Verify environment variables
verify_environment_variables() {
    local api_container="$1"
    
    log_info "Verifying critical environment variables..."
    
    local all_ok=true
    
    # Check OPENVIDU_URL
    local openvidu_url=$(docker exec "$api_container" sh -c 'echo "${OPENVIDU_URL:-NOT SET}"' 2>/dev/null || echo "ERROR")
    if [[ "$openvidu_url" == "NOT SET" ]] || [[ "$openvidu_url" == "ERROR" ]] || [[ "$openvidu_url" == *"openvidu-server:4443"* ]]; then
        log_error "OPENVIDU_URL is not set correctly: ${openvidu_url}"
        all_ok=false
    else
        log_success "OPENVIDU_URL is set: ${openvidu_url:0:30}..."
    fi
    
    # Check DATABASE_URL (partial - just verify it's set)
    local db_url=$(docker exec "$api_container" sh -c 'echo "${DATABASE_URL:-NOT SET}"' 2>/dev/null || echo "ERROR")
    if [[ "$db_url" == "NOT SET" ]] || [[ "$db_url" == "ERROR" ]]; then
        log_error "DATABASE_URL is not set"
        all_ok=false
    else
        log_success "DATABASE_URL is set"
    fi
    
    # Check NODE_ENV
    local node_env=$(docker exec "$api_container" sh -c 'echo "${NODE_ENV:-NOT SET}"' 2>/dev/null || echo "ERROR")
    if [[ "$node_env" != "production" ]]; then
        log_warning "NODE_ENV is not 'production': ${node_env}"
    else
        log_success "NODE_ENV is set to production"
    fi
    
    $all_ok
}

# Recover containers that are not running
recover_containers() {
    log_info "Attempting to recover containers..."
    
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    # Stop any existing containers
    docker stop "$api_container" "$worker_container" 2>&1 || true
    docker rm -f "$api_container" "$worker_container" 2>&1 || true
    
    # Wait for cleanup
    sleep 3
    
    # Ensure image is available
    log_info "Ensuring image is available: ${DOCKER_IMAGE}"
    docker pull "${DOCKER_IMAGE}" >/dev/null 2>&1 || {
        log_error "Failed to pull image for recovery"
        return 1
    }
    
    # Start containers
    export DOCKER_IMAGE="${DOCKER_IMAGE}"
    if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1; then
        log_info "Containers started, waiting for startup..."
        sleep 10
        
        if container_running "$api_container" && container_running "$worker_container"; then
            log_success "Container recovery successful"
            return 0
        fi
    fi
    
    log_error "Container recovery failed"
    return 1
}

# Fix containers using wrong image
fix_container_images() {
    local api_container="$1"
    local worker_container="$2"
    
    log_info "Fixing container images to use: ${DOCKER_IMAGE}"
    
    # Complete cleanup
    docker stop "$api_container" "$worker_container" 2>&1 || true
    docker rm -f "$api_container" "$worker_container" 2>&1 || true
    
    # Remove cached image to force fresh pull
    local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
    docker rmi "${DOCKER_IMAGE}" 2>&1 || true
    
    # Pull fresh image
    log_info "Pulling fresh image from registry..."
    if ! docker pull "${DOCKER_IMAGE}" >/dev/null 2>&1; then
        log_error "Failed to pull fresh image"
        return 1
    fi
    
    # Get new image ID
    local new_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" 2>/dev/null | head -n 1)
    log_info "Fresh image ID: ${new_image_id:0:12}"
    
    # Start containers with fresh image
    export DOCKER_IMAGE="${DOCKER_IMAGE}"
    if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1; then
        sleep 5
        
        # Verify the fix
        local api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "")
        local worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "")
        
        if [[ "$api_image_id" == "$new_image_id" ]] || [[ "$worker_image_id" == "$new_image_id" ]]; then
            log_success "Image fix successful - containers now using correct image"
            return 0
        fi
    fi
    
    log_error "Image fix failed"
    return 1
}

# Recover unhealthy containers
recover_unhealthy_containers() {
    local api_container="$1"
    local worker_container="$2"
    
    log_info "Attempting to recover unhealthy containers..."
    
    # Get container logs for diagnosis
    log_info "=== Recent API Container Logs ==="
    docker logs --tail 50 "$api_container" 2>&1 | tail -20 || true
    
    # Check for common issues
    local restart_needed=false
    
    # Check if container is in restart loop
    local restart_count=$(docker inspect --format='{{.RestartCount}}' "$api_container" 2>/dev/null || echo "0")
    if [[ "$restart_count" -gt 3 ]]; then
        log_warning "Container has restarted ${restart_count} times - likely configuration issue"
        restart_needed=true
    fi
    
    # Check for OOM kills
    local oom_killed=$(docker inspect --format='{{.State.OOMKilled}}' "$api_container" 2>/dev/null || echo "false")
    if [[ "$oom_killed" == "true" ]]; then
        log_error "Container was OOM killed - check memory limits"
        restart_needed=true
    fi
    
    if $restart_needed; then
        # Complete restart
        docker stop "$api_container" "$worker_container" 2>&1 || true
        docker rm -f "$api_container" "$worker_container" 2>&1 || true
        sleep 3
        
        export DOCKER_IMAGE="${DOCKER_IMAGE}"
        if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1; then
            sleep 15
            
            if container_running "$api_container" && container_running "$worker_container"; then
                # Re-check health
                if verify_application_health "$api_container"; then
                    log_success "Unhealthy container recovery successful"
                    return 0
                fi
            fi
        fi
    fi
    
    log_error "Unhealthy container recovery failed"
    return 1
}

# Fix environment variables
fix_environment_variables() {
    local api_container="$1"
    local worker_container="$2"
    
    log_info "Fixing environment variables..."
    
    # Recreate containers with explicit environment variables
    docker stop "$api_container" "$worker_container" 2>&1 || true
    docker rm -f "$api_container" "$worker_container" 2>&1 || true
    
    # Ensure all required environment variables are exported
    export DOCKER_IMAGE="${DOCKER_IMAGE}"
    export OPENVIDU_URL="${OPENVIDU_URL}"
    
    # Start with explicit environment
    OPENVIDU_URL="${OPENVIDU_URL}" DOCKER_IMAGE="${DOCKER_IMAGE}" \
        docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1 || {
        log_error "Failed to start containers with fixed environment"
        return 1
    }
    
    sleep 10
    
    if verify_environment_variables "$api_container"; then
        log_success "Environment variable fix successful"
        return 0
    fi
    
    log_error "Environment variable fix failed"
    return 1
}

# Rollback to backup image
rollback_to_backup_image() {
    log_info "Rolling back to backup image..."
    
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    # Find the most recent backup image
    local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
    local backup_image=""
    
    if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]]; then
        backup_image="${OLD_IMAGE_BACKUP_TAG}"
        log_info "Using backup image tag: ${backup_image}"
    else
        # Find the most recent rollback-backup tagged image
        backup_image=$(docker images "${image_base}" --format "{{.Repository}}:{{.Tag}}" | grep "rollback-backup" | head -n 1 || echo "")
    fi
    
    if [[ -z "$backup_image" ]]; then
        log_error "No backup image found - cannot rollback"
        return 1
    fi
    
    log_info "Found backup image: ${backup_image}"
    BACKUP_IMAGE_ID=$(docker images --format "{{.ID}}" "$backup_image" 2>/dev/null | head -n 1)
    log_info "Backup image ID: ${BACKUP_IMAGE_ID:0:12}"
    
    # Capture API logs and env before removing container (for debugging after rollback)
    capture_failed_deploy_diagnostics "$api_container"
    
    # Stop current containers
    docker stop "$api_container" "$worker_container" 2>&1 || true
    docker rm -f "$api_container" "$worker_container" 2>&1 || true
    
    # Tag backup image as the expected tag
    log_info "Retagging backup image as current..."
    docker tag "$backup_image" "${DOCKER_IMAGE}" 2>&1 || {
        log_error "Failed to retag backup image"
        return 1
    }
    
    # Start containers with backup image
    export DOCKER_IMAGE="${DOCKER_IMAGE}"
    if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --force-recreate --no-deps api worker 2>&1; then
        sleep 10
        
        if container_running "$api_container" && container_running "$worker_container"; then
            # Verify health
            if verify_application_health "$api_container"; then
                log_success "Rollback to backup image successful"
                return 0
            fi
        fi
    fi
    
    log_error "Rollback to backup image failed"
    return 1
}

# Generate deployment report
generate_deployment_report() {
    local api_container="$1"
    local worker_container="$2"
    
    log_info "=========================================="
    log_info "=== DEPLOYMENT VERIFICATION REPORT ==="
    log_info "=========================================="
    
    # Image information
    local api_image=$(docker inspect --format='{{.Config.Image}}' "$api_container" 2>/dev/null || echo "N/A")
    local api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "N/A")
    local worker_image=$(docker inspect --format='{{.Config.Image}}' "$worker_container" 2>/dev/null || echo "N/A")
    local worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "N/A")
    
    log_info "Deployed Image:"
    log_info "  Tag: ${DOCKER_IMAGE}"
    log_info "  Expected ID: ${DEPLOYED_IMAGE_ID:0:12}"
    log_info ""
    log_info "API Container:"
    log_info "  Name: ${api_container}"
    log_info "  Image: ${api_image}"
    log_info "  Image ID: ${api_image_id:0:12}"
    log_info "  Status: $(docker inspect --format='{{.State.Status}}' "$api_container" 2>/dev/null || echo "N/A")"
    log_info "  Started: $(docker inspect --format='{{.State.StartedAt}}' "$api_container" 2>/dev/null || echo "N/A")"
    log_info ""
    log_info "Worker Container:"
    log_info "  Name: ${worker_container}"
    log_info "  Image: ${worker_image}"
    log_info "  Image ID: ${worker_image_id:0:12}"
    log_info "  Status: $(docker inspect --format='{{.State.Status}}' "$worker_container" 2>/dev/null || echo "N/A")"
    log_info "  Started: $(docker inspect --format='{{.State.StartedAt}}' "$worker_container" 2>/dev/null || echo "N/A")"
    log_info ""
    
    # Backup image info
    if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]]; then
        log_info "Backup Image:"
        log_info "  Tag: ${OLD_IMAGE_BACKUP_TAG}"
        log_info "  Available for rollback: Yes"
    else
        log_info "Backup Image: None (first deployment)"
    fi
    
    log_info ""
    log_success "=========================================="
    log_success "=== DEPLOYMENT VERIFIED SUCCESSFULLY ==="
    log_success "=========================================="
}

# ============================================================================
# SCHEDULED IMAGE VERIFICATION JOB
# Can be run independently to verify and ensure latest image is deployed
# Usage: ./deploy.sh verify-image
# ============================================================================

# Verify and ensure latest image is deployed
# This can be used as a scheduled job or post-deployment check
verify_and_deploy_latest_image() {
    log_info "=========================================="
    log_info "=== IMAGE VERIFICATION AND DEPLOYMENT ==="
    log_info "=========================================="
    
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    # Get the expected image from environment or default
    if [[ -z "${DOCKER_IMAGE:-}" ]]; then
        if [[ -n "${IMAGE:-}" ]] && [[ -n "${IMAGE_TAG:-}" ]]; then
            DOCKER_IMAGE="${IMAGE}:${IMAGE_TAG}"
        else
            DOCKER_IMAGE="ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:latest"
        fi
    fi
    export DOCKER_IMAGE="${DOCKER_IMAGE}"
    log_info "Expected image: ${DOCKER_IMAGE}"
    
    # Step 1: Check what's currently running
    log_info "Step 1: Checking current deployment..."
    
    local current_api_image=""
    local current_api_image_id=""
    local current_worker_image=""
    local current_worker_image_id=""
    
    if container_running "$api_container"; then
        current_api_image=$(docker inspect --format='{{.Config.Image}}' "$api_container" 2>/dev/null || echo "")
        current_api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "")
        log_info "API container running with image: ${current_api_image} (ID: ${current_api_image_id:0:12})"
    else
        log_warning "API container is not running"
    fi
    
    if container_running "$worker_container"; then
        current_worker_image=$(docker inspect --format='{{.Config.Image}}' "$worker_container" 2>/dev/null || echo "")
        current_worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "")
        log_info "Worker container running with image: ${current_worker_image} (ID: ${current_worker_image_id:0:12})"
    else
        log_warning "Worker container is not running"
    fi
    
    # Step 2: Get latest image from registry
    log_info "Step 2: Fetching latest image from registry..."
    
    # Store current image as backup before pulling new one
    if [[ -n "$current_api_image" ]] && [[ -n "$current_api_image_id" ]]; then
        local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
        OLD_IMAGE_BACKUP_TAG="${image_base}:rollback-backup-$(date +%Y%m%d-%H%M%S)"
        log_info "Backing up current image as: ${OLD_IMAGE_BACKUP_TAG}"
        docker tag "$current_api_image" "$OLD_IMAGE_BACKUP_TAG" 2>&1 || {
            log_warning "Could not create backup tag (may already exist)"
        }
    fi
    
    # Pull latest image
    log_info "Pulling latest image: ${DOCKER_IMAGE}"
    if ! docker pull "${DOCKER_IMAGE}" >/dev/null 2>&1; then
        log_error "Failed to pull latest image from registry"
        return 1
    fi
    
    local latest_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" 2>/dev/null | head -n 1)
    local latest_image_digest=$(docker images --format "{{.Digest}}" "${DOCKER_IMAGE}" 2>/dev/null | head -n 1 || echo "")
    log_info "Latest image ID: ${latest_image_id:0:12}"
    if [[ -n "$latest_image_digest" ]] && [[ "$latest_image_digest" != "<none>" ]]; then
        log_info "Latest image digest: ${latest_image_digest:0:30}..."
    fi
    
    # Step 3: Compare and decide
    log_info "Step 3: Comparing current vs latest..."
    
    local needs_update=false
    
    if [[ -z "$current_api_image_id" ]] || [[ -z "$current_worker_image_id" ]]; then
        log_info "One or more containers not running - deployment needed"
        needs_update=true
    elif [[ "$current_api_image_id" != "$latest_image_id" ]] || [[ "$current_worker_image_id" != "$latest_image_id" ]]; then
        log_info "Current image differs from latest - update needed"
        log_info "  Current API: ${current_api_image_id:0:12}"
        log_info "  Current Worker: ${current_worker_image_id:0:12}"
        log_info "  Latest: ${latest_image_id:0:12}"
        needs_update=true
    else
        log_success "Containers are already running the latest image"
        log_info "  Image ID: ${latest_image_id:0:12}"
    fi
    
    if $needs_update; then
        # Step 4: Deploy latest image
        log_info "Step 4: Deploying latest image..."
        
        # Stop and remove current containers
        log_info "Stopping current containers..."
        docker stop "$api_container" "$worker_container" 2>&1 || true
        docker rm -f "$api_container" "$worker_container" 2>&1 || true
        
        # Wait for cleanup
        sleep 3
        
        # Start containers with latest image
        log_info "Starting containers with latest image..."
        export DOCKER_IMAGE="${DOCKER_IMAGE}"
        if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api worker 2>&1; then
            log_info "Containers started, waiting for startup..."
            sleep 10
            
            # Verify deployment
            if container_running "$api_container" && container_running "$worker_container"; then
                local new_api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "")
                local new_worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "")
                
                if [[ "$new_api_image_id" == "$latest_image_id" ]] && [[ "$new_worker_image_id" == "$latest_image_id" ]]; then
                    log_success "✅ Successfully deployed latest image!"
                    log_info "  Image ID: ${latest_image_id:0:12}"
                    
                    # Verify health
                    log_info "Verifying application health..."
                    if verify_application_health "$api_container"; then
                        log_success "✅ Application is healthy!"
                        
                        # Cleanup old backup images (keep only 1 most recent backup)
                        log_info "Cleaning up old backup images (keeping only most recent)..."
                        local image_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
                        local backup_images=()
                        while IFS= read -r backup_img; do
                            [[ -n "$backup_img" ]] && backup_images+=("$backup_img")
                        done < <(docker images "${image_base}" --format "{{.Repository}}:{{.Tag}}" | grep "rollback-backup" | sort -r)
                        
                        local backup_count=0
                        for backup_img in "${backup_images[@]}"; do
                            backup_count=$((backup_count + 1))
                            if [[ $backup_count -eq 1 ]]; then
                                log_info "Keeping most recent backup: ${backup_img}"
                            else
                                log_info "Removing old backup: ${backup_img}"
                                docker rmi "$backup_img" 2>&1 || true
                            fi
                        done || true
                        
                        # Also remove old non-backup images (keep only current)
                        log_info "Removing old non-backup images..."
                        local current_running_image=$(docker inspect --format='{{.Config.Image}}' "${api_container}" 2>/dev/null || echo "")
                        while IFS= read -r img; do
                            if [[ -n "$img" ]] && \
                               [[ "$img" == *"healthcare-api"* ]] && \
                               [[ "$img" != *"rollback-backup"* ]] && \
                               [[ "$img" != "$current_running_image" ]] && \
                               [[ "$img" != "${DOCKER_IMAGE}" ]]; then
                                log_info "Removing old image: ${img}"
                                docker rmi "$img" 2>&1 || true
                            fi
                        done < <(docker images "${image_base}" --format "{{.Repository}}:{{.Tag}}")
                        
                        return 0
                    else
                        log_error "Application health check failed - rolling back..."
                        rollback_to_backup_image
                        return 1
                    fi
                else
                    log_error "Containers not using the expected image after deployment"
                    log_error "  Expected: ${latest_image_id:0:12}"
                    log_error "  API: ${new_api_image_id:0:12}"
                    log_error "  Worker: ${new_worker_image_id:0:12}"
                    log_info "Attempting to fix..."
                    fix_container_images "$api_container" "$worker_container"
                    return $?
                fi
            else
                log_error "Containers failed to start"
                rollback_to_backup_image
                return 1
            fi
        else
            log_error "docker compose up failed"
            rollback_to_backup_image
            return 1
        fi
    fi
    
    # Step 5: Final verification (even if no update was needed)
    log_info "Step 5: Final verification..."
    
    if container_running "$api_container" && container_running "$worker_container"; then
        if verify_application_health "$api_container"; then
            log_success "✅ Deployment verification complete - system is healthy and ready!"
            return 0
        else
            log_error "Application health check failed - database connection not established"
            log_error "Pipeline will fail - deployment verification unsuccessful"
            return 1
        fi
    else
        log_error "Containers are not running"
        return 1
    fi
}

# Quick image check (non-destructive) - just reports status
check_image_status() {
    log_info "=========================================="
    log_info "=== IMAGE STATUS CHECK ==="
    log_info "=========================================="
    
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    # Get current running images
    log_info "Current running containers:"
    if container_running "$api_container"; then
        local api_image=$(docker inspect --format='{{.Config.Image}}' "$api_container" 2>/dev/null || echo "N/A")
        local api_image_id=$(docker inspect --format='{{.Image}}' "$api_container" 2>/dev/null || echo "N/A")
        local api_created=$(docker inspect --format='{{.Created}}' "$api_container" 2>/dev/null || echo "N/A")
        log_info "  API: ${api_image} (ID: ${api_image_id:0:12}, Created: ${api_created})"
    else
        log_warning "  API: NOT RUNNING"
    fi
    
    if container_running "$worker_container"; then
        local worker_image=$(docker inspect --format='{{.Config.Image}}' "$worker_container" 2>/dev/null || echo "N/A")
        local worker_image_id=$(docker inspect --format='{{.Image}}' "$worker_container" 2>/dev/null || echo "N/A")
        local worker_created=$(docker inspect --format='{{.Created}}' "$worker_container" 2>/dev/null || echo "N/A")
        log_info "  Worker: ${worker_image} (ID: ${worker_image_id:0:12}, Created: ${worker_created})"
    else
        log_warning "  Worker: NOT RUNNING"
    fi
    
    # List available images
    log_info ""
    log_info "Available images:"
    local image_base="ghcr.io/ishswami-tech/healthcarebackend/healthcare-api"
    docker images "${image_base}" --format "table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}" | head -10 || true
    
    # List backup images
    log_info ""
    log_info "Backup images available for rollback:"
    docker images "${image_base}" --format "{{.Repository}}:{{.Tag}}" | grep "rollback-backup" || echo "  No backup images found"
    
    log_info ""
    log_info "=========================================="
}

# Validate container dependencies
validate_container_dependencies() {
    log_info "Validating container dependencies..."
    
    # Check postgres is healthy before starting api
    if ! wait_for_health "postgres" 120; then
        log_error "PostgreSQL not healthy - cannot start application"
        return 1
    fi
    
    # Check dragonfly is healthy
    if ! wait_for_health "dragonfly" 60; then
        log_error "Dragonfly not healthy - cannot start application"
        return 1
    fi
    
    # Check coturn is healthy (for video calls)
    if ! wait_for_health "coturn" 30; then
        log_warning "Coturn not healthy - video calls may not work"
        # Non-critical, continue
    fi
    
    log_success "All dependencies are healthy"
    return 0
}

# Run database migrations safely with backup and rollback
run_migrations_safely() {
    log_info "Running database migrations safely..."
    
    # Create pre-migration backup
    log_info "Creating pre-migration backup..."
    local backup_script="${DEPLOY_SCRIPT_DIR}/backup.sh"
    [[ ! -f "$backup_script" ]] && backup_script="${SCRIPT_DIR}/backup.sh"
    [[ ! -f "$backup_script" ]] && backup_script="${BASE_DIR}/devops/scripts/docker-infra/backup.sh"
    
    local PRE_MIGRATION_BACKUP=""
    if [[ -f "$backup_script" ]]; then
        # Use pre-deployment backup type (backup.sh doesn't have pre-migration command)
        local backup_output
        backup_output=$("$backup_script" "pre-deployment" 2>&1) || {
            log_warning "Pre-migration backup failed, but continuing..."
            backup_output=""
        }
        # Extract backup ID from output (backup.sh outputs the backup ID on stdout)
        # The backup ID format is: pre-deployment-YYYY-MM-DD-HHMMSS
        if [[ -n "$backup_output" ]]; then
            # Extract backup ID pattern from output (may be mixed with log messages)
            local extracted_id
            extracted_id=$(echo "$backup_output" | grep -oE "pre-deployment-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}" | head -1)
            if [[ -n "$extracted_id" ]]; then
                PRE_MIGRATION_BACKUP="$extracted_id"
            log_success "Pre-migration backup created: ${PRE_MIGRATION_BACKUP}"
            else
                log_warning "Could not extract backup ID from backup output"
                PRE_MIGRATION_BACKUP=""
            fi
        fi
    fi
    
    # Check if api container exists (for running migrations)
    if ! container_running "${CONTAINER_PREFIX}api"; then
        log_info "API container not running, starting temporarily for migrations..."
        # CRITICAL: Temporarily increase memory limit for migrations to prevent OOM
        # Prisma migrations can be memory-intensive, especially with large databases
        log_info "Temporarily increasing container memory limit for migrations (to prevent OOM)..."
        
        # Start container with increased memory limit for migrations
        # Use docker compose with memory override via environment variable
        # Note: This requires docker-compose to support memory limits via environment
        docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --no-deps api || {
            log_error "Failed to start API container for migrations"
            return 1
        }
        
        # If container started but has low memory limit, try to increase it temporarily
        # Check current memory limit
        local current_mem_limit
        current_mem_limit=$(docker inspect "${CONTAINER_PREFIX}api" --format '{{.HostConfig.Memory}}' 2>/dev/null || echo "0")
        if [[ "$current_mem_limit" != "0" ]]; then
            local current_mem_mb=$((current_mem_limit / 1024 / 1024))
            if [[ $current_mem_mb -lt 8192 ]]; then
                log_warning "Container memory limit is ${current_mem_mb}MB - migrations may fail with OOM"
                log_warning "Consider increasing memory limit in docker-compose.prod.yml to at least 8GB for migrations"
                log_warning "Current limit: ${current_mem_mb}MB, Recommended: 8192MB (8GB) or higher"
            fi
        fi
        
        log_info "Waiting for API container to initialize..."
        sleep 10  # Give container time to load environment variables
    fi
    
    # Verify container is actually healthy (not just running but crashed)
    log_info "Verifying container health..."
    local container_status
    container_status=$(docker inspect "${CONTAINER_PREFIX}api" --format '{{.State.Status}}' 2>/dev/null || echo "unknown")
    local container_exit_code
    container_exit_code=$(docker inspect "${CONTAINER_PREFIX}api" --format '{{.State.ExitCode}}' 2>/dev/null || echo "0")
    
    if [[ "$container_status" != "running" ]]; then
        log_error "API container is not running (status: $container_status)"
        if [[ "$container_exit_code" != "0" ]] && [[ "$container_exit_code" != "" ]]; then
            log_error "Container exit code: $container_exit_code"
            if [[ "$container_exit_code" == "137" ]]; then
                log_error "Exit code 137 indicates the container was killed (likely Out of Memory - OOM)"
                log_error "Check container logs: docker logs ${CONTAINER_PREFIX}api"
                log_error "Check system memory: free -h"
            fi
        fi
        log_error "Cannot proceed with migrations - container must be running"
        return 1
    fi
    
    # Check if container process is actually running (not just created)
    if ! docker exec "${CONTAINER_PREFIX}api" sh -c "exit 0" >/dev/null 2>&1; then
        log_error "API container exists but is not responding to commands"
        log_error "Container may be crashing or in a bad state"
        log_error "Check container logs: docker logs ${CONTAINER_PREFIX}api"
        return 1
    fi
    
    # Verify container has DATABASE_URL before proceeding
    log_info "Verifying container environment..."
    if ! docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL >/dev/null 2>&1; then
        log_warning "DATABASE_URL not found in container environment - this may cause migration issues"
    fi
    
    # Run migrations
    log_info "Running Prisma migrations..."
    # Use PRISMA_SCHEMA_PATH from environment or default path
    local schema_path="${PRISMA_SCHEMA_PATH:-/app/src/libs/infrastructure/database/prisma/schema.prisma}"
    
    # Helper function to validate DATABASE_URL format
    validate_database_url() {
        local url="$1"
        # Check if URL is empty
        if [[ -z "$url" ]]; then
            return 1
        fi
        # Check if it looks like an error message (contains common error keywords)
        if [[ "$url" =~ (FailedPrecondition|Error|ERROR|error|container.*init process|No such container) ]]; then
            return 1
        fi
        # Check if it's a valid PostgreSQL URL format
        if [[ ! "$url" =~ ^postgresql:// ]] && [[ ! "$url" =~ ^postgres:// ]]; then
            return 1
        fi
        # Check if it contains required components (@ symbol for password, :// for protocol)
        if [[ ! "$url" =~ @ ]] || [[ ! "$url" =~ :// ]]; then
            return 1
        fi
        return 0
    }
    
   
    
    local database_url
    local env_production_path="${SCRIPT_DIR}/../../.env.production"
    
    # Priority 1: Check if DATABASE_URL is set in deployment script environment (from GitHub Actions)
    if [[ -n "${DATABASE_URL:-}" ]] && validate_database_url "${DATABASE_URL}"; then
        database_url="${DATABASE_URL}"
        log_info "Using DATABASE_URL from GitHub Actions/environment variable"
    else
        # Priority 2: Try to read from .env.production file (backup from previous deployment)
        log_info "DATABASE_URL not found in environment, checking .env.production file..."
        if [[ -f "$env_production_path" ]]; then
            # Read DATABASE_URL from .env.production
            # Handle both formats: DATABASE_URL=value and DATABASE_URL="value" or DATABASE_URL='value'
            local env_db_url
            env_db_url=$(grep -E "^DATABASE_URL=" "$env_production_path" 2>/dev/null | head -n 1 | sed 's/^DATABASE_URL=//' | sed 's/^["'\'']//;s/["'\'']$//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || echo "")
            
            if [[ -n "$env_db_url" ]] && validate_database_url "$env_db_url"; then
                database_url="$env_db_url"
                log_success "Using DATABASE_URL from .env.production file (backup from previous deployment)"
            else
                if [[ -n "$env_db_url" ]]; then
                    log_warning "DATABASE_URL found in .env.production but is invalid format"
                else
                    log_warning "DATABASE_URL not found in .env.production file"
                fi
            fi
        else
            log_warning ".env.production file not found at: $env_production_path"
        fi
        
        # Priority 3: Try to read from existing container environment (if container is running)
        if [[ -z "${database_url:-}" ]]; then
            log_info "DATABASE_URL not found in .env.production, checking existing container..."
            if container_running "${CONTAINER_PREFIX}api"; then
                local db_url_output
                db_url_output=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>&1)
                local docker_exit_code=$?
                
                # Check if docker exec succeeded and output is valid
                if [[ $docker_exit_code -eq 0 ]] && validate_database_url "$db_url_output"; then
                    database_url="$db_url_output"
                    log_success "Using DATABASE_URL from existing container environment"
                else
                    log_warning "Failed to read valid DATABASE_URL from container (exit code: $docker_exit_code)"
                    if [[ -n "$db_url_output" ]]; then
                        log_warning "Container output (first 100 chars): ${db_url_output:0:100}***"
                    fi
                fi
            else
                log_warning "Container ${CONTAINER_PREFIX}api is not running, cannot read DATABASE_URL from container"
            fi
        fi
        
        # Priority 4: FAIL if DATABASE_URL is still not found (security - no hardcoded credentials)
        if [[ -z "${database_url:-}" ]]; then
            log_error "=========================================="
            log_error "SECURITY ERROR: DATABASE_URL not found!"
            log_error "=========================================="
            log_error "DATABASE_URL must be provided via one of:"
            log_error "  1. GitHub Actions environment variable/secrets (recommended)"
            log_error "  2. .env.production file (backup from previous deployment)"
            log_error "  3. Existing running container environment"
            log_error ""
            log_error "For security reasons, no hardcoded DATABASE_URL is allowed."
            log_error "Please ensure DATABASE_URL is set in GitHub Actions secrets or .env.production file."
            log_error ""
            log_error "To fix:"
            log_error "  - Set DATABASE_URL in GitHub Actions workflow secrets/env vars"
            log_error "  - Or ensure .env.production exists with DATABASE_URL"
            log_error "  - Or ensure container is running with DATABASE_URL in environment"
            log_error "=========================================="
            return 1
        fi
    fi
    
    # Final validation of the database_url we're about to use
    if ! validate_database_url "$database_url"; then
        log_error "ERROR: DATABASE_URL validation failed!"
        log_error "URL value (first 100 chars): ${database_url:0:100}***"
        log_error "This indicates a serious configuration issue - DATABASE_URL is malformed"
        return 1
    fi
    
    # Always run password fix script first to ensure PostgreSQL password matches DATABASE_URL
    log_info "Ensuring database password matches DATABASE_URL..."
    if [[ -f "${SCRIPT_DIR}/fix-database-password.sh" ]]; then
        if "${SCRIPT_DIR}/fix-database-password.sh"; then
            log_success "Database password verified/fixed"
            # Get updated DATABASE_URL from container after fix (with validation)
            local updated_db_url
            local updated_output
            updated_output=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>&1)
            local update_exit_code=$?
            
            if [[ $update_exit_code -eq 0 ]] && validate_database_url "$updated_output"; then
                database_url="$updated_output"
                log_info "Updated DATABASE_URL from container after password fix"
            else
                log_warning "Could not read valid DATABASE_URL from container after password fix, keeping previous value"
                if [[ -n "$updated_output" ]] && [[ "$updated_output" != "$database_url" ]]; then
                    log_warning "Container returned (first 100 chars): ${updated_output:0:100}***"
                fi
            fi
        else
            log_warning "Password fix script had issues, but continuing..."
        fi
    fi
    
    # Validate DATABASE_URL one more time before proceeding
    if ! validate_database_url "$database_url"; then
        log_error "ERROR: DATABASE_URL is invalid after password fix!"
        log_error "URL value (first 100 chars): ${database_url:0:100}***"
        return 1
    fi
    
    # Verify database connection before running migrations
    log_info "Verifying database connection..."
    # Extract password from DATABASE_URL for testing (handle URL encoding)
    local db_password=$(echo "$database_url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' || echo "postgres")
    # URL decode the password in case it's encoded
    db_password=$(printf '%b' "${db_password//%/\\x}" 2>/dev/null || echo "$db_password")
    
    # First, verify the connection works with the password from DATABASE_URL
    log_info "Testing connection with password from DATABASE_URL..."
    if ! docker exec -e PGPASSWORD="$db_password" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
        log_error "Database connection test failed!"
        log_error "Expected DATABASE_URL: ${database_url:0:50}***"
        log_error "Please verify:"
        log_error "  1. PostgreSQL container is running and healthy"
        log_error "  2. Password in DATABASE_URL matches POSTGRES_PASSWORD in docker-compose"
        log_error "  3. .env.production file doesn't override DATABASE_URL with wrong password"
        log_error ""
        log_error "Database connection failed even after password fix attempt"
        log_error "This indicates a serious configuration issue"
        return 1
    else
        log_success "Database connection verified with password from DATABASE_URL"
    fi
    
    # Run migrations with DATABASE_URL explicitly set
    log_info "Running Prisma migrations with schema: $schema_path"
    log_info "Using DATABASE_URL: ${database_url:0:40}***"
    
    # Prisma needs DATABASE_URL in the environment. Since the container should already have it,
    # we'll verify it's set, and if not, we'll set it explicitly.
    # First, check if DATABASE_URL is already in the container
    local container_has_db_url
    container_has_db_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>/dev/null || echo "")
    
    # Always ensure the container has the correct DATABASE_URL before running Prisma
    # Update the container's environment if it doesn't match
    if [[ -z "$container_has_db_url" ]] || [[ "$container_has_db_url" != "$database_url" ]]; then
        log_info "Updating DATABASE_URL in container environment to match verified connection..."
        # Update the container's environment variable by recreating it with the correct env var
        # Or use docker exec to set it in the running container's environment
        # For now, we'll pass it explicitly via -e flag which should override container's env
    else
        log_info "Container DATABASE_URL matches verified connection string"
    fi
    
    # Run migrations - Prisma 7 reads DATABASE_URL from process.env in prisma.config.js
    # The config file path is relative to the schema directory
    # Ensure DATABASE_URL is set in the environment for Node.js to access it
    # Debug: Log what DATABASE_URL will be used (masked)
    log_info "DATABASE_URL for Prisma (masked): ${database_url:0:30}***"
    
    # Verify DATABASE_URL is accessible in container before running Prisma
    # Check what DATABASE_URL the container currently has
    local container_current_db_url
    container_current_db_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>/dev/null || echo "")
    if [[ -n "$container_current_db_url" ]] && [[ "$container_current_db_url" != "$database_url" ]]; then
        log_warning "Container DATABASE_URL differs from verified one - will override with verified URL"
        log_info "Container has: ${container_current_db_url:0:40}***"
        log_info "Using verified: ${database_url:0:40}***"
    fi
    
    # Check if DIRECT_URL is set in container (we'll unset it for migrations)
    # Both prisma.config.js and run-prisma.js now prioritize DATABASE_URL over DIRECT_URL
    local direct_url
    direct_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DIRECT_URL 2>/dev/null || echo "")
    
    # Create clean DATABASE_URL (without Prisma-specific query parameters) for Prisma
    # Prisma config.js will clean it, but we'll create a clean version to be safe
    # IMPORTANT: Preserve schema=public parameter as Prisma may need it
    # Only remove Prisma-specific connection pool parameters
    local clean_database_url
    if [[ "$database_url" == *"?"* ]]; then
        # URL has query parameters - remove only Prisma-specific ones, preserve schema
        # Remove: connection_limit, pool_timeout, statement_timeout, etc.
        # Keep: schema=public (important for Prisma)
        clean_database_url=$(echo "$database_url" | sed -E 's/[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*//g')
        # Clean up any double ? or & characters
        clean_database_url=$(echo "$clean_database_url" | sed -E 's/\?&+/?/g' | sed -E 's/&+/&/g' | sed -E 's/[?&]$//')
    else
        # URL has no query parameters - use as is
        clean_database_url="$database_url"
    fi
    
    # CRITICAL: Always ensure schema=public is present (required by Prisma)
    # Do this AFTER cleaning but BEFORE any tests or config checks
    if [[ ! "$clean_database_url" == *"schema="* ]]; then
        if [[ "$clean_database_url" == *"?"* ]]; then
            clean_database_url="${clean_database_url}&schema=public"
        else
            clean_database_url="${clean_database_url}?schema=public"
        fi
        log_info "Added schema=public to DATABASE_URL (was missing from original)"
    fi
    
    # Verify the clean URL still has the password
    if [[ ! "$clean_database_url" == *"@"* ]]; then
        log_error "ERROR: Clean DATABASE_URL is missing password or @ symbol!"
        log_error "Original: ${database_url:0:60}***"
        log_error "Clean: ${clean_database_url:0:60}***"
        return 1
    fi
    
    # Log DIRECT_URL if set (for debugging only - we will always use DATABASE_URL)
    if [[ -n "$direct_url" ]]; then
        log_info "DIRECT_URL is set in container - will be unset during migration (using DATABASE_URL instead)"
        log_info "DIRECT_URL (masked): ${direct_url:0:40}***"
    fi
    
    # CRITICAL: Always use DATABASE_URL, never DIRECT_URL
    # Both prisma.config.js and run-prisma.js prioritize DATABASE_URL, but we unset DIRECT_URL for safety
    local config_file_path="/app/src/libs/infrastructure/database/prisma/prisma.config.js"
    log_info "Using verified DATABASE_URL for Prisma migrations (DIRECT_URL will be unset)"
    
    # Run migrations - unset DIRECT_URL and use verified DATABASE_URL
    log_info "Executing Prisma migration command..."
    log_info "Command: npx prisma migrate deploy --schema '$schema_path' --config '$config_file_path'"
    log_info "DATABASE_URL (masked): ${clean_database_url:0:50}***"
    
    # Verify clean_database_url has password before running migration
    local url_password=$(echo "$clean_database_url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' || echo "")
    if [[ -z "$url_password" ]]; then
        log_error "ERROR: Clean DATABASE_URL is missing password!"
        log_error "Clean URL (masked): ${clean_database_url:0:80}***"
        return 1
    fi
    log_info "Verified clean DATABASE_URL contains password (first 2 chars: ${url_password:0:2}***)"
    
    # Test connection with clean_database_url to ensure it works
    # Test 1: Direct connection from host (using docker exec on postgres container)
    log_info "Testing database connection with clean DATABASE_URL (direct from host)..."
    local clean_password=$(printf '%b' "${url_password//%/\\x}" 2>/dev/null || echo "$url_password")
    if ! docker exec -e PGPASSWORD="$clean_password" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
        log_error "ERROR: Database connection test failed with clean DATABASE_URL!"
        log_error "This suggests the clean URL is malformed or password is incorrect"
        return 1
    fi
    log_success "Database connection test passed with clean DATABASE_URL (direct)"
    
    # Test 2: Verify API container can reach PostgreSQL hostname (network connectivity)
    # This checks if the Docker network is properly configured
    log_info "Verifying API container can reach PostgreSQL hostname..."
    if docker exec "${CONTAINER_PREFIX}api" sh -c "timeout 2 bash -c '</dev/tcp/postgres/5432' 2>/dev/null" >/dev/null 2>&1; then
        log_success "API container can reach PostgreSQL hostname (network OK)"
    else
        log_warning "WARNING: API container cannot reach PostgreSQL hostname"
        log_warning "This might indicate Docker network configuration issues"
        log_warning "Both containers must be on the same Docker network (app-network)"
    fi
    
    # Test 3: Check PostgreSQL pg_hba.conf allows Docker network connections
    # This is critical if PostgreSQL is restricted to Docker network only
    log_info "Checking PostgreSQL pg_hba.conf configuration..."
    local pg_hba_check
    pg_hba_check=$(docker exec postgres grep -E "^host\s+all\s+all\s+172\.18\.0\.0/16" /var/lib/postgresql/data/pgdata/pg_hba.conf 2>/dev/null || echo "")
    if [[ -n "$pg_hba_check" ]]; then
        log_success "PostgreSQL pg_hba.conf allows Docker network (172.18.0.0/16) connections"
    else
        log_warning "WARNING: PostgreSQL pg_hba.conf might not allow Docker network connections"
        log_warning "If PostgreSQL is restricted to Docker network, ensure pg_hba.conf has:"
        log_warning "  host    all             all             172.18.0.0/16            scram-sha-256"
        log_warning "This is required for Prisma to connect from API container"
    fi
    
    # Run migration and capture both stdout and stderr
    # CRITICAL: The issue is that prisma.config.js reads process.env.DATABASE_URL at module load time
    # We need to ensure DATABASE_URL is set BEFORE Node.js loads the config file
    # Use both -e flag (sets env for docker exec) AND explicit export (sets env for Node.js process)
    local migration_output
    local migration_exit_code
    
    # CRITICAL FIX: The issue is that prisma.config.js reads process.env.DATABASE_URL at module load time
    # When Node.js requires() the config file, it executes getCleanDatabaseUrl() immediately
    # We need to ensure DATABASE_URL is set BEFORE the module is loaded
    # Solution: Use NODE_OPTIONS to set env vars, or create a wrapper script that sets env before requiring config
    log_info "Running Prisma migration with DATABASE_URL set..."
    
    # Test what the config will see BEFORE running migration
    # Use base64 encoding to avoid shell escaping issues
    log_info "Testing what prisma.config.js will read..."
    local encoded_url_test
    encoded_url_test=$(echo -n "$clean_database_url" | base64 -w0)
    local config_test_output
    config_test_output=$(docker exec "${CONTAINER_PREFIX}api" sh -c "
        export DATABASE_URL=\$(echo '$encoded_url_test' | base64 -d)
        unset DIRECT_URL
        cd /app && node -e \"
delete require.cache[require.resolve('./src/libs/infrastructure/database/prisma/prisma.config.js')];
const config = require('./src/libs/infrastructure/database/prisma/prisma.config.js');
const url = config.datasource.url || '';
console.log('[DEBUG] Config datasource URL (masked):', url ? (url.substring(0, 30) + '***' + url.substring(url.length - 10)) : 'EMPTY');
console.log('[DEBUG] Config datasource URL length:', url.length);
console.log('[DEBUG] Config datasource URL has @:', url.includes('@'));
console.log('[DEBUG] Config datasource URL starts with postgresql:', url.startsWith('postgresql://'));
const passwordMatch = url.match(/postgresql:\/\/[^:]+:([^@]+)@/);
console.log('[DEBUG] Password in URL (first 2 chars):', passwordMatch ? (passwordMatch[1].substring(0, 2) + '***') : 'NOT FOUND');
console.log('[DEBUG] Password length:', passwordMatch ? passwordMatch[1].length : 0);
console.log('[DEBUG] process.env.DATABASE_URL (masked):', process.env.DATABASE_URL ? (process.env.DATABASE_URL.substring(0, 30) + '***' + process.env.DATABASE_URL.substring(process.env.DATABASE_URL.length - 10)) : 'NOT SET');
console.log('[DEBUG] process.env.DIRECT_URL:', process.env.DIRECT_URL || 'UNSET');
\"
    " 2>&1 || true)
    log_info "Config test output:"
    echo "$config_test_output"
    
    # Now run the actual migration
    # CRITICAL FIX: Prisma CLI spawns child processes that may not inherit environment variables
    # The issue is that prisma.config.js reads process.env.DATABASE_URL at module load time
    # Solution: Use node to directly run Prisma with explicit env object (like scripts/run-prisma.js does)
    # This ensures DATABASE_URL is available to all child processes
    log_info "Running Prisma migration with explicit environment variable propagation..."
    
    # Unset DIRECT_URL for clean environment (both scripts now prioritize DATABASE_URL anyway)
    log_info "Running Prisma migration with DATABASE_URL set and DIRECT_URL unset..."
    
    # Escape the schema and config paths for use in the Node.js command
    local escaped_schema_path=$(printf '%s\n' "$schema_path" | sed "s/'/'\\\\''/g")
    local escaped_config_path=$(printf '%s\n' "$config_file_path" | sed "s/'/'\\\\''/g")
    
    # Run Prisma migration using the existing run-prisma.js script
    # This script already handles DATABASE_URL cleaning and environment variable passing correctly
    # It's the same script used by the container at startup (via Dockerfile CMD)
    # 
    # WHY THIS WORKS:
    # - In local-prod, container starts with DATABASE_URL in docker-compose environment section
    # - The container's CMD runs: node scripts/run-prisma.js migrate
    # - run-prisma.js reads DATABASE_URL from process.env and passes it to Prisma via execSync env
    # 
    # For production, we use the same approach but pass DATABASE_URL via docker exec -e
    # The run-prisma.js script will handle it the same way
    
    # Note: schema=public is already ensured above (before connection test and config test)
    # Use base64 encoding to avoid any shell escaping issues with special characters
    local encoded_url
    encoded_url=$(echo -n "$clean_database_url" | base64 -w0)
    
    # Run migration using yarn prisma:migrate (same as package.json script)
    # This runs: node scripts/run-prisma.js migrate
    # Use bash instead of sh for bash-specific syntax (${#var}, ${var:offset:length})
    migration_output=$(docker exec "${CONTAINER_PREFIX}api" bash -c "
        # Decode the DATABASE_URL from base64 to avoid shell escaping issues
        export DATABASE_URL=\$(echo '$encoded_url' | base64 -d)
        # CRITICAL: Unset DIRECT_URL completely - don't just set it to empty
        unset DIRECT_URL
        
        # Debug: Show what URL we're using (masked for security)
        echo '[DEBUG] DATABASE_URL set via base64 decode'
        echo '[DEBUG] URL length:' \${#DATABASE_URL}
        echo '[DEBUG] URL starts with:' \${DATABASE_URL:0:20}***
        echo '[DEBUG] URL contains @:' \${DATABASE_URL#*@}
        echo '[DEBUG] DIRECT_URL:' \${DIRECT_URL:-UNSET}
        
        # Extract and verify password from URL
        url_password=\$(echo \"\$DATABASE_URL\" | sed -n 's|.*://[^:]*:\\([^@]*\\)@.*|\\1|p' || echo '')
        echo '[DEBUG] Password extracted (first 2 chars):' \${url_password:0:2}***
        echo '[DEBUG] Password length:' \${#url_password}
        
        # Debug: Show full URL structure (masked)
        echo '[DEBUG] Full DATABASE_URL structure:'
        echo '[DEBUG]   Protocol: postgresql://'
        echo '[DEBUG]   Username: postgres'
        echo '[DEBUG]   Password: \${url_password:0:2}*** (length: \${#url_password})'
        echo '[DEBUG]   Host: postgres'
        echo '[DEBUG]   Port: 5432'
        echo '[DEBUG]   Database: userdb'
        echo '[DEBUG]   Has schema param:' \$([[ \"\$DATABASE_URL\" == *\"schema=\"* ]] && echo 'YES' || echo 'NO')
        if [[ \"\$DATABASE_URL\" == *\"schema=\"* ]]; then
            schema_value=\$(echo \"\$DATABASE_URL\" | sed -n 's|.*schema=\\([^&]*\\).*|\\1|p')
            echo '[DEBUG]   Schema value:' \$schema_value
        fi
        
        # Run Prisma migration using yarn script (same as package.json)
        cd /app && yarn prisma:migrate
    " 2>&1)
    migration_exit_code=$?
    
    # Always log the migration output for debugging
    log_info "=== Prisma Migration Output ==="
    echo "$migration_output"
    echo "$migration_output" > /tmp/migration.log 2>&1 || true
    log_info "=== End of Migration Output ==="
    
    if [[ $migration_exit_code -eq 0 ]]; then
        log_success "Migrations completed successfully"
        
        # Verify schema using base64 encoding to avoid shell escaping issues
        local config_file_path="/app/src/libs/infrastructure/database/prisma/prisma.config.js"
        if docker exec "${CONTAINER_PREFIX}api" sh -c "
            export DATABASE_URL=\$(echo '$encoded_url' | base64 -d)
            unset DIRECT_URL
            cd /app && npx prisma validate --schema '$schema_path' --config '$config_file_path'
        " 2>&1; then
            log_success "Schema validation passed"
            return 0
        else
            log_error "Schema validation failed after migration"
            if [[ -n "$PRE_MIGRATION_BACKUP" ]]; then
                log_warning "Rolling back to pre-migration backup..."
                restore_backup "$PRE_MIGRATION_BACKUP"
            fi
            return 1
        fi
    else
        log_error "Migration failed with exit code: $migration_exit_code"
        log_error "=== Prisma Migration Error Output (Full) ==="
        echo "$migration_output" >&2
        log_error "=== End of Migration Error Output ==="
        log_error "Full migration log saved to: /tmp/migration.log"
        
        # Check if this is the P3005 error (database not empty, needs baseline)
        if echo "$migration_output" | grep -q "P3005"; then
            log_warning "Detected P3005 error - database has existing schema but no migration history"
            log_info "Attempting automatic baseline of existing database..."
            
            # Find migration names from the migrations folder
            local migrations_found=$(docker exec "${CONTAINER_PREFIX}api" sh -c "
                ls -1 /app/src/libs/infrastructure/database/prisma/migrations/ 2>/dev/null | grep -E '^[0-9]+_' | sort
            " 2>/dev/null || echo "")
            
            if [[ -n "$migrations_found" ]]; then
                log_info "Found migrations to baseline: $migrations_found"
                
                # Baseline each migration
                local baseline_success=true
                for migration_name in $migrations_found; do
                    log_info "Baselining migration: $migration_name"
                    
                    if docker exec "${CONTAINER_PREFIX}api" bash -c "
                        export DATABASE_URL=\$(echo '$encoded_url' | base64 -d)
                        unset DIRECT_URL
                        cd /app && npx prisma migrate resolve --applied '$migration_name' \
                            --schema '/app/src/libs/infrastructure/database/prisma/schema.prisma'
                    " 2>&1; then
                        log_success "Baselined migration: $migration_name"
                    else
                        log_error "Failed to baseline migration: $migration_name"
                        baseline_success=false
                        break
                    fi
                done
                
                if $baseline_success; then
                    log_success "All migrations baselined successfully"
                    log_info "Retrying migration deploy..."
                    
                    # Retry migration
                    local retry_output
                    retry_output=$(docker exec "${CONTAINER_PREFIX}api" bash -c "
                        export DATABASE_URL=\$(echo '$encoded_url' | base64 -d)
                        unset DIRECT_URL
                        cd /app && yarn prisma:migrate
                    " 2>&1)
                    local retry_exit_code=$?
                    
                    if [[ $retry_exit_code -eq 0 ]]; then
                        log_success "Migration succeeded after baseline!"
                        return 0
                    else
                        log_error "Migration still failed after baseline"
                        echo "$retry_output" >&2
                    fi
                fi
            else
                log_warning "No migrations found in /app/src/libs/infrastructure/database/prisma/migrations/"
                log_info "Attempting manual baseline creation..."
                
                # Create _prisma_migrations table and mark init as applied
                if docker exec -i postgres psql -U postgres -d userdb << 'BASELINE_SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id VARCHAR(36) PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
SELECT 
    gen_random_uuid()::text,
    'baseline_auto_created',
    '20251111125405_init',
    NOW(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20251111125405_init'
);
BASELINE_SQL
                then
                    log_success "Database baselined via SQL"
                    log_info "Retrying migration deploy..."
                    
                    local retry_output
                    retry_output=$(docker exec "${CONTAINER_PREFIX}api" bash -c "
                        export DATABASE_URL=\$(echo '$encoded_url' | base64 -d)
                        unset DIRECT_URL
                        cd /app && yarn prisma:migrate
                    " 2>&1)
                    
                    if [[ $? -eq 0 ]]; then
                        log_success "Migration succeeded after SQL baseline!"
                        return 0
                    else
                        log_error "Migration still failed after SQL baseline"
                        echo "$retry_output" >&2
                    fi
                else
                    log_error "Failed to create baseline via SQL"
                fi
            fi
        fi
        
        # Check if container crashed during migration (exit code 137 = killed, often OOM)
        if [[ $migration_exit_code -eq 137 ]]; then
            log_error ""
            log_error "=========================================="
            log_error "CRITICAL: Container was killed during migration (exit code 137)"
            log_error "This typically indicates Out of Memory (OOM) condition"
            log_error "=========================================="
            
            # Check container status
            local container_status_after
            container_status_after=$(docker inspect "${CONTAINER_PREFIX}api" --format '{{.State.Status}}' 2>/dev/null || echo "unknown")
            local container_exit_code_after
            container_exit_code_after=$(docker inspect "${CONTAINER_PREFIX}api" --format '{{.State.ExitCode}}' 2>/dev/null || echo "0")
            
            log_error "Container status after migration failure: $container_status_after"
            log_error "Container exit code: $container_exit_code_after"
            
            # Check system memory if available
            if command -v free >/dev/null 2>&1; then
                log_error "System memory status:"
                free -h 2>/dev/null || true
            fi
            
            # Check container memory limits
            local mem_limit
            mem_limit=$(docker inspect "${CONTAINER_PREFIX}api" --format '{{.HostConfig.Memory}}' 2>/dev/null || echo "unknown")
            if [[ "$mem_limit" != "0" ]] && [[ "$mem_limit" != "unknown" ]]; then
                local mem_limit_mb=$((mem_limit / 1024 / 1024))
                log_error "Container memory limit: ${mem_limit_mb}MB"
            fi
            
            log_error ""
            log_error "RECOMMENDED ACTIONS:"
            log_error "1. Increase container memory limit in docker-compose.prod.yml"
            log_error "2. Check container logs: docker logs ${CONTAINER_PREFIX}api"
            log_error "3. Check system memory: free -h"
            log_error "4. Consider running migrations with lower memory footprint"
            log_error "5. Check if other containers are consuming too much memory"
            log_error ""
        fi
        
        # Check if DATABASE_URL was corrupted in the output
        if echo "$migration_output" | grep -q "FailedPrecondition\|container.*init process"; then
            log_error ""
            log_error "WARNING: Migration output contains container error messages"
            log_error "This suggests the container crashed or is in a bad state"
            log_error "The DATABASE_URL may have been corrupted during container failure"
            log_error "Check container logs: docker logs ${CONTAINER_PREFIX}api"
            log_error ""
        fi
        
        log_error "To debug, check the migration output above for Prisma errors"
        if [[ -n "$PRE_MIGRATION_BACKUP" ]]; then
            log_warning "Rolling back to pre-migration backup..."
            restore_backup "$PRE_MIGRATION_BACKUP" || {
                log_error "CRITICAL: Backup restore also failed - database may be in inconsistent state"
            }
        fi
        
        # CRITICAL: Always return error code to ensure deployment fails
        # This ensures CI/CD properly detects migration failures
        log_error ""
        log_error "=========================================="
        log_error "MIGRATION FAILED - Deployment will be marked as FAILED"
        log_error "=========================================="
        return 1
    fi
}

# Capture API container logs and env (DATABASE_URL redacted) to a file before rollback.
# After rollback the container is removed; this file persists for debugging.
capture_failed_deploy_diagnostics() {
    local api_container="${1:-${CONTAINER_PREFIX}api}"
    local out_dir="${BASE_DIR}/data"
    local out_file="${out_dir}/deploy-failure-api-diagnostics-$(date +%Y%m%d-%H%M%S).txt"
    mkdir -p "$out_dir"
    {
        echo "=== Failed deployment diagnostics (captured before rollback) ==="
        echo "Timestamp: $(date -Iseconds)"
        echo "API container: $api_container"
        echo ""
        if docker ps -a --format "{{.Names}}" | grep -q "^${api_container}$"; then
            echo "=== API container env (DATABASE_URL host only; password redacted) ==="
            docker exec "$api_container" env 2>/dev/null | grep -E '^DATABASE_URL=' | sed -E 's|://([^:]+):([^@]+)@|://\1:***@|' || echo "(could not read env)"
            echo ""
            echo "=== API container logs (last 250 lines) ==="
            docker logs --tail 250 "$api_container" 2>&1 || true
        else
            echo "API container not found (already removed?)."
        fi
        echo ""
        echo "=== End of diagnostics ==="
    } >> "$out_file" 2>&1
    log_info "Diagnostics saved to: $out_file (inspect after rollback with: cat $out_file)"
    # Also print to stdout so GitHub Actions captures it (container will be gone after rollback)
    if [[ -f "$out_file" ]]; then
        log_info "=== Failed deploy diagnostics (for CI log) ==="
        cat "$out_file" 2>/dev/null || true
    fi
}

# Rollback deployment
rollback_deployment() {
    log_warning "Initiating automatic rollback..."
    # Capture API logs and redacted DATABASE_URL before removing container
    capture_failed_deploy_diagnostics "${CONTAINER_PREFIX}api"
    
    # CRITICAL: First, restore the old Docker image if backup exists
    if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]]; then
        log_info "Restoring previous Docker image from backup: ${OLD_IMAGE_BACKUP_TAG}"
        
        # Use the backup image directly - it's already tagged and ready to use
        # The backup tag format is: image-name:rollback-backup-YYYYMMDD-HHMMSS
        # We can use it directly with docker-compose by setting DOCKER_IMAGE
        
        # Stop and remove current containers
        log_info "Stopping current containers..."
        local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
        if [[ -f "$compose_file" ]]; then
            cd "$(dirname "$compose_file")" || {
                log_error "Failed to change to compose directory"
                return 1
            }
        fi
        
        docker compose -f docker-compose.prod.yml --profile infrastructure --profile app stop api worker 2>&1 || true
        docker compose -f docker-compose.prod.yml --profile infrastructure --profile app rm -f api worker 2>&1 || true
        
        # Start containers with backup image
        log_info "Starting containers with backup image..."
        export DOCKER_IMAGE="$OLD_IMAGE_BACKUP_TAG"
        if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --no-deps api worker 2>&1; then
            log_success "Containers restarted with backup image"
            # Wait a moment for containers to start
            sleep 5
        else
            log_error "Failed to start containers with backup image"
            log_warning "This is a critical failure - containers may need manual intervention"
        fi
    else
        log_warning "No Docker image backup found - will only restore database"
    fi
    
    # Find last success backup
    local last_success_backup=$(find_last_backup "success")
    
    if [[ -n "$last_success_backup" ]]; then
        log_info "Rolling back to last success backup: ${last_success_backup}"
        if restore_backup "$last_success_backup"; then
            log_success "Rollback to success backup completed"
            return 0
        else
            log_error "Rollback to success backup failed"
            # Try pre-deployment backup as fallback
            rollback_to_pre_deployment
            return 1
        fi
    else
        log_warning "No success backup found - rolling back to pre-deployment backup"
        rollback_to_pre_deployment
    fi
}

# Rollback to pre-deployment backup
rollback_to_pre_deployment() {
    if [[ -n "$BACKUP_ID" ]]; then
        log_info "Rolling back to pre-deployment backup: ${BACKUP_ID}"
        if restore_backup "$BACKUP_ID"; then
            log_success "Rollback to pre-deployment backup completed"
            return 0
        else
            log_error "Rollback to pre-deployment backup failed"
            return 1
        fi
    else
        log_error "No pre-deployment backup available for rollback"
        return 1
    fi
}

# Validate deployment state and log warnings for unexpected combinations
validate_deployment_state() {
    # Warn about unexpected states
    if [[ "$INFRA_ALREADY_HANDLED" == "true" ]] && [[ "$INFRA_CHANGED" == "false" ]] && [[ "$INFRA_HEALTHY" == "true" ]]; then
        log_warning "Unexpected state: INFRA_ALREADY_HANDLED=true but no infra changes and infra is healthy"
    fi
    
    if [[ "$INFRA_CHANGED" == "false" ]] && [[ "$APP_CHANGED" == "false" ]]; then
        log_info "No changes detected - this may be a manual deployment or verification run"
    fi
    
    # Log deployment context
    if [[ "$INFRA_ALREADY_HANDLED" == "true" ]]; then
        log_info "CI/CD Mode: Infrastructure operations handled by GitHub Actions"
    else
        log_info "Standalone Mode: All operations handled by deploy.sh"
    fi
}

# Main deployment logic
main() {
    log_info "Starting deployment orchestrator..."
    log_info "Infra Changed: ${INFRA_CHANGED}, App Changed: ${APP_CHANGED}"
    log_info "Infra Healthy: ${INFRA_HEALTHY}, Infra Status: ${INFRA_STATUS}"
    log_info "Infra Already Handled: ${INFRA_ALREADY_HANDLED}"
    
    # Validate state
    validate_deployment_state
    
    check_docker || exit $EXIT_CRITICAL
    
    # Ensure directories exist before deployment
    log_info "Ensuring server directories exist..."
    if [[ -f "${SCRIPT_DIR}/setup-directories.sh" ]]; then
        "${SCRIPT_DIR}/setup-directories.sh" || {
            log_warning "Directory setup had issues, but continuing..."
        }
    else
        # Fallback: use ensure_directories from utils
        ensure_directories || {
            log_warning "Directory setup had issues, but continuing..."
        }
    fi
    
    # Always check infrastructure health first
    check_infrastructure_health || true
    
    # Decision logic
    if [[ "$INFRA_CHANGED" == "true" ]]; then
        # Infrastructure changed
        # CRITICAL: Skip recreation if infrastructure is healthy and already handled by CI/CD
        if [[ "$INFRA_ALREADY_HANDLED" == "true" ]] && [[ "$INFRA_HEALTHY" == "true" ]]; then
            log_info "Infrastructure changes were already handled by CI/CD and infrastructure is healthy"
            log_info "Skipping infrastructure recreation - proceeding directly to application deployment"
            
            # Verify infrastructure (should already be healthy from CI/CD jobs)
            local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
            
            if [[ -f "$verify_script" ]]; then
                "$verify_script" >/dev/null || {
                    log_error "Verification failed - infrastructure may not be ready"
                    exit $EXIT_CRITICAL
                }
            else
                log_warning "verify.sh not found - skipping verification"
            fi
            
            # Deploy application if changed
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            else
                log_info "No application changes detected - ensuring application containers are running..."
                local api_container="${CONTAINER_PREFIX}api"
                local worker_container="${CONTAINER_PREFIX}worker"
                
                if ! container_running "$api_container" || ! container_running "$worker_container"; then
                    log_info "Application containers not running - starting them..."
                    deploy_application || exit $EXIT_ERROR
                else
                    log_info "Application containers are already running - no action needed"
                fi
            fi
            
            exit $EXIT_SUCCESS
        elif [[ "$INFRA_ALREADY_HANDLED" == "true" ]]; then
            # Infrastructure operations were already done by CI/CD jobs
            # Just verify and deploy app
            log_info "Infrastructure changes were already handled by CI/CD - verifying and deploying app"
            
            # Verify infrastructure (should already be healthy from CI/CD jobs)
            local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
            
            if [[ -f "$verify_script" ]]; then
                "$verify_script" >/dev/null || {
                    log_error "Verification failed - infrastructure may not be ready"
                    exit $EXIT_CRITICAL
                }
            else
                log_warning "verify.sh not found - skipping verification"
            fi
            
            # Always ensure application containers are running (even if no changes)
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            else
                log_info "No application changes detected - ensuring application containers are running..."
                # Check if containers are running, start them if not
                local api_container="${CONTAINER_PREFIX}api"
                local worker_container="${CONTAINER_PREFIX}worker"
                
                if ! container_running "$api_container" || ! container_running "$worker_container"; then
                    log_info "Application containers not running - starting them..."
                    deploy_application || exit $EXIT_ERROR
                else
                    log_info "Application containers are already running - no action needed"
                fi
            fi
        else
            # Standalone mode - handle everything in deploy.sh
            log_info "Infrastructure changes detected - full deployment flow (standalone mode)"
        
        # CRITICAL: Always backup data before recreating containers (unless fresh deployment)
        if is_fresh_deployment; then
            log_info "Fresh deployment detected - skipping backup (no data to preserve)"
            BACKUP_ID=""
        else
            # CRITICAL: Backup PostgreSQL and Dragonfly data BEFORE any container operations
            log_info "Creating backup of PostgreSQL and Dragonfly data before infrastructure changes..."
            log_warning "This backup is CRITICAL - data will be lost if backup fails!"
            
            # Find backup.sh script (check multiple locations)
            local backup_script=""
            if [[ -f "${DEPLOY_SCRIPT_DIR}/backup.sh" ]]; then
                backup_script="${DEPLOY_SCRIPT_DIR}/backup.sh"
            elif [[ -f "${SCRIPT_DIR}/backup.sh" ]]; then
                backup_script="${SCRIPT_DIR}/backup.sh"
            elif [[ -f "/opt/healthcare-backend/devops/scripts/docker-infra/backup.sh" ]]; then
                backup_script="/opt/healthcare-backend/devops/scripts/docker-infra/backup.sh"
            fi
            
            if [[ -n "$backup_script" ]] && [[ -f "$backup_script" ]]; then
                log_info "Using backup script: ${backup_script}"
                
                # Ensure containers are running for backup (pull first so postgres:18 etc. from compose is used)
                docker compose -f docker-compose.prod.yml --profile infrastructure pull --quiet postgres dragonfly 2>/dev/null || true
                if ! container_running "${POSTGRES_CONTAINER}"; then
                    log_warning "PostgreSQL container not running - starting for backup..."
                    docker compose -f docker-compose.prod.yml --profile infrastructure up -d postgres || {
                        log_error "Failed to start PostgreSQL for backup"
                        exit $EXIT_CRITICAL
                    }
                    wait_for_health "${POSTGRES_CONTAINER}" 120 || {
                        log_error "PostgreSQL did not become healthy for backup"
                        exit $EXIT_CRITICAL
                    }
                fi
                
                if ! container_running "${DRAGONFLY_CONTAINER}"; then
                    log_warning "Dragonfly container not running - starting for backup..."
                    docker compose -f docker-compose.prod.yml --profile infrastructure up -d dragonfly || {
                        log_error "Failed to start Dragonfly for backup"
                        exit $EXIT_CRITICAL
                    }
                    wait_for_health "${DRAGONFLY_CONTAINER}" 60 || {
                        log_error "Dragonfly did not become healthy for backup"
                        exit $EXIT_CRITICAL
                    }
                fi
                
                # Create backup (pre-deployment type)
                BACKUP_ID=$("$backup_script" pre-deployment) || {
                    log_error "Backup failed - ABORTING deployment to prevent data loss"
                    exit $EXIT_CRITICAL
                }
                log_success "Backup created successfully (ID: ${BACKUP_ID})"
            else
                log_error "backup.sh not found in any expected location!"
                log_error "Checked: ${DEPLOY_SCRIPT_DIR}/backup.sh"
                log_error "Checked: ${SCRIPT_DIR}/backup.sh"
                log_error "Checked: /opt/healthcare-backend/devops/scripts/docker-infra/backup.sh"
                log_error "This would result in DATA LOSS - ABORTING"
                exit $EXIT_CRITICAL
            fi
        fi
        
        # Recreate infrastructure with retry
        local max_infra_retries=2
        local infra_attempt=0
        local infra_succeeded=false
        
        while [[ $infra_attempt -lt $max_infra_retries ]] && ! $infra_succeeded; do
            infra_attempt=$((infra_attempt + 1))
            log_info "Infrastructure deployment attempt $infra_attempt/$max_infra_retries..."
            
            if deploy_infrastructure; then
                infra_succeeded=true
                log_success "Infrastructure deployed successfully"
            else
                log_warning "Infrastructure deployment attempt $infra_attempt failed"
                if [[ $infra_attempt -lt $max_infra_retries ]]; then
                    log_info "Waiting before retry..."
                    sleep $((infra_attempt * 10))  # Exponential backoff: 10s, 20s
                fi
            fi
        done
        
        if ! $infra_succeeded; then
            log_error "Infrastructure deployment failed after $max_infra_retries attempts"
            exit $EXIT_CRITICAL
        fi
        
            # Restore backup only if we have one
            if [[ -n "$BACKUP_ID" ]] && [[ "$BACKUP_ID" != "" ]]; then
                log_info "Restoring backup: ${BACKUP_ID}"
                
                # Find restore.sh script
                local restore_script="${DEPLOY_SCRIPT_DIR}/restore.sh"
                [[ ! -f "$restore_script" ]] && restore_script="${SCRIPT_DIR}/restore.sh"
                [[ ! -f "$restore_script" ]] && restore_script="/opt/healthcare-backend/devops/scripts/docker-infra/restore.sh"
                
                if [[ -f "$restore_script" ]]; then
                    "$restore_script" "$BACKUP_ID" || {
                        log_error "Restore failed"
                        exit $EXIT_CRITICAL
                    }
                else
                    log_error "restore.sh not found - cannot restore backup!"
                    log_error "Checked: ${DEPLOY_SCRIPT_DIR}/restore.sh"
                    log_error "Checked: ${SCRIPT_DIR}/restore.sh"
                    log_error "Checked: /opt/healthcare-backend/devops/scripts/docker-infra/restore.sh"
                    exit $EXIT_CRITICAL
                fi
            fi
        
        # Verify infrastructure
        local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
        [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
        [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
        
        if [[ -f "$verify_script" ]]; then
            "$verify_script" >/dev/null || {
                log_error "Verification failed"
                exit $EXIT_CRITICAL
            }
        else
            log_warning "verify.sh not found - skipping verification"
        fi
        
        # Always ensure application containers are running (even if no changes)
        if [[ "$APP_CHANGED" == "true" ]]; then
            deploy_application || exit $EXIT_ERROR
        else
            log_info "No application changes detected - ensuring application containers are running..."
            # Check if containers are running, start them if not
            local api_container="${CONTAINER_PREFIX}api"
            local worker_container="${CONTAINER_PREFIX}worker"
            
            if ! container_running "$api_container" || ! container_running "$worker_container"; then
                log_info "Application containers not running - starting them..."
                deploy_application || exit $EXIT_ERROR
            else
                log_info "Application containers are already running - no action needed"
            fi
        fi
        fi  # End of INFRA_CHANGED=true else block (standalone mode)
        
    elif [[ "$INFRA_HEALTHY" != "true" ]] && [[ "$INFRA_CHANGED" != "true" ]]; then
        # Infrastructure unhealthy but not changed - only fix if needed, don't recreate
        if [[ "$INFRA_ALREADY_HANDLED" == "true" ]]; then
            # CI/CD already handled debug/recreate - just verify and deploy app
            log_info "Infrastructure was already handled by CI/CD - verifying and deploying app"
            
            # Verify infrastructure
            local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
            
            if [[ -f "$verify_script" ]]; then
                "$verify_script" >/dev/null || {
                    log_error "Verification failed - infrastructure may not be ready"
                    exit $EXIT_CRITICAL
                }
            else
                log_warning "verify.sh not found - skipping verification"
            fi
            
            # Deploy app if changed
            # Always ensure application containers are running (even if no changes)
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            else
                log_info "No application changes detected - ensuring application containers are running..."
                # Check if containers are running, start them if not
                local api_container="${CONTAINER_PREFIX}api"
                local worker_container="${CONTAINER_PREFIX}worker"
                
                if ! container_running "$api_container" || ! container_running "$worker_container"; then
                    log_info "Application containers not running - starting them..."
                    deploy_application || exit $EXIT_ERROR
                else
                    log_info "Application containers are already running - no action needed"
                fi
            fi
        else
            # Standalone mode - try to fix without recreating
            log_info "Infrastructure unhealthy - attempting auto-fix (without recreation)..."
        
            # Find diagnose.sh script
            local diagnose_script="${DEPLOY_SCRIPT_DIR}/diagnose.sh"
            [[ ! -f "$diagnose_script" ]] && diagnose_script="${SCRIPT_DIR}/diagnose.sh"
            [[ ! -f "$diagnose_script" ]] && diagnose_script="/opt/healthcare-backend/devops/scripts/docker-infra/diagnose.sh"
            
            if [[ ! -f "$diagnose_script" ]]; then
                log_warning "diagnose.sh not found - skipping auto-fix, will recreate infrastructure"
            elif "$diagnose_script" >/dev/null 2>&1; then
                log_success "Auto-fix succeeded"
                
                # Re-check infrastructure health after auto-fix
                check_infrastructure_health || true
                
                # Deploy app if changed
                if [[ "$APP_CHANGED" == "true" ]]; then
                    deploy_application || exit $EXIT_ERROR
                fi
                
                # Exit early if auto-fix succeeded
                exit $EXIT_SUCCESS
            else
                # Only recreate if this is NOT a fresh deployment (has existing data to preserve)
                if is_fresh_deployment; then
                    log_info "Fresh deployment - creating infrastructure from scratch"
                    BACKUP_ID=""
                else
                    log_warning "Auto-fix failed - recreating infrastructure (has existing data)"
                    
                    # CRITICAL: Backup existing data before recreating
                    log_info "Creating backup of PostgreSQL and Dragonfly data before infrastructure recreation..."
                    log_warning "This backup is CRITICAL - data will be lost if backup fails!"
                    
                    # Find backup.sh script (check multiple locations)
                    local backup_script=""
                    if [[ -f "${DEPLOY_SCRIPT_DIR}/backup.sh" ]]; then
                        backup_script="${DEPLOY_SCRIPT_DIR}/backup.sh"
                    elif [[ -f "${SCRIPT_DIR}/backup.sh" ]]; then
                        backup_script="${SCRIPT_DIR}/backup.sh"
                    elif [[ -f "/opt/healthcare-backend/devops/scripts/docker-infra/backup.sh" ]]; then
                        backup_script="/opt/healthcare-backend/devops/scripts/docker-infra/backup.sh"
                    fi
                    
                    if [[ -n "$backup_script" ]] && [[ -f "$backup_script" ]]; then
                        log_info "Using backup script: ${backup_script}"
                        
                        # Ensure containers are running for backup (pull first so postgres:18 etc. from compose is used)
                        docker compose -f docker-compose.prod.yml --profile infrastructure pull --quiet postgres dragonfly 2>/dev/null || true
                        if ! container_running "${POSTGRES_CONTAINER}"; then
                            log_warning "PostgreSQL container not running - starting for backup..."
                            docker compose -f docker-compose.prod.yml --profile infrastructure up -d postgres || {
                                log_error "Failed to start PostgreSQL for backup"
                                exit $EXIT_CRITICAL
                            }
                            wait_for_health "${POSTGRES_CONTAINER}" 120 || {
                                log_error "PostgreSQL did not become healthy for backup"
                                exit $EXIT_CRITICAL
                            }
                        fi
                        
                        if ! container_running "${DRAGONFLY_CONTAINER}"; then
                            log_warning "Dragonfly container not running - starting for backup..."
                            docker compose -f docker-compose.prod.yml --profile infrastructure up -d dragonfly || {
                                log_error "Failed to start Dragonfly for backup"
                                exit $EXIT_CRITICAL
                            }
                            wait_for_health "${DRAGONFLY_CONTAINER}" 60 || {
                                log_error "Dragonfly did not become healthy for backup"
                                exit $EXIT_CRITICAL
                            }
                        fi
                        
                        # Create backup (pre-deployment type)
                        BACKUP_ID=$("$backup_script" pre-deployment) || {
                            log_error "Backup failed - ABORTING deployment to prevent data loss"
                            exit $EXIT_CRITICAL
                        }
                        log_success "Backup created successfully (ID: ${BACKUP_ID})"
                    else
                        log_error "backup.sh not found in any expected location!"
                        log_error "Checked: ${DEPLOY_SCRIPT_DIR}/backup.sh"
                        log_error "Checked: ${SCRIPT_DIR}/backup.sh"
                        log_error "Checked: /opt/healthcare-backend/devops/scripts/docker-infra/backup.sh"
                        log_error "This would result in DATA LOSS - ABORTING"
                        exit $EXIT_CRITICAL
                    fi
                fi
                
                # Recreate infrastructure with retry logic
                local max_recreate_retries=2
                local recreate_attempt=0
                local recreate_succeeded=false
                
                while [[ $recreate_attempt -lt $max_recreate_retries ]] && ! $recreate_succeeded; do
                    recreate_attempt=$((recreate_attempt + 1))
                    log_info "Infrastructure recreation attempt $recreate_attempt/$max_recreate_retries..."
                    
                    if deploy_infrastructure; then
                        recreate_succeeded=true
                        log_success "Infrastructure recreated successfully"
                    else
                        log_warning "Infrastructure recreation attempt $recreate_attempt failed"
                        if [[ $recreate_attempt -lt $max_recreate_retries ]]; then
                            log_info "Waiting before retry..."
                            sleep $((recreate_attempt * 10))  # Exponential backoff: 10s, 20s
                        fi
                    fi
                done
                
                if ! $recreate_succeeded; then
                    log_error "Failed to recreate infrastructure after $max_recreate_retries attempts"
                    exit $EXIT_CRITICAL
                fi
                
                # Restore backup only if we have one
                if [[ -n "$BACKUP_ID" ]] && [[ "$BACKUP_ID" != "" ]]; then
                    local restore_script="${DEPLOY_SCRIPT_DIR}/restore.sh"
                    [[ ! -f "$restore_script" ]] && restore_script="${SCRIPT_DIR}/restore.sh"
                    [[ ! -f "$restore_script" ]] && restore_script="/opt/healthcare-backend/devops/scripts/docker-infra/restore.sh"
                    
                    if [[ -f "$restore_script" ]]; then
                        "$restore_script" "$BACKUP_ID" || {
                            log_error "Restore failed - but infrastructure is recreated, continuing..."
                            # Don't exit - infrastructure is recreated, we can continue
                        }
                    else
                        log_warning "restore.sh not found - cannot restore backup, but infrastructure is recreated"
                    fi
                fi
                
                # Verify infrastructure health after recreation
                log_info "Verifying infrastructure health after recreation..."
                local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
                [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
                [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
                
                if [[ -f "$verify_script" ]]; then
                    local verify_retries=3
                    local verify_attempt=0
                    local verify_succeeded=false
                    
                    while [[ $verify_attempt -lt $verify_retries ]] && ! $verify_succeeded; do
                        verify_attempt=$((verify_attempt + 1))
                        log_info "Verification attempt $verify_attempt/$verify_retries..."
                        
                        if "$verify_script" >/dev/null 2>&1; then
                            verify_succeeded=true
                            log_success "Infrastructure verification passed"
                        else
                            log_warning "Verification attempt $verify_attempt failed"
                            if [[ $verify_attempt -lt $verify_retries ]]; then
                                log_info "Waiting for infrastructure to stabilize..."
                                sleep $((verify_attempt * 15))  # Wait 15s, 30s
                            fi
                        fi
                    done
                    
                    if ! $verify_succeeded; then
                        log_warning "Infrastructure verification failed after $verify_retries attempts, but continuing..."
                        # Don't exit - infrastructure is recreated, we can try to continue
                    fi
                else
                    log_warning "verify.sh not found - skipping verification"
                fi
                
                # Deploy app if changed
        # Always ensure application containers are running (even if no changes)
                if [[ "$APP_CHANGED" == "true" ]]; then
                    deploy_application || exit $EXIT_ERROR
                else
            log_info "No application changes detected - ensuring application containers are running..."
            # Check if containers are running, start them if not
            local api_container="${CONTAINER_PREFIX}api"
            local worker_container="${CONTAINER_PREFIX}worker"
            
            if ! container_running "$api_container" || ! container_running "$worker_container"; then
                log_info "Application containers not running - starting them..."
                deploy_application || exit $EXIT_ERROR
            else
                log_info "Application containers are already running - no action needed"
            fi
                fi
            fi
        fi
    else
        # Infrastructure is healthy and unchanged
        # Handle all sub-scenarios:
        # 1. App changed - deploy app only
        # 2. App unchanged - verify and exit (no-op deployment)
        # 3. Both unchanged - verify and exit gracefully
        
        if [[ "$APP_CHANGED" == "true" ]]; then
            log_info "Infrastructure is healthy - deploying application only"
            deploy_application || exit $EXIT_ERROR
        else
            log_info "No changes detected - but checking if image update is needed..."
            
            # CRITICAL: Even if no code changes, we should check if the :latest image in registry is newer
            # This handles cases where the image was updated but change detection didn't catch it
            local api_container="${CONTAINER_PREFIX}api"
            local worker_container="${CONTAINER_PREFIX}worker"
            
            if ! container_running "$api_container" || ! container_running "$worker_container"; then
                log_info "Application containers not running - starting them..."
                deploy_application || exit $EXIT_ERROR
            else
                # Containers are running, but check if we need to update the image
                # For :latest tag, always check if registry has newer image
                local image_tag=$(echo "${DOCKER_IMAGE:-}" | cut -d: -f2 || echo "latest")
                if [[ "$image_tag" == "latest" ]] || [[ -z "${DOCKER_IMAGE:-}" ]]; then
                    log_info "Using :latest tag - forcing image update to ensure latest version is deployed..."
                    log_info "This ensures we always use the absolute latest image from registry"
                    deploy_application || exit $EXIT_ERROR
                else
                    log_info "Application containers are already running with specific tag - no action needed"
                fi
            fi
            
            # Still verify infrastructure health even if no changes
            local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
            [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
            
            if [[ -f "$verify_script" ]]; then
                "$verify_script" >/dev/null || {
                    log_warning "Verification found issues, but no changes to deploy"
                    # Don't exit with error for no-op deployments - just warn
                }
            fi
            
            log_success "No changes to deploy - system verified"
            exit $EXIT_SUCCESS
        fi
    fi
    
    # Final verification (only if we did something)
    if [[ "$APP_CHANGED" == "true" ]] || [[ "$INFRA_CHANGED" == "true" ]] || [[ "$INFRA_HEALTHY" != "true" ]]; then
        local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
        [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
        [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
        
        if [[ -f "$verify_script" ]]; then
            log_info "Performing final verification..."
            "$verify_script" >/dev/null || {
                log_error "Final verification failed"
                exit $EXIT_ERROR
            }
        else
            log_warning "verify.sh not found - skipping final verification"
        fi
    fi
    
    log_success "Deployment completed successfully"
    exit $EXIT_SUCCESS
}

# Show usage/help
show_usage() {
    cat << EOF
Healthcare Backend Deployment Script

Usage: ./deploy.sh [COMMAND] [OPTIONS]

Commands:
  (default)         Run full deployment based on INFRA_CHANGED and APP_CHANGED env vars
  verify-image      Verify and ensure latest image is deployed (with auto-recovery)
  check-image       Quick image status check (non-destructive, just reports status)
  post-verify       Run post-deployment verification only
  help              Show this help message

Options:
  Environment variables:
    DOCKER_IMAGE     Image to deploy (default: ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:latest)
    IMAGE            Base image name (combined with IMAGE_TAG to form DOCKER_IMAGE)
    IMAGE_TAG        Image tag (combined with IMAGE to form DOCKER_IMAGE)
    INFRA_CHANGED    Set to 'true' if infrastructure changed
    APP_CHANGED      Set to 'true' if application changed
    CONTAINER_PREFIX Container name prefix (default: latest-)
    OPENVIDU_URL     OpenVidu server URL (required for video features)

Examples:
  # Full deployment
  ./deploy.sh
  
  # Verify and deploy latest image (can be run as a scheduled job)
  ./deploy.sh verify-image
  
  # Quick check of current deployment status
  ./deploy.sh check-image
  
  # Run post-deployment verification only
  ./deploy.sh post-verify
  
  # Deploy specific image
  DOCKER_IMAGE=ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:main-abc123 ./deploy.sh

EOF
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Parse command-line arguments
    case "${1:-}" in
        verify-image)
            verify_and_deploy_latest_image
            exit $?
            ;;
        check-image)
            check_image_status
            exit $?
            ;;
        post-verify)
            post_deployment_verification
            exit $?
            ;;
        help|--help|-h)
            show_usage
            exit 0
            ;;
        *)
            # Run main deployment function
            # NOTE: main() calls exit() directly, so this line will only execute if main() returns
            # All error paths in main() use exit $EXIT_ERROR, so failures are properly detected by CI/CD
            main "$@"
            # If we reach here, main() returned successfully (shouldn't happen as main() exits)
            # But just in case, exit with success code
            exit $EXIT_SUCCESS
            ;;
    esac
fi
