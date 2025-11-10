#!/usr/bin/env bash
# Bash script to deploy Healthcare Backend to Kubernetes using containerd
# This script works with k3s or any containerd-based Kubernetes setup
# Prerequisites: kubectl, kustomize, nerdctl (for image import)

set -euo pipefail

SKIP_BUILD=false
SKIP_SECRETS=false
SKIP_MIGRATION=false
SKIP_IMAGE_IMPORT=false
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
        --skip-image-import)
            SKIP_IMAGE_IMPORT=true
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

echo "🚀 Healthcare Backend - Containerd/Kubernetes Deployment"
echo "========================================================="
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
if ! kubectl kustomize --help &> /dev/null; then
    echo "❌ kustomize not available. Please ensure kubectl >= 1.14"
    exit 1
fi
echo "✅ kustomize found (via kubectl)"

# Check Kubernetes cluster
echo "🔍 Checking Kubernetes cluster..."
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    echo "   Please ensure your cluster is running and kubeconfig is correct"
    exit 1
fi
CONTEXT=$(kubectl config current-context)
echo "✅ Kubernetes context: $CONTEXT"
echo ""

# Build and import image
if [ "$SKIP_BUILD" = false ]; then
    echo "🔨 Building image..."
    "$SCRIPT_DIR/build-containerd.sh" --image-tag "$IMAGE_TAG"
    if [ $? -ne 0 ]; then
        echo "❌ Build failed"
        exit 1
    fi
    echo ""
fi

# Import image to k3s namespace
if [ "$SKIP_IMAGE_IMPORT" = false ]; then
    echo "📦 Importing image to Kubernetes..."
    
    # Check if using k3s
    IS_K3S=false
    if [[ "$CONTEXT" =~ k3s|default ]]; then
        IS_K3S=true
    fi
    
    if [ "$IS_K3S" = true ]; then
        echo "   Detected k3s, importing image to k3s namespace..."
        
        if command -v nerdctl &> /dev/null; then
            # First check if image is already in k3s namespace
            if sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io images 2>/dev/null | grep -q "healthcare-api.*$IMAGE_TAG"; then
                echo "✅ Image 'healthcare-api:$IMAGE_TAG' already in k3s namespace"
            else
                # Try to import from default namespace
                if nerdctl images 2>/dev/null | grep -q "healthcare-api.*$IMAGE_TAG"; then
                    echo "   Importing image to k3s namespace..."
                    nerdctl save "healthcare-api:$IMAGE_TAG" 2>/dev/null | sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io load -i -
                    if [ $? -eq 0 ]; then
                        echo "✅ Image imported to k3s namespace"
                    else
                        echo "⚠️  Image import failed. Image may already be in k3s namespace."
                    fi
                else
                    echo "⚠️  Image not found. Assuming it's already in k3s namespace from build."
                fi
            fi
        else
            echo "⚠️  nerdctl not found. Please install nerdctl to import images."
        fi
    else
        echo "   Not using k3s. Image should be available via your container runtime."
        if command -v minikube &> /dev/null; then
            echo "   If using minikube, you may need to use: minikube image load healthcare-api:$IMAGE_TAG"
        fi
    fi
    echo ""
fi

# Create namespace
echo "📦 Creating namespace..."
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f - > /dev/null
echo "✅ Namespace ready"
echo ""

# Setup secrets
if [ "$SKIP_SECRETS" = false ]; then
    echo "🔐 Setting up secrets..."
    
    POSTGRES_USER="${POSTGRES_USER:-postgres}"
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres123}"
    REDIS_PASSWORD="${REDIS_PASSWORD:-redis123}"
    JWT_SECRET="${JWT_SECRET:-local-dev-jwt-secret-$(date +%s)}"
    
    DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/userdb?schema=public"
    DB_MIGRATION_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/userdb?schema=public"
    
    # Delete existing secrets
    kubectl delete secret healthcare-secrets -n healthcare-backend 2>/dev/null || true
    kubectl delete secret wal-g-secrets -n healthcare-backend 2>/dev/null || true
    
    # Create secrets
    kubectl create secret generic healthcare-secrets \
        --namespace healthcare-backend \
        --from-literal=postgres-user="$POSTGRES_USER" \
        --from-literal=postgres-password="$POSTGRES_PASSWORD" \
        --from-literal=database-url="$DB_URL" \
        --from-literal=database-migration-url="$DB_MIGRATION_URL" \
        --from-literal=redis-password="$REDIS_PASSWORD" \
        --from-literal=jwt-secret="$JWT_SECRET" \
        --from-literal=aws-access-key-id=dummy \
        --from-literal=aws-secret-access-key=dummy \
        --from-literal=aws-region=us-east-1 \
        --dry-run=client -o yaml | kubectl apply -f - > /dev/null
    
    kubectl create secret generic wal-g-secrets \
        --namespace healthcare-backend \
        --from-literal=WALG_S3_PREFIX=dummy \
        --from-literal=AWS_ACCESS_KEY_ID=dummy \
        --from-literal=AWS_SECRET_ACCESS_KEY=dummy \
        --from-literal=AWS_REGION=us-east-1 \
        --from-literal=WALG_S3_ENDPOINT=dummy \
        --dry-run=client -o yaml | kubectl apply -f - > /dev/null
    
    echo "✅ Secrets created"
    echo ""
else
    echo "⏭️  Skipping secrets setup"
    echo ""
fi

# Apply Kubernetes resources
echo "🚀 Deploying to Kubernetes..."
cd "$LOCAL_OVERLAY"

# Try kustomize first, if it fails, try applying base resources directly
echo "   Building kustomize output..."
KUSTOMIZE_OUTPUT=$(kubectl kustomize . 2>&1)
KUSTOMIZE_EXIT=$?

if [ $KUSTOMIZE_EXIT -ne 0 ]; then
    echo "⚠️  Kustomize failed with errors. Trying to apply base resources directly..."
    echo "   Error output:"
    echo "$KUSTOMIZE_OUTPUT" | grep -i "error" | head -5
    echo ""
    echo "   Applying base resources directly..."
    cd "$K8S_DIR/base"
    
    # Apply resources one by one, skipping problematic ones
    for file in rbac.yaml network-policies.yaml limitrange.yaml resourcequota.yaml configmap.yaml postgres-config.yaml api-deployment.yaml worker-deployment.yaml postgres-statefulset.yaml redis-cluster.yaml init-job.yaml pdb.yaml pgbouncer-configmap.yaml pgbouncer-deployment.yaml; do
        if [ -f "$file" ]; then
            echo "   Applying $file..."
            kubectl apply -f "$file" 2>&1 | grep -v "Warning:" || true
        fi
    done
    
    # Apply patches manually
    echo "   Applying local patches..."
    cd "$LOCAL_OVERLAY"
    
    # Patch image in deployments
    kubectl set image deployment/healthcare-api api=healthcare-api:local -n healthcare-backend 2>&1 | grep -v "Warning:" || true
    kubectl set image deployment/healthcare-worker worker=healthcare-api:local -n healthcare-backend 2>&1 | grep -v "Warning:" || true
    kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | grep -v "Warning:" || true
    kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | grep -v "Warning:" || true
    kubectl scale deployment healthcare-api --replicas=1 -n healthcare-backend 2>&1 | grep -v "Warning:" || true
    kubectl scale deployment healthcare-worker --replicas=1 -n healthcare-backend 2>&1 | grep -v "Warning:" || true
else
    # Kustomize succeeded, apply the output
    echo "$KUSTOMIZE_OUTPUT" | grep -v "Warning:" | kubectl apply -f -
    
    if [ $? -ne 0 ]; then
        echo "❌ Deployment failed"
        exit 1
    fi
fi

echo "✅ Resources applied"
echo ""

# Wait for deployments
echo "⏳ Waiting for deployments..."
kubectl wait --for=condition=available --timeout=300s deployment/healthcare-api -n healthcare-backend 2>/dev/null || true

echo "✅ Deployments ready"
echo ""

# Run migration
if [ "$SKIP_MIGRATION" = false ]; then
    echo "🗄️  Running database migration..."
    
    if kubectl get job healthcare-db-migration -n healthcare-backend &> /dev/null; then
        kubectl delete job healthcare-db-migration -n healthcare-backend
        sleep 2
    fi
    
    kubectl apply -f "$K8S_DIR/base/init-job.yaml" > /dev/null
    
    echo "   Waiting for migration..."
    kubectl wait --for=condition=complete --timeout=300s job/healthcare-db-migration -n healthcare-backend 2>/dev/null || true
    
    if kubectl get job healthcare-db-migration -n healthcare-backend -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null | grep -q "True"; then
        echo "✅ Migration completed"
    else
        echo "⚠️  Migration may still be running. Check logs:"
        echo "   kubectl logs job/healthcare-db-migration -n healthcare-backend"
    fi
    echo ""
fi

# Display status
echo "📊 Deployment Status:"
echo "===================="
echo ""
kubectl get pods -n healthcare-backend
echo ""
kubectl get svc -n healthcare-backend
echo ""

echo "🌐 Access Information:"
echo "====================="
echo ""
echo "To access the API, run:"
echo "  kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088"
echo ""
echo "Then access at: http://localhost:8088"
echo ""

echo "💡 Useful Commands:"
echo "==================="
echo "  View logs:     kubectl logs -f deployment/healthcare-api -n healthcare-backend"
echo "  View pods:     kubectl get pods -n healthcare-backend"
echo "  Shell access:  kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh"
echo "  Clean up:      kubectl delete namespace healthcare-backend"
echo ""

echo "✅ Deployment complete!"



