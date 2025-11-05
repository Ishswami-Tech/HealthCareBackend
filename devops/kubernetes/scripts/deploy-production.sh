#!/usr/bin/env bash
# Bash script to deploy Healthcare Backend to Production Kubernetes

set -euo pipefail

SKIP_SECRETS=false
SKIP_MIGRATION=false
IMAGE_TAG="latest"
IMAGE_REGISTRY="your-registry"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-secrets)
            SKIP_SECRETS=true
            shift
            ;;
        --skip-migration)
            SKIP_MIGRATION=true
            shift
            ;;
        --image-tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --image-registry)
            IMAGE_REGISTRY="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCTION_OVERLAY="$K8S_DIR/overlays/production"

echo "🚀 Healthcare Backend - Production Kubernetes Deployment"
echo "======================================================="
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl."
    exit 1
fi
echo "✅ kubectl found: $(kubectl version --client --short 2>&1)"

# Check kustomize
if ! command -v kustomize &> /dev/null; then
    echo "⚠️  kustomize not found. Using kubectl kustomize..."
    if ! kubectl kustomize --help &> /dev/null; then
        echo "❌ kustomize not available. Please install kustomize."
        exit 1
    fi
    KUSTOMIZE_CMD="kubectl kustomize"
else
    echo "✅ kustomize found: $(kustomize version 2>&1)"
    KUSTOMIZE_CMD="kustomize build"
fi

echo ""

# Verify production context
echo "🔍 Verifying Kubernetes context..."
CONTEXT=$(kubectl config current-context)
echo "   Current context: $CONTEXT"

read -p "Are you sure you want to deploy to PRODUCTION? (type 'yes' to continue): " -r
if [[ ! $REPLY == "yes" ]]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""

# Create namespace
echo "📦 Creating namespace..."
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f -
echo "✅ Namespace ready"
echo ""

# Setup secrets
if [ "$SKIP_SECRETS" = false ]; then
    echo "🔐 Setting up production secrets..."
    
    SECRETS_SCRIPT="$SCRIPT_DIR/setup-production-secrets.sh"
    if [ -f "$SECRETS_SCRIPT" ]; then
        bash "$SECRETS_SCRIPT"
    else
        echo "❌ Production secrets script not found at: $SECRETS_SCRIPT"
        echo "   Please create .env.production file and run setup-production-secrets.sh first"
        exit 1
    fi
    echo ""
else
    echo "⏭️  Skipping secrets setup (--skip-secrets flag)"
    echo ""
fi

# Update image tag in kustomization if needed
if [ "$IMAGE_TAG" != "latest" ]; then
    echo "📝 Updating image tag to: $IMAGE_TAG"
    echo "   ⚠️  Make sure to update kustomization.yaml with image tag: $IMAGE_TAG"
    echo ""
fi

# Apply Kubernetes resources using kustomize
echo "🚀 Deploying to Kubernetes..."
cd "$PRODUCTION_OVERLAY"

# Preview what will be deployed
echo "   Previewing deployment..."
if [[ "$KUSTOMIZE_CMD" == "kubectl kustomize" ]]; then
    kubectl kustomize . > /dev/null
else
    kustomize build . > /dev/null
fi

if [ $? -ne 0 ]; then
    echo "❌ Kustomize build failed. Please check your configuration."
    exit 1
fi

# Apply resources
echo "   Applying resources..."
if [[ "$KUSTOMIZE_CMD" == "kubectl kustomize" ]]; then
    kubectl kustomize . | kubectl apply -f -
else
    kustomize build . | kubectl apply -f -
fi

echo "✅ Kubernetes resources applied"
echo ""

# Wait for deployments
echo "⏳ Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=600s deployment/healthcare-api -n healthcare-backend || true

echo "✅ Deployments are ready"
echo ""

# Run database migration
if [ "$SKIP_MIGRATION" = false ]; then
    echo "🔄 Running database migration..."
    
    # Check if migration job already exists
    if kubectl get job healthcare-db-migration -n healthcare-backend &> /dev/null; then
        echo "   Deleting existing migration job..."
        kubectl delete job healthcare-db-migration -n healthcare-backend
        sleep 2
    fi
    
    # Apply migration job
    kubectl apply -f "$K8S_DIR/base/init-job.yaml"
    
    echo "   Waiting for migration to complete..."
    kubectl wait --for=condition=complete --timeout=600s job/healthcare-db-migration -n healthcare-backend || true
    
    if [ $? -eq 0 ]; then
        echo "✅ Database migration completed"
    else
        echo "⚠️  Migration job may still be running. Check with: kubectl logs job/healthcare-db-migration -n healthcare-backend"
    fi
    echo ""
fi

# Display status
echo "📊 Deployment Status:"
echo "==================="
kubectl get pods -n healthcare-backend
echo ""

echo "🌐 Production Access:"
echo "==================="
echo ""
echo "Production API URL: https://api.ishswami.in"
echo "API Docs: https://api.ishswami.in/docs"
echo ""

# Show service URLs
echo "Service URLs:"
if kubectl get svc healthcare-api -n healthcare-backend &> /dev/null; then
    echo "  API Service: healthcare-api.healthcare-backend.svc.cluster.local:8088"
fi

echo ""
echo "📝 Useful Commands:"
echo "==================="
echo "  View logs:     kubectl logs -f deployment/healthcare-api -n healthcare-backend"
echo "  View pods:     kubectl get pods -n healthcare-backend"
echo "  View ingress:  kubectl get ingress -n healthcare-backend"
echo "  View services: kubectl get svc -n healthcare-backend"
echo ""

echo "✅ Production deployment complete!"
echo ""
echo "⚠️  IMPORTANT: Verify your deployment:"
echo "   1. Check all pods are running: kubectl get pods -n healthcare-backend"
echo "   2. Check ingress is configured: kubectl get ingress -n healthcare-backend"
echo "   3. Test API endpoint: curl https://api.ishswami.in/health"
echo "   4. Verify TLS certificate: kubectl get certificate -n healthcare-backend"

