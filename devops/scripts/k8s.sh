#!/usr/bin/env bash
# Consolidated Kubernetes Management Script
# Handles all Kubernetes operations for Healthcare Backend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
K8S_DIR="$PROJECT_ROOT/devops/kubernetes"
BASE_DIR="$K8S_DIR/base"
SCRIPTS_DIR="$K8S_DIR/scripts"
NAMESPACE="healthcare-backend"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_success() { echo -e "${GREEN}✅${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠️${NC} $1"; }
print_error() { echo -e "${RED}❌${NC} $1"; }

# Check prerequisites
check_prerequisites() {
    local missing=()
    
    if ! command -v kubectl &> /dev/null; then
        missing+=("kubectl")
    fi
    
    if ! command -v kustomize &> /dev/null && ! kubectl kustomize --help &> /dev/null 2>&1; then
        missing+=("kustomize")
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        print_error "Missing prerequisites: ${missing[*]}"
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Deploy to environment
deploy() {
    local env="${1:-local}"
    local overlay="$K8S_DIR/overlays/$env"
    
    if [ ! -d "$overlay" ]; then
        print_error "Overlay not found: $overlay"
        exit 1
    fi
    
    print_info "Deploying to: $env"
    check_prerequisites
    
    # Create namespace
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Setup secrets if script exists
    local secrets_script="$SCRIPTS_DIR/setup-${env}-secrets.sh"
    if [ -f "$secrets_script" ]; then
        print_info "Setting up secrets..."
        bash "$secrets_script"
    else
        print_warning "Secrets script not found: $secrets_script"
        print_info "You may need to set up secrets manually"
    fi
    
    # Apply kustomize
    print_info "Applying Kubernetes resources..."
    cd "$overlay"
    kubectl kustomize . | kubectl apply -f -
    
    print_success "Deployment complete"
    show_status
}

# Setup secrets
setup_secrets() {
    local env="${1:-local}"
    local script="$SCRIPTS_DIR/setup-${env}-secrets.sh"
    
    if [ ! -f "$script" ]; then
        print_error "Secrets script not found: $script"
        exit 1
    fi
    
    print_info "Setting up secrets for: $env"
    bash "$script"
}

# Generate secrets
generate_secrets() {
    local provider="${1:-openvidu}"
    local script="$SCRIPTS_DIR/generate-${provider}-secrets.sh"
    
    if [ ! -f "$script" ]; then
        print_error "Secret generation script not found: $script"
        exit 1
    fi
    
    print_info "Generating secrets for: $provider"
    bash "$script"
}

# Configure domain
configure_domain() {
    local provider="${1:-openvidu}"
    local domain="${2:-}"
    local script="$SCRIPTS_DIR/configure-${provider}-domain.sh"
    
    if [ ! -f "$script" ]; then
        print_warning "Domain configuration script not found: $script"
        print_info "You can manually update the following files:"
        echo "   - devops/kubernetes/base/${provider}-configmap.yaml"
        echo "   - devops/kubernetes/base/configmap.yaml"
        echo "   - devops/kubernetes/base/ingress.yaml"
        echo ""
        print_info "Or use kubectl to update ConfigMaps directly:"
        echo "   kubectl edit configmap ${provider}-config -n $NAMESPACE"
        echo "   kubectl edit configmap healthcare-api-config -n $NAMESPACE"
        exit 1
    fi
    
    print_info "Configuring domain for: $provider"
    if [ -n "$domain" ]; then
        bash "$script" "$domain"
    else
        bash "$script"
    fi
}

# Show status
show_status() {
    print_info "Kubernetes Status:"
    kubectl get pods -n "$NAMESPACE"
    echo ""
    kubectl get svc -n "$NAMESPACE"
    echo ""
}

# Show logs
logs() {
    local resource="${1:-deployment/healthcare-api}"
    print_info "Showing logs for: $resource"
    kubectl logs -f -n "$NAMESPACE" "$resource" --tail=100
}

# Port forward
port_forward() {
    local service="${1:-healthcare-api}"
    local port="${2:-8088}"
    print_info "Port forwarding $service:$port to localhost:$port"
    kubectl port-forward -n "$NAMESPACE" "svc/$service" "$port:$port"
}

# Shell access
shell() {
    local pod="${1:-}"
    if [ -z "$pod" ]; then
        pod=$(kubectl get pods -n "$NAMESPACE" -l app=healthcare-api -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
        if [ -z "$pod" ]; then
            print_error "No API pod found"
            exit 1
        fi
    fi
    print_info "Opening shell in: $pod"
    kubectl exec -it -n "$NAMESPACE" "$pod" -- /bin/sh
}

# Clean/teardown
teardown() {
    local env="${1:-local}"
    print_warning "This will delete all resources in namespace: $NAMESPACE"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Cancelled"
        return
    fi
    
    print_info "Tearing down environment: $env"
    kubectl delete namespace "$NAMESPACE" --ignore-not-found=true
    print_success "Teardown complete"
}

# Validate secrets
validate_secrets() {
    local script="$SCRIPTS_DIR/validate-secrets.sh"
    if [ -f "$script" ]; then
        bash "$script"
    else
        print_warning "Validation script not found"
        print_info "Checking secrets manually..."
        kubectl get secrets -n "$NAMESPACE"
    fi
}

# Apply healthcare secrets
apply_secrets() {
    local script="$SCRIPTS_DIR/apply-healthcare-secrets.sh"
    if [ -f "$script" ]; then
        print_info "Applying healthcare secrets..."
        bash "$script"
    else
        print_error "Secrets script not found: $script"
        exit 1
    fi
}

# Apply WAL-G secrets
apply_walg_secrets() {
    local script="$SCRIPTS_DIR/apply-walg-secrets.sh"
    if [ -f "$script" ]; then
        print_info "Applying WAL-G secrets..."
        bash "$script"
    else
        print_error "WAL-G secrets script not found: $script"
        exit 1
    fi
}

# Backup database
backup() {
    print_info "Triggering WAL-G backup..."
    local script="$SCRIPTS_DIR/trigger-walg-backup.sh"
    if [ -f "$script" ]; then
        bash "$script"
    else
        print_error "Backup script not found: $script"
        exit 1
    fi
}

# Show help
show_help() {
    echo "☸️  Healthcare Backend - Kubernetes Management"
    echo "=============================================="
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  deploy <env>              Deploy to environment (local/staging/production)"
    echo "  setup-secrets <env>       Setup secrets for environment"
    echo "  generate-secrets <type>   Generate secrets (openvidu/jitsi)"
    echo "  configure-domain <type> [domain]  Configure domain (openvidu/jitsi)"
    echo "  status                    Show cluster status"
    echo "  logs <resource>           Show logs (e.g., deployment/healthcare-api)"
    echo "  port-forward [svc] [port] Port forward service (default: healthcare-api:8088)"
    echo "  shell [pod]               Open shell in pod"
    echo "  teardown [env]            Delete all resources"
    echo "  validate-secrets          Validate required secrets"
    echo "  apply-secrets             Apply healthcare secrets from env"
    echo "  apply-walg-secrets        Apply WAL-G secrets from env"
    echo "  backup                    Trigger database backup"
    echo "  help                      Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 deploy local                    # Deploy to local"
    echo "  $0 setup-secrets production        # Setup production secrets"
    echo "  $0 generate-secrets openvidu       # Generate OpenVidu secrets"
    echo "  $0 configure-domain openvidu video.example.com"
    echo "  $0 logs deployment/healthcare-api  # Show API logs"
    echo "  $0 port-forward healthcare-api 8088"
    echo "  $0 shell                           # Open shell in API pod"
    echo ""
}

# Main
main() {
    local command="${1:-help}"
    
    case "$command" in
        deploy)
            deploy "${2:-local}"
            ;;
        setup-secrets)
            setup_secrets "${2:-local}"
            ;;
        generate-secrets)
            generate_secrets "${2:-openvidu}"
            ;;
        configure-domain)
            configure_domain "${2:-openvidu}" "${3:-}"
            ;;
        status)
            show_status
            ;;
        logs)
            logs "${2:-deployment/healthcare-api}"
            ;;
        port-forward|pf)
            port_forward "${2:-healthcare-api}" "${3:-8088}"
            ;;
        shell)
            shell "${2:-}"
            ;;
        teardown)
            teardown "${2:-local}"
            ;;
  validate-secrets)
    validate_secrets
    ;;
  apply-secrets)
    apply_secrets
    ;;
  apply-walg-secrets)
    apply_walg_secrets
    ;;
  backup)
    backup
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

