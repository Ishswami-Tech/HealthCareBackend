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
    
    local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
    
    if [[ ! -f "$compose_file" ]]; then
        log_error "Docker compose file not found: ${compose_file}"
        return 1
    fi
    
    cd "$(dirname "$compose_file")" || return 1
    
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
    
    # Pull latest images
    # Note: We need to include infrastructure profile to resolve dependencies (coturn)
    # but we only pull the app service images
    log_info "Pulling latest images for api and worker..."
    if ! docker compose -f docker-compose.prod.yml --profile infrastructure --profile app pull api worker 2>&1; then
        log_error "Failed to pull images for api and worker"
        if [[ -z "${GITHUB_TOKEN:-}" ]]; then
            log_error "No GITHUB_TOKEN provided - cannot authenticate with GHCR"
            log_error "Either provide GITHUB_TOKEN and GITHUB_USERNAME, or make the package public in GitHub"
        fi
        return 1
    fi
    log_success "Images pulled successfully"
    
    # Run database migrations safely
    if ! run_migrations_safely; then
        log_error "Database migrations failed - aborting deployment"
        return 1
    fi
    
    # Start new containers
    # Note: We include infrastructure profile to resolve dependencies (coturn, postgres, dragonfly)
    # Remove --no-deps to ensure dependencies are started (worker depends on api)
    log_info "Starting application containers (api, worker)..."
    if docker compose -f docker-compose.prod.yml --profile infrastructure --profile app up -d api worker 2>&1 | tee /tmp/docker-compose-up.log; then
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
        
        # Wait for health
        if wait_for_health "${CONTAINER_PREFIX}api" 120; then
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
    
    # Verify database connection before running migrations
    log_info "Verifying database connection..."
    # Extract password from DATABASE_URL for testing
    local db_password=$(echo "$database_url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' || echo "postgres")
    if ! docker exec -e PGPASSWORD="$db_password" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
        log_error "Database connection test failed!"
        log_error "Expected DATABASE_URL: ${database_url:0:50}***"
        log_error "Please verify:"
        log_error "  1. PostgreSQL container is running and healthy"
        log_error "  2. Password in DATABASE_URL matches POSTGRES_PASSWORD in docker-compose"
        log_error "  3. .env.production file doesn't override DATABASE_URL with wrong password"
        log_error ""
        log_info "Attempting to fix database password mismatch..."
        if [[ -f "${SCRIPT_DIR}/fix-database-password.sh" ]]; then
            if "${SCRIPT_DIR}/fix-database-password.sh"; then
                log_success "Database password fixed, retrying connection..."
                # Get updated DATABASE_URL from container or use the one we just fixed
                database_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>/dev/null || echo "$database_url")
                # Re-extract password after fix
                db_password=$(echo "$database_url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' || echo "postgres")
                # Verify again
                if ! docker exec -e PGPASSWORD="$db_password" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
                    log_error "Database connection still failing after password fix"
                    return 1
                fi
                log_success "Database connection verified after password fix"
            else
                log_error "Failed to fix database password - manual intervention required"
                return 1
            fi
        else
            log_error "fix-database-password.sh not found - cannot auto-fix"
            return 1
        fi
    else
        log_success "Database connection verified"
    fi
    
    # Run migrations with DATABASE_URL explicitly set
    log_info "Running Prisma migrations with schema: $schema_path"
    log_info "Using DATABASE_URL: ${database_url:0:40}***"
    
    # Prisma needs DATABASE_URL in the environment. Since the container should already have it,
    # we'll verify it's set, and if not, we'll set it explicitly.
    # First, check if DATABASE_URL is already in the container
    local container_has_db_url
    container_has_db_url=$(docker exec "${CONTAINER_PREFIX}api" printenv DATABASE_URL 2>/dev/null || echo "")
    
    if [[ -z "$container_has_db_url" ]] || [[ "$container_has_db_url" != "$database_url" ]]; then
        log_info "Setting DATABASE_URL in container environment..."
        # Create a temporary .env file in the container with DATABASE_URL
        docker exec "${CONTAINER_PREFIX}api" sh -c "echo 'DATABASE_URL=$database_url' > /tmp/.env.prisma && cat /tmp/.env.prisma" >/dev/null 2>&1 || true
    fi
    
    # Run migrations - Prisma will read DATABASE_URL from environment or .env file
    if docker exec -e DATABASE_URL="$database_url" "${CONTAINER_PREFIX}api" sh -c "cd /app && npx prisma migrate deploy --schema '$schema_path'" 2>&1 | tee /tmp/migration.log; then
        log_success "Migrations completed successfully"
        
        # Verify schema (DATABASE_URL should still be available from previous exec)
        if docker exec -e DATABASE_URL="$database_url" "${CONTAINER_PREFIX}api" sh -c "cd /app && npx prisma validate --schema '$schema_path'" 2>&1; then
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
        log_error "Migration failed"
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
