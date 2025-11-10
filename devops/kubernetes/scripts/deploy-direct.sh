#!/usr/bin/env bash
# Direct deployment script - applies resources without kustomize
# Use this if kustomize is having issues

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_DIR="$K8S_DIR/base"

echo "🚀 Healthcare Backend - Direct Deployment (No Kustomize)"
echo "========================================================="
echo ""

# Apply base resources one by one
echo "📦 Applying base resources..."
cd "$BASE_DIR"

for file in rbac.yaml network-policies.yaml limitrange.yaml resourcequota.yaml configmap.yaml postgres-config.yaml api-deployment.yaml worker-deployment.yaml postgres-statefulset.yaml redis-cluster.yaml init-job.yaml pdb.yaml pgbouncer-configmap.yaml pgbouncer-deployment.yaml; do
    if [ -f "$file" ]; then
        echo "   Applying $file..."
        kubectl apply -f "$file" 2>&1 | grep -v "Warning:" || true
    fi
done

echo ""
echo "✅ Base resources applied"
echo ""

# Apply local patches
echo "🔧 Applying local patches..."
echo ""

# Update ConfigMap for local development
echo "   Updating ConfigMap for local..."
kubectl patch configmap healthcare-api-config -n healthcare-backend --type='merge' -p='{"data":{"API_URL":"http://localhost:8088","NODE_ENV":"development","LOG_LEVEL":"debug","ENABLE_DEBUG":"true","CORS_ORIGIN":"http://localhost:3000,http://localhost:8088"}}' 2>&1 | grep -v "Warning:" || true

# Patch API deployment
echo "   Patching healthcare-api deployment..."
kubectl set image deployment/healthcare-api api=healthcare-api:local -n healthcare-backend 2>&1 | grep -v "Warning:" || true
kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | grep -v "Warning:" || true

# Add API_URL from ConfigMap
kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "API_URL", "valueFrom": {"configMapKeyRef": {"name": "healthcare-api-config", "key": "API_URL"}}}}]' 2>&1 | grep -v "Warning:" || true

kubectl scale deployment healthcare-api --replicas=1 -n healthcare-backend 2>&1 | grep -v "Warning:" || true

# Patch Worker deployment
echo "   Patching healthcare-worker deployment..."
kubectl set image deployment/healthcare-worker worker=healthcare-api:local -n healthcare-backend 2>&1 | grep -v "Warning:" || true
kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]' 2>&1 | grep -v "Warning:" || true

# Add missing AWS region to worker env
kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "AWS_REGION", "valueFrom": {"secretKeyRef": {"name": "healthcare-secrets", "key": "aws-region"}}}}]' 2>&1 | grep -v "Warning:" || true

kubectl scale deployment healthcare-worker --replicas=1 -n healthcare-backend 2>&1 | grep -v "Warning:" || true

# Patch resource limits
echo "   Applying resource limits..."
kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/cpu", "value": "250m"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/memory", "value": "512Mi"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/cpu", "value": "1000m"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/memory", "value": "1Gi"}]' 2>&1 | grep -v "Warning:" || true

kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/cpu", "value": "250m"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/memory", "value": "512Mi"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/cpu", "value": "1000m"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/memory", "value": "1Gi"}]' 2>&1 | grep -v "Warning:" || true

# Scale down pgbouncer for local (not needed)
echo "   Scaling down pgbouncer (not needed for local)..."
kubectl scale deployment pgbouncer --replicas=0 -n healthcare-backend 2>&1 | grep -v "Warning:" || true

# Scale Redis to 1 replica
echo "   Scaling Redis to 1 replica..."
kubectl scale statefulset redis --replicas=1 -n healthcare-backend 2>&1 | grep -v "Warning:" || true

echo ""
echo "✅ Patches applied"
echo ""

# Wait for deployments
echo "⏳ Waiting for deployments..."
kubectl wait --for=condition=available --timeout=300s deployment/healthcare-api -n healthcare-backend 2>/dev/null || true

echo "✅ Deployments ready"
echo ""

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

echo "✅ Deployment complete!"

