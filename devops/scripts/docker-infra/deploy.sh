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
        
        # Wait for health (using fixed container names)
        wait_for_health "${POSTGRES_CONTAINER}" 300 || {
            log_error "PostgreSQL did not become healthy"
            return 1
        }
        wait_for_health "${DRAGONFLY_CONTAINER}" 300 || {
            log_error "Dragonfly did not become healthy"
            return 1
        }
        
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
    
    # Zero-downtime deployment
    # Start new containers with different names
    local api_new="${CONTAINER_PREFIX}api-new"
    local worker_new="${CONTAINER_PREFIX}worker-new"
    
    # Security: Validate container names
    if ! validate_container_name "$api_new"; then
        log_error "Invalid API container name: ${api_new}"
        return 1
    fi
    if ! validate_container_name "$worker_new"; then
        log_error "Invalid worker container name: ${worker_new}"
        return 1
    fi
    
    # Pull latest images
    docker compose -f docker-compose.prod.yml pull api worker || return 1
    
    # Start new containers
    if docker compose -f docker-compose.prod.yml --profile app up -d --no-deps api worker; then
        # Wait for health
        wait_for_health "${CONTAINER_PREFIX}api" 120 || return 1
        
        # Stop old containers (they will be replaced)
        log_success "Application deployed"
        return 0
    else
        log_error "Application deployment failed"
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
            
            # Deploy application if changed
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            else
                log_info "No application changes - infrastructure verified successfully"
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
                
                # Create backup
                BACKUP_ID=$("$backup_script") || {
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
        
        # Recreate infrastructure
        deploy_infrastructure || {
            log_error "Infrastructure deployment failed"
            exit $EXIT_CRITICAL
        }
        
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
        
        # Deploy application if changed
        if [[ "$APP_CHANGED" == "true" ]]; then
            deploy_application || exit $EXIT_ERROR
        else
            log_info "No application changes - infrastructure deployment completed"
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
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            else
                log_info "No application changes - infrastructure verified successfully"
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
                        
                        # Create backup
                        BACKUP_ID=$("$backup_script") || {
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
                
                # Recreate infrastructure
                deploy_infrastructure || exit $EXIT_CRITICAL
                
                # Restore backup only if we have one
                if [[ -n "$BACKUP_ID" ]] && [[ "$BACKUP_ID" != "" ]]; then
                    local restore_script="${DEPLOY_SCRIPT_DIR}/restore.sh"
                    [[ ! -f "$restore_script" ]] && restore_script="${SCRIPT_DIR}/restore.sh"
                    [[ ! -f "$restore_script" ]] && restore_script="/opt/healthcare-backend/devops/scripts/docker-infra/restore.sh"
                    
                    if [[ -f "$restore_script" ]]; then
                        "$restore_script" "$BACKUP_ID" || exit $EXIT_CRITICAL
                    else
                        log_error "restore.sh not found - cannot restore backup!"
                        exit $EXIT_CRITICAL
                    fi
                fi
                
                # Verify
                local verify_script="${DEPLOY_SCRIPT_DIR}/verify.sh"
                [[ ! -f "$verify_script" ]] && verify_script="${SCRIPT_DIR}/verify.sh"
                [[ ! -f "$verify_script" ]] && verify_script="/opt/healthcare-backend/devops/scripts/docker-infra/verify.sh"
                
                if [[ -f "$verify_script" ]]; then
                    "$verify_script" >/dev/null || exit $EXIT_CRITICAL
                else
                    log_warning "verify.sh not found - skipping verification"
                fi
                
                # Deploy app if changed
                if [[ "$APP_CHANGED" == "true" ]]; then
                    deploy_application || exit $EXIT_ERROR
                else
                    log_info "No application changes - infrastructure recreated successfully"
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
            log_info "No changes detected - performing verification only"
            
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
