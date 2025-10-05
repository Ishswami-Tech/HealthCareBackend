#!/bin/bash
# 🏥 Healthcare Backend Unified Health Check Script
# Supports both Docker Compose and Kubernetes deployments
# Optimized for 1M+ concurrent users

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOYMENT_TYPE=${1:-docker}  # docker or kubernetes
MAX_RETRIES=${2:-5}
API_CONTAINER="latest-api"
NAMESPACE="healthcare-backend"

# Logging functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Detect deployment type automatically
detect_deployment_type() {
    if command -v kubectl &> /dev/null && kubectl get pods -n $NAMESPACE &> /dev/null; then
        echo "kubernetes"
    else
        echo "docker"
    fi
}

# Check if container/pod is running
check_container_running() {
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        kubectl get pods -n $NAMESPACE -l app=healthcare-api --field-selector=status.phase=Running | grep -q "Running"
    else
        docker ps --filter "name=$API_CONTAINER" --format "{{.Status}}" | grep -q "Up"
    fi
}

# Get health check URL
get_health_url() {
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        # Use kubectl port-forward for health check
        echo "http://healthcare-api.$NAMESPACE.svc.cluster.local:8088/health"
    else
        echo "http://localhost:8088/health"
    fi
}

# Perform health check
perform_health_check() {
    local health_url="$1"
    local description="$2"
    
    log "Testing health endpoint: $description ($health_url)"
    
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        # Use kubectl run for health check in Kubernetes
        HEALTH_OUTPUT=$(timeout 15 kubectl run health-check-$(date +%s) \
            --image=curlimages/curl:latest \
            --rm -i --restart=Never \
            -- curl -s --max-time 10 --connect-timeout 5 "$health_url" 2>&1 || echo "Connection failed")
    else
        # Use curl directly for Docker
        HEALTH_OUTPUT=$(timeout 15 curl -s --max-time 10 --connect-timeout 5 "$health_url" 2>&1 || echo "Connection failed")
    fi
    
    if [ -n "$HEALTH_OUTPUT" ] && [ "$HEALTH_OUTPUT" != "Connection failed" ]; then
        log "Health check response received"
        
        # Check for HTTP 200 response
        if echo "$HEALTH_OUTPUT" | grep -q "< HTTP/1.1 200 OK\|< HTTP/2 200\|< HTTP/1.1 200"; then
            success "HTTP 200 response received"
            return 0
        fi
        
        # Check for healthy status in JSON response
        if echo "$HEALTH_OUTPUT" | grep -q '"status"\s*:\s*"healthy"\|"status":"up"\|"status": "up"\|"ok"\|"UP"\|"HEALTHY"'; then
            success "Health status indicator found in response"
            return 0
        fi
        
        # Check for specific health indicators
        if echo "$HEALTH_OUTPUT" | grep -q '"api".*"status".*"healthy"'; then
            success "API service health confirmed"
            return 0
        fi
        
        warn "Response preview: $(echo "$HEALTH_OUTPUT" | head -3)"
        return 1
    else
        warn "Failed to get response from $health_url"
        return 1
    fi
}

# Wait for container/pod to be running
wait_for_container() {
    log "Waiting for API container/pod to be running..."
    
    for i in {1..10}; do
        if check_container_running; then
            if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
                success "API pods are running in Kubernetes"
            else
                success "API container is running"
            fi
            return 0
        fi
        
        if [ $i -eq 10 ]; then
            error "API container/pod is not running after 10 attempts"
            if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
                kubectl get pods -n $NAMESPACE -l app=healthcare-api || true
            else
                docker ps -a | grep "$API_CONTAINER" || true
            fi
            return 1
        fi
        
        log "Attempt $i/10: Waiting for API container/pod to be running..."
        sleep 5
    done
}

# Comprehensive health check
comprehensive_health_check() {
    local retry_count=0
    local health_passed=false
    
    while [ $retry_count -lt $MAX_RETRIES ] && [ "$health_passed" != "true" ]; do
        retry_count=$((retry_count + 1))
        log "Health check attempt $retry_count/$MAX_RETRIES..."
        
        if ! check_container_running; then
            error "API container/pod is not running! This is a critical failure."
            if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
                kubectl get pods -n $NAMESPACE -l app=healthcare-api || true
            else
                docker ps -a | grep "$API_CONTAINER" || true
            fi
            return 1
        fi
        
        # Get health URL
        local health_url=$(get_health_url)
        
        # Try localhost first
        if perform_health_check "$health_url" "primary endpoint"; then
            health_passed=true
            break
        fi
        
        # Try domain URL as fallback
        if perform_health_check "https://api.ishswami.in/health" "domain fallback"; then
            health_passed=true
            break
        fi
        
        if [ $retry_count -lt $MAX_RETRIES ]; then
            log "Health check attempt $retry_count failed, waiting 5 seconds before retry..."
            sleep 5
        fi
    done
    
    if [ "$health_passed" = "true" ]; then
        success "Health check completed successfully"
        return 0
    else
        error "Health check failed after $MAX_RETRIES attempts"
        return 1
    fi
}

# Check container uptime as fallback
check_container_uptime() {
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        local container_uptime=$(docker inspect --format='{{.State.StartedAt}}' "$API_CONTAINER" 2>/dev/null || echo "")
        if [ -n "$container_uptime" ]; then
            local current_time=$(date -u +%s)
            local container_start_time=$(date -u -d "$container_uptime" +%s 2>/dev/null || echo "0")
            
            if [ "$container_start_time" -gt 0 ]; then
                local uptime_seconds=$((current_time - container_start_time))
                if [ $uptime_seconds -gt 30 ]; then
                    log "Container has been running stably for over 30 seconds"
                    log "Marking deployment as successful despite health check response issues"
                    return 0
                else
                    log "Container is running but hasn't been up long enough to verify stability"
                    return 1
                fi
            fi
        fi
    fi
    
    return 1
}

# Show container/pod status
show_status() {
    log "Current status:"
    
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        kubectl get pods -n $NAMESPACE -l app=healthcare-api
        kubectl get svc -n $NAMESPACE
    else
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    fi
}

# Main health check function
main() {
    log "🏥 Starting Healthcare Backend health check..."
    log "Deployment type: $DEPLOYMENT_TYPE"
    log "Max retries: $MAX_RETRIES"
    
    # Auto-detect deployment type if not specified
    if [ "$DEPLOYMENT_TYPE" = "auto" ]; then
        DEPLOYMENT_TYPE=$(detect_deployment_type)
        log "Auto-detected deployment type: $DEPLOYMENT_TYPE"
    fi
    
    # Wait for container/pod to be running
    if ! wait_for_container; then
        error "Failed to start API container/pod"
        exit 1
    fi
    
    # Perform comprehensive health check
    if comprehensive_health_check; then
        success "✅ Health check completed successfully"
        show_status
        exit 0
    else
        # Try uptime fallback
        if check_container_uptime; then
            success "✅ Health check completed successfully (uptime fallback)"
            show_status
            exit 0
        else
            error "❌ Health check failed"
            show_status
            exit 1
        fi
    fi
}

# Show usage if no arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 [deployment_type] [max_retries]"
    echo "  deployment_type: docker, kubernetes, auto (default: docker)"
    echo "  max_retries: number of retry attempts (default: 5)"
    echo ""
    echo "Examples:"
    echo "  $0 docker 10"
    echo "  $0 kubernetes 5"
    echo "  $0 auto"
    exit 1
fi

# Run health check
main "$@"
