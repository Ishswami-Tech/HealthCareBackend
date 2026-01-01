#!/usr/bin/env bash
# Consolidated Docker Management Script
# Handles all Docker Compose operations for Healthcare Backend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/devops/docker/docker-compose.dev.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_success() { echo -e "${GREEN}✅${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠️${NC} $1"; }
print_error() { echo -e "${RED}❌${NC} $1"; }

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running"
        echo ""
        echo "💡 Steps to fix:"
        echo "   1. Open Docker Desktop application"
        echo "   2. Wait for Docker Desktop to fully start"
        echo "   3. Ensure WSL2 integration is enabled (if using WSL)"
        echo "   4. Run this script again"
        exit 1
    fi
    print_success "Docker is running"
}

# Start services
start() {
    print_info "Starting Healthcare Backend services..."
    check_docker
    
    cd "$PROJECT_ROOT"
    
    # Stop existing containers
    print_info "Stopping existing containers (if any)..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    
    # Build and start
    print_info "Building and starting containers..."
    docker compose -f "$COMPOSE_FILE" up -d --build
    
    print_success "Services started!"
    echo ""
    show_status
    show_access_points
}

# Stop services
stop() {
    print_info "Stopping services..."
    cd "$PROJECT_ROOT"
    docker compose -f "$COMPOSE_FILE" down
    print_success "Services stopped"
}

# Restart services
restart() {
    print_info "Restarting services..."
    stop
    sleep 2
    start
}

# Show status
show_status() {
    print_info "Service Status:"
    cd "$PROJECT_ROOT"
    docker compose -f "$COMPOSE_FILE" ps
    echo ""
}

# Show logs
logs() {
    local service="${1:-api}"
    print_info "Showing logs for: $service"
    cd "$PROJECT_ROOT"
    docker compose -f "$COMPOSE_FILE" logs -f "$service"
}

# Monitor logs
monitor() {
    local service="${1:-api}"
    print_info "Monitoring logs for: $service (Press Ctrl+C to stop)"
    cd "$PROJECT_ROOT"
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$service"
}

# Check health
health() {
    print_info "Checking service health..."
    check_docker
    show_status
    
    # Check API
    print_info "Testing API health endpoint..."
    if curl -f -s http://localhost:8088/health > /dev/null 2>&1; then
        print_success "API is responding"
        curl -s http://localhost:8088/health | head -10
    else
        print_warning "API is not responding yet"
    fi
    echo ""
}

# Clean everything
clean() {
    print_warning "This will remove all containers, volumes, and images!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Cancelled"
        return
    fi
    
    print_info "Cleaning Docker resources..."
    cd "$PROJECT_ROOT"
    
    # Stop and remove containers
    docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
    
    # Remove healthcare images
    docker images | grep healthcare | awk '{print $3}' | xargs -r docker rmi -f 2>/dev/null || true
    
    # System prune
    docker system prune -a --volumes -f
    
    print_success "Cleanup complete"
}

# Shell access
shell() {
    local service="${1:-api}"
    print_info "Opening shell in: $service"
    cd "$PROJECT_ROOT"
    docker exec -it "healthcare-$service" sh
}

# Show access points
show_access_points() {
    echo "🌐 Access Points:"
    echo "   - API:              http://localhost:8088"
    echo "   - Swagger Docs:     http://localhost:8088/docs"
    echo "   - Health Check:     http://localhost:8088/health"
    echo "   - Queue Dashboard:  http://localhost:8088/queue-dashboard"
    echo "   - Prisma Studio:    http://localhost:5555"
    echo "   - PgAdmin:          http://localhost:5050 (admin@admin.com / admin)"
    echo "   - Redis Commander:  http://localhost:8082 (admin / admin)"
    echo "   - OpenVidu:         https://localhost:4443"
    echo "   - Jitsi:            https://localhost:8443"
    echo ""
}

# Show help
show_help() {
    echo "🏥 Healthcare Backend - Docker Management"
    echo "=========================================="
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start              Start all services"
    echo "  stop               Stop all services"
    echo "  restart            Restart all services"
    echo "  status             Show service status"
    echo "  logs [service]     Show logs (default: api)"
    echo "  monitor [service]  Monitor logs (default: api)"
    echo "  health             Check service health"
    echo "  clean              Clean all Docker resources (WARNING: deletes data)"
    echo "  shell [service]    Open shell in container (default: api)"
    echo "  help               Show this help message"
    echo ""
    echo "Services: api, worker, postgres, dragonfly, openvidu-server, jitsi-web, etc."
    echo ""
    echo "Examples:"
    echo "  $0 start                    # Start all services"
    echo "  $0 logs api                 # Show API logs"
    echo "  $0 monitor postgres         # Monitor Postgres logs"
    echo "  $0 shell api                # Open shell in API container"
    echo ""
}

# Main
main() {
    local command="${1:-help}"
    
    case "$command" in
        start)
            start
            ;;
        stop)
            stop
            ;;
        restart)
            restart
            ;;
        status)
            show_status
            ;;
        logs)
            logs "${2:-api}"
            ;;
        monitor)
            monitor "${2:-api}"
            ;;
        health)
            health
            ;;
        clean)
            clean
            ;;
        shell)
            shell "${2:-api}"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"

