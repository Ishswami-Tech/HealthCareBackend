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
APP_CHANGED="${APP_CHANGED:-false}"
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
    
    # Recreate infrastructure (volumes are preserved by docker compose)
    # Using --force-recreate to ensure containers are recreated, but volumes persist
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
    
    # CRITICAL: Create backup BEFORE removing containers
    # This ensures all data is safely backed up before any container operations
    log_info "Creating pre-deployment backup before container removal..."
    local backup_script="${DEPLOY_SCRIPT_DIR}/backup.sh"
    [[ ! -f "$backup_script" ]] && backup_script="${SCRIPT_DIR}/backup.sh"
    [[ ! -f "$backup_script" ]] && backup_script="${BASE_DIR}/devops/scripts/docker-infra/backup.sh"
    
    local PRE_DEPLOYMENT_BACKUP=""
    if [[ -f "$backup_script" ]]; then
        log_info "Running backup script: ${backup_script}"
        PRE_DEPLOYMENT_BACKUP=$("$backup_script" "pre-deployment") || {
            log_error "Pre-deployment backup failed - ABORTING to prevent data loss"
            log_error "Please fix backup issues before deploying"
            return 1
        }
        if [[ -n "$PRE_DEPLOYMENT_BACKUP" ]]; then
            log_success "Pre-deployment backup created: ${PRE_DEPLOYMENT_BACKUP}"
        else
            log_warning "Backup script returned empty backup ID, but continuing..."
        fi
    else
        log_warning "Backup script not found at ${backup_script} - proceeding without backup"
        log_warning "This is risky - ensure you have recent backups before continuing"
    fi
    
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
    
    # CRITICAL: Use docker pull directly to force update, then docker compose will use the fresh image
    log_info "Pulling image directly with docker pull to ensure latest version..."
    log_info "Attempting to pull: ${DOCKER_IMAGE}"
    
    local pull_success=false
    if docker pull "${DOCKER_IMAGE}" 2>&1; then
        log_success "Successfully pulled image: ${DOCKER_IMAGE}"
        pull_success=true
        
        # Verify the image was actually pulled (not using cached version)
        local pulled_image_id=$(docker images --format "{{.ID}}" "${DOCKER_IMAGE}" | head -n 1)
        log_info "Pulled image ID: ${pulled_image_id:0:12}"
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
        
        if docker pull "${DOCKER_IMAGE}" 2>&1; then
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
    
    # CRITICAL: Stop and remove old containers to ensure new image is used
    # NOTE: Only stopping/removing api and worker containers, NOT infrastructure containers (postgres, dragonfly, etc.)
    # Backup already created above, so it's safe to stop and remove containers
    log_info "Stopping old API/Worker containers (infrastructure containers are NOT affected)..."
    docker compose -f docker-compose.prod.yml --profile infrastructure --profile app stop api worker 2>&1 || true
    
    log_info "Removing old API/Worker containers..."
    docker compose -f docker-compose.prod.yml --profile infrastructure --profile app rm -f api worker 2>&1 || true
    
    # CRITICAL: Also use docker stop/rm directly as fallback to ensure containers are fully stopped
    # This handles cases where docker compose might not fully stop containers
    local api_container="${CONTAINER_PREFIX}api"
    local worker_container="${CONTAINER_PREFIX}worker"
    
    if container_running "$api_container"; then
        log_info "Force stopping API container: $api_container"
        docker stop "$api_container" 2>&1 || true
        docker rm -f "$api_container" 2>&1 || true
    fi
    
    if container_running "$worker_container"; then
        log_info "Force stopping Worker container: $worker_container"
        docker stop "$worker_container" 2>&1 || true
        docker rm -f "$worker_container" 2>&1 || true
    fi
    
    # Verify containers are actually stopped/removed
    if container_running "$api_container" || container_running "$worker_container"; then
        log_warning "Containers still running after stop/remove - forcing removal..."
        docker kill "$api_container" "$worker_container" 2>&1 || true
        docker rm -f "$api_container" "$worker_container" 2>&1 || true
    fi
    
    log_success "Old containers stopped and removed"
    
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
    if ! run_migrations_safely; then
        log_error "Database migrations failed - aborting deployment"
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
                log_error "   Attempting to force recreate..."
                docker compose -f docker-compose.prod.yml --profile infrastructure --profile app stop api 2>&1 || true
                docker compose -f docker-compose.prod.yml --profile infrastructure --profile app rm -f api 2>&1 || true
                docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps api 2>&1 || {
                    log_error "Failed to force recreate API container"
                    return 1
                }
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
                log_error "   Attempting to force recreate..."
                docker compose -f docker-compose.prod.yml --profile infrastructure --profile app stop worker 2>&1 || true
                docker compose -f docker-compose.prod.yml --profile infrastructure --profile app rm -f worker 2>&1 || true
                docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --pull always --force-recreate --no-deps worker 2>&1 || {
                    log_error "Failed to force recreate Worker container"
                    return 1
                }
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
        
        # Wait for health (4 minutes with 30 second intervals - API takes time to start)
        if wait_for_health "${CONTAINER_PREFIX}api" 240 30; then
            # CRITICAL: Only remove old backup images AFTER successful deployment
            # This ensures we can rollback if deployment fails
            log_info "Deployment successful - cleaning up old backup images..."
            local image_name_base=$(echo "${DOCKER_IMAGE}" | cut -d: -f1)
            if [[ -n "${OLD_IMAGE_BACKUP_TAG:-}" ]] && [[ -n "${image_name_base}" ]]; then
                # Keep the most recent backup, remove older ones
                docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}" | grep "rollback-backup" | while read -r backup_img; do
                    if [[ -n "$backup_img" ]] && [[ "$backup_img" != "$OLD_IMAGE_BACKUP_TAG" ]]; then
                        log_info "Removing old backup image: ${backup_img}"
                        docker rmi "$backup_img" 2>&1 || true
                    fi
                done || true
                log_info "Kept most recent backup image: ${OLD_IMAGE_BACKUP_TAG}"
            fi
            
            # Also remove old images that are not the current one and not backups
            log_info "Removing old non-backup images..."
            local current_running_image=$(docker inspect --format='{{.Config.Image}}' "${CONTAINER_PREFIX}api" 2>/dev/null || echo "")
            if [[ -n "${image_name_base}" ]]; then
                docker images "${image_name_base}" --format "{{.Repository}}:{{.Tag}}" | while read -r img; do
                    if [[ -n "$img" ]] && \
                       [[ "$img" == *"healthcare-api"* ]] && \
                       [[ "$img" != *"rollback-backup"* ]] && \
                       [[ "$img" != "$current_running_image" ]] && \
                       [[ "$img" != "${DOCKER_IMAGE}" ]]; then
                        log_info "Removing old image: ${img}"
                        docker rmi "$img" 2>&1 || true
                    fi
                done || true
            fi
            
            # Create success backup after successful deployment
            log_info "Creating success backup after successful deployment..."
            local backup_script="${DEPLOY_SCRIPT_DIR}/backup.sh"
            [[ ! -f "$backup_script" ]] && backup_script="${SCRIPT_DIR}/backup.sh"
            [[ ! -f "$backup_script" ]] && backup_script="${BASE_DIR}/devops/scripts/docker-infra/backup.sh"
            
            if [[ -f "$backup_script" ]]; then
                SUCCESS_BACKUP_ID=$("$backup_script" "success") || {
                    log_warning "Success backup failed (deployment still succeeded)"
                }
                if [[ -n "$SUCCESS_BACKUP_ID" ]]; then
                    log_success "Success backup created: ${SUCCESS_BACKUP_ID}"
                fi
            fi
            
            log_success "Application deployed successfully"
            return 0
        else
            log_error "Application health check failed"
            log_info "=== API Container Logs (last 100 lines) ==="
            docker logs --tail 100 "$api_container" 2>&1 || true
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
        docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d --no-deps api || {
            log_error "Failed to start API container for migrations"
            return 1
        }
        log_info "Waiting for API container to initialize..."
        sleep 10  # Give container time to load environment variables
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
    
    # Get DATABASE_URL from container environment (it should be set by docker-compose)
    local database_url
    database_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>/dev/null || echo "")
    
    # If DATABASE_URL is not in container, try to get it from docker-compose or use default
    if [[ -z "$database_url" ]]; then
        log_warning "DATABASE_URL not found in container environment, using default..."
        database_url="postgresql://postgres:postgres@postgres:5432/userdb?connection_limit=60&pool_timeout=60&statement_timeout=60000&idle_in_transaction_session_timeout=60000&connect_timeout=60&pool_size=30&max_connections=60"
    fi
    
    # Always run password fix script first to ensure PostgreSQL password matches DATABASE_URL
    log_info "Ensuring database password matches DATABASE_URL..."
    if [[ -f "${SCRIPT_DIR}/fix-database-password.sh" ]]; then
        if "${SCRIPT_DIR}/fix-database-password.sh"; then
            log_success "Database password verified/fixed"
            # Get updated DATABASE_URL from container after fix
            database_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>/dev/null || echo "$database_url")
        else
            log_warning "Password fix script had issues, but continuing..."
        fi
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
        
        log_error "To debug, check the migration output above for Prisma errors"
        if [[ -n "$PRE_MIGRATION_BACKUP" ]]; then
            log_warning "Rolling back to pre-migration backup..."
            restore_backup "$PRE_MIGRATION_BACKUP"
        fi
        return 1
    fi
}

# Rollback deployment
rollback_deployment() {
    log_warning "Initiating automatic rollback..."
    
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
        if [[ "$INFRA_ALREADY_HANDLED" == "true" ]]; then
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
                
                # Ensure containers are running for backup
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
                        
                        # Ensure containers are running for backup
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
            log_info "No changes detected - ensuring application containers are running..."
            
            # Always check if application containers are running, start them if not
            local api_container="${CONTAINER_PREFIX}api"
            local worker_container="${CONTAINER_PREFIX}worker"
            
            if ! container_running "$api_container" || ! container_running "$worker_container"; then
                log_info "Application containers not running - starting them..."
                deploy_application || exit $EXIT_ERROR
            else
                log_info "Application containers are already running"
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

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
