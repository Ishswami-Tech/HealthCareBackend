#!/usr/bin/env bash
# Script to deploy Jitsi Meet to Kubernetes cluster

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../base" && pwd)"
SECRETS_FILE="$BASE_DIR/secrets.yaml"

echo "🚀 Deploying Jitsi Meet to Kubernetes..."

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if connected to cluster
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Not connected to Kubernetes cluster"
    echo "   Please configure kubectl to connect to your cluster"
    exit 1
fi

# Check if namespace exists
if ! kubectl get namespace healthcare-backend &> /dev/null; then
    echo "   Creating namespace..."
    kubectl create namespace healthcare-backend
fi

# Check if secrets exist
if [ ! -f "$SECRETS_FILE" ]; then
    echo "⚠️  Warning: secrets.yaml not found at: $SECRETS_FILE"
    echo "   Generating Jitsi secrets..."
    "$SCRIPT_DIR/generate-jitsi-secrets.sh"
fi

# Apply secrets first
echo "   Applying secrets..."
kubectl apply -f "$SECRETS_FILE" || {
    echo "❌ Failed to apply secrets"
    exit 1
}

# Apply Jitsi deployment
echo "   Deploying Jitsi services..."
kubectl apply -f "$BASE_DIR/jitsi-deployment.yaml" || {
    echo "❌ Failed to deploy Jitsi services"
    exit 1
}

# Wait for deployments to be ready
echo "   Waiting for Jitsi pods to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/jitsi-prosody -n healthcare-backend || true
kubectl wait --for=condition=available --timeout=300s deployment/jitsi-web -n healthcare-backend || true
kubectl wait --for=condition=available --timeout=300s deployment/jitsi-jicofo -n healthcare-backend || true
kubectl wait --for=condition=available --timeout=300s deployment/jitsi-jvb -n healthcare-backend || true

# Show pod status
echo ""
echo "📊 Jitsi Pod Status:"
kubectl get pods -n healthcare-backend -l app=jitsi

echo ""
echo "📊 Jitsi Services:"
kubectl get svc -n healthcare-backend -l app=jitsi

echo ""
echo "✅ Jitsi Meet deployment completed!"
echo ""
echo "📋 Next steps:"
echo "   1. Configure DNS: Point meet.ishswami.in to your cluster IP"
echo "   2. Open firewall: Ensure UDP port 30000 is open for RTP traffic"
echo "   3. Test: Visit https://meet.ishswami.in"
echo ""
echo "🔍 To check logs:"
echo "   kubectl logs -f deployment/jitsi-web -n healthcare-backend"
echo "   kubectl logs -f deployment/jitsi-jvb -n healthcare-backend"
