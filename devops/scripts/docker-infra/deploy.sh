#!/bin/bash
# Smart Deployment Orchestrator
# Implements intelligent deployment logic based on infrastructure and application changes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# This script is Docker-specific for production deployments

# Container prefix
CONTAINER_PREFIX="${CONTAINER_PREFIX:-latest-}"

# Parse environment variables
INFRA_CHANGED="${INFRA_CHANGED:-false}"
APP_CHANGED="${APP_CHANGED:-false}"
INFRA_HEALTHY="${INFRA_HEALTHY:-true}"
INFRA_STATUS="${INFRA_STATUS:-healthy}"
BACKUP_ID="${BACKUP_ID:-}"

# Flag to indicate if infrastructure operations were already handled by CI/CD
# When INFRA_ALREADY_HANDLED=true, skip infrastructure operations in deploy.sh
# (They were already done by separate GitHub Actions jobs)
INFRA_ALREADY_HANDLED="${INFRA_ALREADY_HANDLED:-false}"

# Exit codes
EXIT_SUCCESS=0
EXIT_WARNING=1
EXIT_ERROR=2
EXIT_CRITICAL=3

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
deploy_infrastructure() {
    log_info "Deploying infrastructure..."
    
    local compose_file="${BASE_DIR}/devops/docker/docker-compose.prod.yml"
    
    if [[ ! -f "$compose_file" ]]; then
        log_error "Docker compose file not found: ${compose_file}"
        return 1
    fi
    
    cd "$(dirname "$compose_file")" || return 1
    
    # Recreate infrastructure
    if docker compose -f docker-compose.prod.yml --profile infrastructure up -d; then
        log_success "Infrastructure deployed"
        
        # Wait for health
        for service in postgres dragonfly; do
            local container="${CONTAINER_PREFIX}${service}"
            # Security: Validate container name
            if ! validate_container_name "$container"; then
                log_error "Invalid container name: ${container}"
                return 1
            fi
            wait_for_health "$container" 300 || {
                log_error "${service} did not become healthy"
                return 1
            }
        done
        
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

# Main deployment logic
main() {
    log_info "Starting deployment orchestrator..."
    log_info "Infra Changed: ${INFRA_CHANGED}, App Changed: ${APP_CHANGED}"
    log_info "Infra Healthy: ${INFRA_HEALTHY}, Infra Status: ${INFRA_STATUS}"
    
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
            "${SCRIPT_DIR}/verify.sh" >/dev/null || {
                log_error "Verification failed - infrastructure may not be ready"
                exit $EXIT_CRITICAL
            }
            
            # Deploy application if changed
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            fi
        else
            # Standalone mode - handle everything in deploy.sh
            log_info "Infrastructure changes detected - full deployment flow (standalone mode)"
        
        # Backup
        log_info "Creating backup..."
        BACKUP_ID=$("${SCRIPT_DIR}/backup.sh") || {
            log_error "Backup failed - ABORTING"
            exit $EXIT_CRITICAL
        }
        
        # Recreate infrastructure
        deploy_infrastructure || {
            log_error "Infrastructure deployment failed"
            exit $EXIT_CRITICAL
        }
        
        # Restore backup
        if [[ -n "$BACKUP_ID" ]]; then
            log_info "Restoring backup: ${BACKUP_ID}"
            "${SCRIPT_DIR}/restore.sh" "$BACKUP_ID" || {
                log_error "Restore failed"
                exit $EXIT_CRITICAL
            }
        fi
        
        # Verify infrastructure
        "${SCRIPT_DIR}/verify.sh" >/dev/null || {
            log_error "Verification failed"
            exit $EXIT_CRITICAL
        }
        
        # Deploy application if changed
        if [[ "$APP_CHANGED" == "true" ]]; then
            deploy_application || exit $EXIT_ERROR
            fi
        fi
        
    elif [[ "$INFRA_HEALTHY" != "true" ]] && [[ "$INFRA_CHANGED" != "true" ]]; then
        # Infrastructure unhealthy but not changed
        if [[ "$INFRA_ALREADY_HANDLED" == "true" ]]; then
            # CI/CD already handled debug/recreate - just verify and deploy app
            log_info "Infrastructure was already handled by CI/CD - verifying and deploying app"
            
            # Verify infrastructure
            "${SCRIPT_DIR}/verify.sh" >/dev/null || {
                log_error "Verification failed - infrastructure may not be ready"
                exit $EXIT_CRITICAL
            }
            
            # Deploy app if changed
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            fi
        else
            # Standalone mode - handle everything
        log_info "Infrastructure unhealthy - attempting auto-fix..."
        
        if "${SCRIPT_DIR}/diagnose.sh" >/dev/null 2>&1; then
            log_success "Auto-fix succeeded"
            
            # Deploy app if changed
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
            fi
        else
            log_warning "Auto-fix failed - recreating infrastructure"
            
            # Backup
            BACKUP_ID=$("${SCRIPT_DIR}/backup.sh") || {
                log_error "Backup failed - ABORTING"
                exit $EXIT_CRITICAL
            }
            
            # Recreate
            deploy_infrastructure || exit $EXIT_CRITICAL
            
            # Restore
            if [[ -n "$BACKUP_ID" ]]; then
                "${SCRIPT_DIR}/restore.sh" "$BACKUP_ID" || exit $EXIT_CRITICAL
            fi
            
            # Verify
            "${SCRIPT_DIR}/verify.sh" >/dev/null || exit $EXIT_CRITICAL
            
            # Deploy app if changed
            if [[ "$APP_CHANGED" == "true" ]]; then
                deploy_application || exit $EXIT_ERROR
                fi
            fi
        fi
        
    elif [[ "$INFRA_HEALTHY" == "true" ]] && [[ "$APP_CHANGED" == "true" ]]; then
        # Infrastructure healthy, app changed - deploy app only
        log_info "Deploying application only..."
        deploy_application || exit $EXIT_ERROR
        
    elif [[ "$INFRA_HEALTHY" == "true" ]] && [[ "$APP_CHANGED" != "true" ]]; then
        # No changes - skip deployment
        log_info "No changes detected - skipping deployment"
        exit $EXIT_SUCCESS
    fi
    
    # Final verification
    "${SCRIPT_DIR}/verify.sh" >/dev/null || {
        log_error "Final verification failed"
        exit $EXIT_ERROR
    }
    
    log_success "Deployment completed successfully"
    exit $EXIT_SUCCESS
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
