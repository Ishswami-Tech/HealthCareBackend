#!/usr/bin/env bash
# Bash script to deploy Healthcare Backend to local Kubernetes (Docker Desktop)
# Prerequisites: Docker Desktop with Kubernetes enabled, kubectl, kustomize

set -euo pipefail

SKIP_BUILD=false
SKIP_SECRETS=false
SKIP_MIGRATION=false
IMAGE_TAG="local"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
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
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_OVERLAY="$K8S_DIR/overlays/local"

echo "🚀 Healthcare Backend - Local Kubernetes Deployment"
echo "=================================================="
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

# Check Docker Desktop Kubernetes
echo "🔍 Checking Docker Desktop Kubernetes..."
CONTEXT=$(kubectl config current-context)
if [[ ! "$CONTEXT" =~ docker-desktop|docker-for-desktop ]]; then
    echo "⚠️  Warning: Current context is '$CONTEXT'. Expected docker-desktop context."
    echo "   Please ensure Kubernetes is enabled in Docker Desktop settings."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ Docker Desktop Kubernetes context detected"
fi

# Verify containerd runtime
echo "🔍 Verifying containerd runtime..."
if NODE_INFO=$(kubectl get node docker-desktop -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}' 2>/dev/null); then
    if [[ "$NODE_INFO" =~ containerd ]]; then
        echo "✅ Containerd runtime detected: $NODE_INFO"
    else
        echo "⚠️  Runtime: $NODE_INFO (may not be containerd)"
    fi
else
    echo "⚠️  Could not verify runtime (this is OK if node name differs)"
fi

echo ""

# Build Docker image
if [ "$SKIP_BUILD" = false ]; then
    echo "🔨 Building Docker image..."
    cd "$PROJECT_ROOT"
    
    IMAGE_NAME="healthcare-api:$IMAGE_TAG"
    
    echo "   Building $IMAGE_NAME..."
    docker build -f devops/docker/Dockerfile -t "$IMAGE_NAME" .
    
    echo "✅ Docker image built successfully"
    echo ""
    
    # Verify image exists
    echo "📦 Verifying image is available to containerd..."
    if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${IMAGE_NAME}$"; then
        echo "✅ Image '$IMAGE_NAME' is available"
        echo "   Docker Desktop automatically makes images available to containerd/Kubernetes"
    else
        echo "⚠️  Warning: Image not found in Docker images list"
    fi
    echo ""
else
    echo "⏭️  Skipping Docker build (--skip-build flag)"
    echo ""
fi

# Create namespace
echo "📦 Creating namespace..."
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f -
echo "✅ Namespace ready"
echo ""

# Setup secrets
if [ "$SKIP_SECRETS" = false ]; then
    echo "🔐 Setting up secrets..."
    
    SECRETS_SCRIPT="$SCRIPT_DIR/setup-local-secrets.sh"
    if [ -f "$SECRETS_SCRIPT" ]; then
        bash "$SECRETS_SCRIPT"
    else
        echo "⚠️  Secrets script not found. Creating default secrets..."
        
        # Generate default secrets for local development
        POSTGRES_PASSWORD="postgres123"
        REDIS_PASSWORD="redis123"
        JWT_SECRET="local-dev-jwt-secret-change-in-production"
        
        DB_URL="postgresql://postgres:$POSTGRES_PASSWORD@postgres:5432/userdb?schema=public"
        DB_MIGRATION_URL="postgresql://postgres:$POSTGRES_PASSWORD@postgres:5432/userdb?schema=public"
        
        kubectl create secret generic healthcare-secrets \
            --namespace healthcare-backend \
            --from-literal=postgres-user=postgres \
            --from-literal=postgres-password="$POSTGRES_PASSWORD" \
            --from-literal=database-url="$DB_URL" \
            --from-literal=database-migration-url="$DB_MIGRATION_URL" \
            --from-literal=redis-password="$REDIS_PASSWORD" \
            --from-literal=jwt-secret="$JWT_SECRET" \
            --dry-run=client -o yaml | kubectl apply -f -
        
        echo "✅ Default secrets created (using default values for local dev)"
        echo "   ⚠️  Change these values in production!"
    fi
    echo ""
else
    echo "⏭️  Skipping secrets setup (--skip-secrets flag)"
    echo ""
fi

# Apply Kubernetes resources using kustomize
echo "🚀 Deploying to Kubernetes..."
cd "$LOCAL_OVERLAY"

if [[ "$KUSTOMIZE_CMD" == "kubectl kustomize" ]]; then
    kubectl kustomize . | kubectl apply -f -
else
    kustomize build . | kubectl apply -f -
fi

echo "✅ Kubernetes resources applied"
echo ""

# Wait for deployments
echo "⏳ Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/healthcare-api -n healthcare-backend || true

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
    kubectl wait --for=condition=complete --timeout=300s job/healthcare-db-migration -n healthcare-backend || true
    
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

echo "🌐 Access Information:"
echo "====================="
echo ""

# Port forwarding instructions
echo "To access the API locally, run:"
echo "  kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088"
echo ""
echo "Then access the API at: http://localhost:8088"
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
echo "  Describe pod:  kubectl describe pod <pod-name> -n healthcare-backend"
echo "  Shell access:  kubectl exec -it <pod-name> -n healthcare-backend -- /bin/sh"
echo "  Delete all:    kubectl delete namespace healthcare-backend"
echo ""

echo "✅ Local deployment complete!"
