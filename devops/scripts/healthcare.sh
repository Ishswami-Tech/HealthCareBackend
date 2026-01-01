#!/usr/bin/env bash
# Main Healthcare Backend DevOps Script
# Unified entry point for all DevOps operations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DOCKER_SCRIPT="$SCRIPT_DIR/dev/docker.sh"
DEV_K8S_SCRIPT="$SCRIPT_DIR/dev/k8s.sh"
DOCKER_PROD_SCRIPT="$SCRIPT_DIR/docker-infra/deploy.sh"
K8S_PROD_SCRIPT="$SCRIPT_DIR/kubernetes/deploy.sh"

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
    echo "  dev           Development operations (local Docker/K8s)"
    echo "  docker        Docker production operations"
    echo "  k8s, k8s      Kubernetes production operations"
    echo ""
    echo "Development Commands:"
    echo "  dev docker <cmd>     Local Docker Compose operations"
    echo "  dev k8s <cmd>        Local Kubernetes operations"
    echo ""
    echo "Docker Production Commands:"
    echo "  deploy              Smart deployment orchestrator"
    echo "  health-check        Infrastructure health monitoring"
    echo "  backup              Dual-backup system"
    echo "  restore [id]        Restore from backup"
    echo "  diagnose            Auto-debugging"
    echo "  verify              Post-deployment verification"
    echo "  setup-directories   Setup server directories"
    echo ""
    echo "Kubernetes Production Commands:"
    echo "  deploy <env>              Deploy to environment"
    echo "  setup-secrets <env>       Setup secrets"
    echo "  status                    Show status"
    echo "  logs <resource>           Show logs"
    echo "  backup                    Trigger backup"
    echo ""
    echo "Examples:"
    echo "  $0 dev docker start                    # Start local Docker services"
    echo "  $0 docker deploy                        # Deploy Docker production"
    echo "  $0 docker health-check                  # Check Docker infrastructure"
    echo "  $0 k8s deploy production                # Deploy to K8s production"
    echo ""
}

# Main
main() {
    local platform="${1:-help}"
    
    case "$platform" in
        dev)
            shift || true
            local sub_platform="${1:-help}"
            case "$sub_platform" in
                docker|d)
                    shift || true
                    bash "$DEV_DOCKER_SCRIPT" "$@"
                    ;;
                k8s|k|kubernetes)
                    shift || true
                    bash "$DEV_K8S_SCRIPT" "$@"
                    ;;
                *)
                    echo "❌ Unknown dev platform: $sub_platform"
                    echo "Use: dev docker <cmd> or dev k8s <cmd>"
                    exit 1
                    ;;
            esac
            ;;
        docker|d)
            shift || true
            # Route to appropriate Docker script
            local cmd="${1:-deploy}"
            # Security: Validate command name (prevent path traversal)
            if [[ "$cmd" == *"/"* ]] || [[ "$cmd" == *".."* ]] || [[ "$cmd" == *"$"* ]] || [[ "$cmd" == *"`"* ]]; then
                echo "❌ Invalid command name (security check failed): $cmd"
                exit 1
            fi
            case "$cmd" in
                deploy|health-check|backup|restore|diagnose|verify|setup-directories)
                    bash "${SCRIPT_DIR}/docker-infra/${cmd}.sh" "${@:2}"
                    ;;
                *)
                    # Try as direct script name (with validation)
                    if [[ -f "${SCRIPT_DIR}/docker-infra/${cmd}.sh" ]]; then
                        bash "${SCRIPT_DIR}/docker-infra/${cmd}.sh" "${@:2}"
                    else
                        echo "❌ Unknown Docker command: $cmd"
                        echo "Available: deploy, health-check, backup, restore, diagnose, verify, setup-directories"
                        exit 1
                    fi
                    ;;
            esac
            ;;
        k8s|kubernetes)
            shift || true
            # Route to Kubernetes production scripts
            local cmd="${1:-deploy}"
            # Security: Validate command name (prevent path traversal)
            if [[ "$cmd" == *"/"* ]] || [[ "$cmd" == *".."* ]] || [[ "$cmd" == *"$"* ]] || [[ "$cmd" == *"`"* ]]; then
                echo "❌ Invalid command name (security check failed): $cmd"
                exit 1
            fi
            if [[ -f "${SCRIPT_DIR}/kubernetes/${cmd}.sh" ]]; then
                bash "${SCRIPT_DIR}/kubernetes/${cmd}.sh" "${@:2}"
            else
                # Fallback to dev k8s script for now
                bash "$DEV_K8S_SCRIPT" "$@"
            fi
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

