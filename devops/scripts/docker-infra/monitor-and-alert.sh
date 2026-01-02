#!/bin/bash
# Performance Monitoring and Alerting Script
# Runs every 5 minutes via cron to monitor SLA compliance and resource usage

set -euo pipefail

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Ensure directories exist
ensure_directories

# Check SLA compliance
check_sla_compliance() {
    local API_RESPONSE_TIME_SLA=200  # ms
    
    # Check if API is running
    if ! container_running "latest-api"; then
        log_warning "API container not running - skipping SLA check"
        return 0
    fi
    
    # Measure API response time
    local response_time=$(curl -w "%{time_total}" -o /dev/null -s http://localhost:8088/health 2>/dev/null || echo "999")
    local response_time_ms=$(echo "$response_time * 1000" | bc 2>/dev/null || echo "999")
    
    if (( $(echo "$response_time_ms > $API_RESPONSE_TIME_SLA" | bc -l 2>/dev/null || echo 0) )); then
        log_warning "SLA BREACH: API response time ${response_time_ms}ms > ${API_RESPONSE_TIME_SLA}ms"
        send_alert "WARNING" "API response time SLA breach: ${response_time_ms}ms"
    fi
    
    # Log SLA metrics
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|API_RESPONSE|${response_time_ms}ms" >> "${LOG_DIR}/sla-metrics.log"
}

# Check container resources
check_all_container_resources() {
    local containers=("latest-api" "latest-worker" "postgres" "dragonfly")
    
    for container in "${containers[@]}"; do
        if container_running "$container"; then
            check_container_resources "$container" 85 85
        fi
    done
}

# Check worker queue backlog
check_worker_queues() {
    if ! container_running "latest-worker"; then
        return 0
    fi
    
    # Check queue sizes via Redis
    local waiting_jobs=$(docker exec dragonfly redis-cli LLEN "bull:email:waiting" 2>/dev/null || echo "0")
    local active_jobs=$(docker exec dragonfly redis-cli LLEN "bull:email:active" 2>/dev/null || echo "0")
    
    if [[ $waiting_jobs -gt 100 ]]; then
        log_warning "Email queue backlog: $waiting_jobs waiting jobs"
        send_alert "WARNING" "Worker queue backlog: $waiting_jobs jobs waiting"
    fi
    
    # Check for failed jobs
    local failed_jobs=$(docker exec dragonfly redis-cli LLEN "bull:email:failed" 2>/dev/null || echo "0")
    
    if [[ $failed_jobs -gt 50 ]]; then
        log_error "High failed job count: $failed_jobs"
        send_alert "ERROR" "Worker queue has $failed_jobs failed jobs"
    fi
}

# Check disk space
check_disk_usage() {
    local backup_dir="${BACKUP_DIR:-/opt/healthcare-backend/backups}"
    local available=$(check_disk_space "$backup_dir")
    
    if [[ "$available" -lt 30 ]]; then
        log_warning "Low disk space: ${available}GB available"
        send_alert "WARNING" "Low disk space: ${available}GB available"
        
        if [[ "$available" -lt 20 ]]; then
            log_error "Critical disk space: ${available}GB available"
            send_alert "CRITICAL" "Critical disk space: ${available}GB - triggering cleanup"
            cleanup_old_backups_aggressive
        fi
    fi
}

# Check database connections
check_postgres_connections() {
    if ! container_running "postgres"; then
        return 0
    fi
    
    # Get max connections
    local max_conn=$(docker exec postgres psql -U postgres -t -c "SHOW max_connections;" 2>/dev/null | xargs || echo "100")
    
    # Get active connections
    local active_conn=$(docker exec postgres psql -U postgres -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null | xargs || echo "0")
    
    # Calculate usage percentage
    local usage_pct=$((active_conn * 100 / max_conn))
    
    if [[ $usage_pct -gt 80 ]]; then
        log_warning "PostgreSQL connection pool at ${usage_pct}% (${active_conn}/${max_conn})"
        send_alert "WARNING" "High database connection usage: ${usage_pct}%"
    fi
}

# Main monitoring loop
main() {
    log_info "Starting performance monitoring check..."
    
    # Check SLA compliance
    check_sla_compliance
    
    # Check container resources
    check_all_container_resources
    
    # Check worker queues
    check_worker_queues
    
    # Check disk space
    check_disk_usage
    
    # Check database connections
    check_postgres_connections
    
    log_success "Performance monitoring check completed"
}

# Run main function
main "$@"
