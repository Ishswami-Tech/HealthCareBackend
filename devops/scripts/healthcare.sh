#!/usr/bin/env bash
# Main Healthcare Backend DevOps Script
# Unified entry point for all DevOps operations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_SCRIPT="$SCRIPT_DIR/docker.sh"
K8S_SCRIPT="$SCRIPT_DIR/k8s.sh"

# Colors
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}"
    echo "🏥 Healthcare Backend - DevOps Management"
    echo "=========================================="
    echo -e "${NC}"
}

# Show help
show_help() {
    print_header
    echo ""
    echo "Usage: $0 <platform> <command> [options]"
    echo ""
    echo "Platforms:"
    echo "  docker, d     Docker Compose operations"
    echo "  k8s, k        Kubernetes operations"
    echo ""
    echo "Docker Commands:"
    echo "  start              Start all services"
    echo "  stop               Stop all services"
    echo "  restart            Restart all services"
    echo "  status             Show service status"
    echo "  logs [service]     Show logs"
    echo "  monitor [service]  Monitor logs"
    echo "  health             Check health"
    echo "  clean              Clean all resources"
    echo "  shell [service]    Open shell"
    echo ""
    echo "Kubernetes Commands:"
    echo "  deploy <env>              Deploy to environment"
    echo "  setup-secrets <env>       Setup secrets"
    echo "  generate-secrets <type>   Generate secrets"
    echo "  configure-domain <type> [domain]  Configure domain"
    echo "  status                    Show status"
    echo "  logs <resource>            Show logs"
    echo "  port-forward [svc] [port]  Port forward"
    echo "  shell [pod]                Open shell"
    echo "  teardown [env]             Delete resources"
    echo "  validate-secrets          Validate secrets"
    echo "  backup                    Trigger backup"
    echo ""
    echo "Examples:"
    echo "  $0 docker start                    # Start Docker services"
    echo "  $0 docker logs api                  # Show Docker API logs"
    echo "  $0 k8s deploy local                 # Deploy to local K8s"
    echo "  $0 k8s logs deployment/healthcare-api"
    echo ""
}

# Main
main() {
    local platform="${1:-help}"
    
    case "$platform" in
        docker|d)
            shift || true
            bash "$DOCKER_SCRIPT" "$@"
            ;;
        k8s|k|kubernetes)
            shift || true
            bash "$K8S_SCRIPT" "$@"
            ;;
        help|--help|-h|"")
            show_help
            ;;
        *)
            echo "❌ Unknown platform: $platform"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"

