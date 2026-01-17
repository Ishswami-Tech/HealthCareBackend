#!/bin/bash
# Incident Response Script
# Quick resolution for common infrastructure issues

set -euo pipefail

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Display usage
usage() {
    cat << EOF
Usage: $0 <incident-type>

Incident Types:
  high-memory        - Handle high memory usage in containers
  db-connections     - Handle database connection pool exhaustion
  worker-backlog     - Handle worker queue backlog
  deployment-failed  - Rollback failed deployment
  disk-full          - Handle disk space exhaustion

Example:
  $0 high-memory
  $0 db-connections
EOF
    exit 1
}

# Handle high memory usage
handle_high_memory() {
    log_info "Responding to high memory incident..."
    
    local containers=("latest-api" "latest-worker")
    
    for container in "${containers[@]}"; do
        if container_running "$container"; then
            log_info "Checking memory usage for $container..."
            
            # Trigger manual GC
            log_info "Triggering garbage collection on $container..."
            docker exec "$container" node -e "if (global.gc) { global.gc(); console.log('GC triggered'); } else { console.log('GC not exposed'); }" 2>/dev/null || log_warning "Failed to trigger GC on $container"
            
            # Check memory after GC
            sleep 2
            docker stats --no-stream "$container"
        fi
    done
    
    log_success "High memory incident response completed"
}

# Handle database connection pool exhaustion
handle_db_connections() {
    log_info "Responding to database connection pool exhaustion..."
    
    if ! container_running "postgres"; then
        log_error "PostgreSQL container not running"
        return 1
    fi
    
    # Show current connections
    log_info "Current active connections:"
    docker exec postgres psql -U postgres -c "
        SELECT pid, usename, application_name, state, query_start 
        FROM pg_stat_activity 
        WHERE state != 'idle' 
        ORDER BY query_start;" || true
    
    # Kill long-running queries (>5 minutes)
    log_info "Terminating long-running queries (>5 minutes)..."
    docker exec postgres psql -U postgres -c "
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE state = 'active' 
        AND query_start < NOW() - INTERVAL '5 minutes';" || true
    
    # Show updated connection count
    log_info "Updated connection count:"
    docker exec postgres psql -U postgres -c "SELECT count(*) as active_connections FROM pg_stat_activity WHERE state='active';" || true
    
    log_success "Database connection pool incident response completed"
}

# Handle worker queue backlog
handle_worker_backlog() {
    log_info "Responding to worker queue backlog..."
    
    if ! container_running "latest-worker"; then
        log_error "Worker container not running"
        return 1
    fi
    
    # Show queue status
    log_info "Current queue status:"
    echo "Waiting jobs: $(docker exec dragonfly redis-cli LLEN "bull:email:waiting" 2>/dev/null || echo "N/A")"
    echo "Active jobs: $(docker exec dragonfly redis-cli LLEN "bull:email:active" 2>/dev/null || echo "N/A")"
    echo "Failed jobs: $(docker exec dragonfly redis-cli LLEN "bull:email:failed" 2>/dev/null || echo "N/A")"
    
    # Show recent worker logs
    log_info "Recent worker logs:"
    docker logs latest-worker --tail 50
    
    log_info "Consider scaling workers if backlog persists:"
    log_info "  docker compose -f docker-compose.prod.yml up -d --scale worker=2"
    
    log_success "Worker backlog incident response completed"
}

# Handle deployment failure
handle_deployment_failed() {
    log_info "Responding to deployment failure..."
    
    # Find last success backup
    local last_success_backup=$(find_last_backup "success")
    
    if [[ -n "$last_success_backup" ]]; then
        log_info "Rolling back to last success backup: ${last_success_backup}"
        
        if restore_backup "$last_success_backup"; then
            log_success "Rollback to success backup completed"
            
            # Verify health
            log_info "Verifying infrastructure health..."
            "${SCRIPT_DIR}/health-check.sh" || log_warning "Health check failed after rollback"
        else
            log_error "Rollback to success backup failed"
            return 1
        fi
    else
        log_warning "No success backup found"
        log_info "Check for pre-deployment backups manually"
    fi
    
    log_success "Deployment failure incident response completed"
}

# Handle disk space exhaustion
handle_disk_full() {
    log_info "Responding to disk space exhaustion..."
    
    # Show current disk usage
    log_info "Current disk usage:"
    df -h
    
    # Cleanup old backups
    log_info "Cleaning up old backups..."
    cleanup_old_backups_aggressive
    
    # Cleanup Docker
    log_info "Cleaning up Docker system..."
    docker system prune -af --volumes || log_warning "Docker cleanup failed"
    
    # Show updated disk usage
    log_info "Updated disk usage:"
    df -h
    
    log_success "Disk space incident response completed"
}

# Main function
main() {
    local incident_type="${1:-}"
    
    if [[ -z "$incident_type" ]]; then
        usage
    fi
    
    log_info "=== Incident Response: $incident_type ==="
    
    case "$incident_type" in
        high-memory)
            handle_high_memory
            ;;
        db-connections)
            handle_db_connections
            ;;
        worker-backlog)
            handle_worker_backlog
            ;;
        deployment-failed)
            handle_deployment_failed
            ;;
        disk-full)
            handle_disk_full
            ;;
        *)
            log_error "Unknown incident type: $incident_type"
            usage
            ;;
    esac
    
    log_info "=== Incident Response Complete ==="
}

# Run main function
main "$@"
