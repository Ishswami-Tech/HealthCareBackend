#!/bin/bash
# 🚀 Healthcare Backend Unified Deployment Script
# Supports both Docker Compose and Kubernetes deployments
# Optimized for 1M+ concurrent users

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-production}
DEPLOYMENT_TYPE=${2:-docker}  # docker or kubernetes
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="$PROJECT_ROOT/backups/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$PROJECT_ROOT/logs/deployment_$(date +%Y%m%d_%H%M%S).log"

# Create logs directory
mkdir -p "$(dirname "$LOG_FILE")"

# Logging functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

# Header
show_header() {
    echo -e "${PURPLE}========================================${NC}"
    echo -e "${PURPLE}🏥 Healthcare Backend Deployment${NC}"
    echo -e "${PURPLE}Environment: ${ENVIRONMENT}${NC}"
    echo -e "${PURPLE}Type: ${DEPLOYMENT_TYPE}${NC}"
    echo -e "${PURPLE}========================================${NC}\n"
}

# Check prerequisites
check_prerequisites() {
    log "🔍 Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        error "Docker is not running"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        error "Docker Compose is not available"
        exit 1
    fi
    
    # Check environment file
    if [ ! -f "$PROJECT_ROOT/.env.${ENVIRONMENT}" ]; then
        error "Environment file .env.${ENVIRONMENT} not found"
        exit 1
    fi
    
    # Check Kubernetes if needed
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        if ! command -v kubectl &> /dev/null; then
            error "kubectl is not installed for Kubernetes deployment"
            exit 1
        fi
    fi
    
    # Check system resources
    AVAILABLE_MEMORY=$(free -m | awk 'NR==2{printf "%.1f", $7/1024}')
    AVAILABLE_CPUS=$(nproc)
    
    info "Available Memory: ${AVAILABLE_MEMORY}GB"
    info "Available CPUs: ${AVAILABLE_CPUS}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        if (( $(echo "$AVAILABLE_MEMORY < 8.0" | bc -l) )); then
            warn "Less than 8GB RAM available. Production deployment may be affected."
        fi
        
        if [ "$AVAILABLE_CPUS" -lt 4 ]; then
            warn "Less than 4 CPU cores available. Consider upgrading for optimal performance."
        fi
    fi
    
    success "Prerequisites check completed"
}

# Create backup
create_backup() {
    log "💾 Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup environment files
    cp "$PROJECT_ROOT/.env.${ENVIRONMENT}" "$BACKUP_DIR/.env.backup" 2>/dev/null || true
    
    # Backup Docker Compose files
    cp "$PROJECT_ROOT/docker-compose.yml" "$BACKUP_DIR/" 2>/dev/null || true
    cp "$PROJECT_ROOT/devops/docker/docker-compose.prod.yml" "$BACKUP_DIR/" 2>/dev/null || true
    
    # Backup database if running
    if docker ps --format "table {{.Names}}" | grep -q "postgres"; then
        log "Backing up database..."
        docker exec $(docker ps --format "{{.Names}}" | grep postgres | head -1) pg_dump -U postgres userdb > "$BACKUP_DIR/database_backup.sql" 2>/dev/null || warn "Database backup failed"
    fi
    
    success "Backup created at $BACKUP_DIR"
}

# Docker Compose deployment
deploy_docker() {
    log "🐳 Deploying with Docker Compose..."
    
    cd "$PROJECT_ROOT"
    
    # Pull latest code if in git repository
    if [ -d ".git" ]; then
        log "Pulling latest code..."
        git fetch origin
        git pull origin main
    fi
    
    # Install dependencies
    log "Installing dependencies..."
    if command -v pnpm &> /dev/null; then
        pnpm install --frozen-lockfile
    else
        npm ci
    fi
    
    # Build application
    log "Building application..."
    if command -v pnpm &> /dev/null; then
        pnpm build
    else
        npm run build
    fi
    
    # Run database migrations
    log "Running database migrations..."
    if command -v pnpm &> /dev/null; then
        pnpm exec prisma generate
        pnpm exec prisma db push --accept-data-loss
    else
        npx prisma generate
        npx prisma db push --accept-data-loss
    fi
    
    # Deploy with Docker Compose
    log "Deploying containers..."
    if [ "$ENVIRONMENT" = "production" ]; then
        docker-compose -f "devops/docker/docker-compose.prod.yml" --env-file ".env.${ENVIRONMENT}" down
        docker-compose -f "devops/docker/docker-compose.prod.yml" --env-file ".env.${ENVIRONMENT}" up -d --build
    else
        docker-compose --env-file ".env.${ENVIRONMENT}" down
        docker-compose --env-file ".env.${ENVIRONMENT}" up -d --build
    fi
    
    success "Docker Compose deployment completed"
}

# Kubernetes deployment
deploy_kubernetes() {
    log "☸️ Deploying with Kubernetes..."
    
    cd "$PROJECT_ROOT"
    
    # Create namespace if it doesn't exist
    kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f -
    
    # Create secrets
    log "Creating Kubernetes secrets..."
    kubectl create secret generic healthcare-secrets \
        --from-env-file=".env.${ENVIRONMENT}" \
        --namespace=healthcare-backend \
        --dry-run=client -o yaml | kubectl apply -f -
    
    # Deploy resources
    log "Deploying Kubernetes resources..."
    kubectl apply -k devops/kubernetes/overlays/${ENVIRONMENT}/
    
    # Wait for deployment
    log "Waiting for deployment to be ready..."
    kubectl wait --for=condition=available --timeout=300s deployment/healthcare-api -n healthcare-backend
    
    success "Kubernetes deployment completed"
}

# Health check
health_check() {
    log "🏥 Running health checks..."
    
    local max_retries=30
    local retry_count=0
    local health_url=""
    
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        # Get service endpoint
        health_url="http://$(kubectl get svc healthcare-api -n healthcare-backend -o jsonpath='{.spec.clusterIP}'):8088/health"
    else
        health_url="http://localhost:8088/health"
    fi
    
    while [ $retry_count -lt $max_retries ]; do
        if curl -f -s "$health_url" > /dev/null; then
            success "Health check passed"
            return 0
        fi
        
        retry_count=$((retry_count + 1))
        log "Waiting for application to start... ($retry_count/$max_retries)"
        sleep 5
    done
    
    error "Health check failed after $max_retries attempts"
    return 1
}

# Performance optimization
optimize_performance() {
    log "⚡ Applying performance optimizations..."
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        # Docker optimizations
        log "Optimizing Docker containers..."
        
        # Database optimization
        if docker ps --format "{{.Names}}" | grep -q "postgres"; then
            docker exec $(docker ps --format "{{.Names}}" | grep postgres | head -1) psql -U postgres -d userdb -c "ANALYZE;" 2>/dev/null || warn "Database ANALYZE failed"
        fi
        
        # Redis optimization
        if docker ps --format "{{.Names}}" | grep -q "redis"; then
            docker exec $(docker ps --format "{{.Names}}" | grep redis | head -1) redis-cli CONFIG SET maxmemory-policy allkeys-lru 2>/dev/null || warn "Redis optimization failed"
        fi
    else
        # Kubernetes optimizations
        log "Optimizing Kubernetes deployment..."
        kubectl rollout restart deployment/healthcare-api -n healthcare-backend
    fi
    
    success "Performance optimizations applied"
}

# Security hardening
apply_security() {
    log "🔒 Applying security configurations..."
    
    # Set proper file permissions
    chmod 600 "$PROJECT_ROOT/.env.${ENVIRONMENT}" 2>/dev/null || warn "Could not secure environment file"
    
    if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        # Apply network policies
        kubectl apply -f devops/kubernetes/base/network-policies.yaml -n healthcare-backend 2>/dev/null || warn "Network policies not applied"
        
        # Apply RBAC
        kubectl apply -f devops/kubernetes/base/rbac.yaml -n healthcare-backend 2>/dev/null || warn "RBAC not applied"
    fi
    
    success "Security configurations applied"
}

# Cleanup
cleanup() {
    log "🧹 Cleaning up..."
    
    # Remove unused Docker resources
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        docker system prune -f --filter "label=com.docker.compose.service=api" 2>/dev/null || true
    fi
    
    success "Cleanup completed"
}

# Show deployment summary
show_summary() {
    log "📊 Deployment Summary:"
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        log "   - API: http://localhost:8088"
        log "   - Health: http://localhost:8088/health"
        log "   - Docs: http://localhost:8088/docs"
        log "   - Queue Dashboard: http://localhost:8088/queue-dashboard"
        log "   - Logger Dashboard: http://localhost:8088/logger"
    else
        log "   - Namespace: healthcare-backend"
        log "   - API Service: healthcare-api"
        log "   - Check status: kubectl get all -n healthcare-backend"
    fi
    
    log "   - Logs: $LOG_FILE"
    log "   - Backup: $BACKUP_DIR"
    
    success "🎉 Healthcare Backend deployed successfully!"
    info "🚀 Ready for ${ENVIRONMENT} environment with ${DEPLOYMENT_TYPE} deployment"
}

# Main deployment function
main() {
    show_header
    
    # Run deployment steps
    check_prerequisites
    create_backup
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        deploy_docker
    else
        deploy_kubernetes
    fi
    
    health_check
    optimize_performance
    apply_security
    cleanup
    show_summary
}

# Handle script interruption
trap 'error "Deployment interrupted"; exit 1' INT TERM

# Show usage if no arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 [environment] [deployment_type]"
    echo "  environment: development, staging, production (default: production)"
    echo "  deployment_type: docker, kubernetes (default: docker)"
    echo ""
    echo "Examples:"
    echo "  $0 production docker"
    echo "  $0 development kubernetes"
    echo "  $0 staging"
    exit 1
fi

# Run deployment
main "$@"
