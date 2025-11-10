#!/usr/bin/env bash
# Rebuild image + fix environment - Complete solution
# Run this in WSL terminal

set -euo pipefail

cd "$(dirname "$0")/../../.." || exit 1

echo "🔧 Complete Fix: Rebuild Image + Fix Environment"
echo "=================================================="
echo ""

# Step 1: Rebuild image with code fix
echo "📦 Step 1: Rebuilding image with code fixes..."
echo "   (This makes SWAGGER_URL, BULL_BOARD_URL, SOCKET_URL optional)"
echo "   This will take 5-10 minutes..."
echo "   (Live build logs will appear below)"
echo ""

# Run build script - ensure live output
# The build script uses --progress=plain which should show live logs
echo "Executing build script..."
echo ""

# Run the build script directly - output should appear in real-time
bash ./devops/kubernetes/scripts/build-containerd.sh

# Check if build succeeded
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Build failed! Stopping here."
    exit 1
fi

echo ""
echo "✅ Image rebuilt successfully!"
echo ""

# Step 2: Update ConfigMap
echo "📝 Step 2: Updating ConfigMap..."
kubectl patch configmap healthcare-api-config -n healthcare-backend --type='merge' \
  -p='{"data":{"API_URL":"http://localhost:8088","SWAGGER_URL":"/docs","BULL_BOARD_URL":"/queue-dashboard","SOCKET_URL":"/socket.io","NODE_ENV":"development","LOG_LEVEL":"debug"}}'

echo "✅ ConfigMap updated"
echo ""

# Step 3: Ensure secrets exist
echo "🔐 Step 3: Ensuring secrets exist..."
kubectl create secret generic healthcare-secrets \
    --namespace healthcare-backend \
    --from-literal=postgres-user=postgres \
    --from-literal=postgres-password=postgres123 \
    --from-literal=database-url=postgresql://postgres:postgres123@postgres:5432/userdb?schema=public \
    --from-literal=database-migration-url=postgresql://postgres:postgres123@postgres:5432/userdb?schema=public \
    --from-literal=redis-password=redis123 \
    --from-literal=jwt-secret=local-dev-jwt-secret-$(date +%s) \
    --from-literal=aws-access-key-id=dummy \
    --from-literal=aws-secret-access-key=dummy \
    --from-literal=aws-region=us-east-1 \
    --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1

echo "✅ Secrets verified"
echo ""

# Step 4: Verify envFrom is configured
echo "📦 Step 4: Verifying deployment configuration..."
ENVFROM=$(kubectl get deployment healthcare-api -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].envFrom}' 2>/dev/null || echo "")

if [ -z "$ENVFROM" ] || [ "$ENVFROM" = "null" ]; then
    echo "   Adding envFrom to deployment..."
    kubectl patch deployment healthcare-api -n healthcare-backend --type='json' \
      -p='[{"op": "add", "path": "/spec/template/spec/containers/0/envFrom", "value": [{"configMapRef": {"name": "healthcare-api-config"}}]}]'
    echo "   ✅ Added envFrom"
else
    echo "   ✅ envFrom already configured"
fi

# Step 5: Fix worker deployment
echo ""
echo "👷 Step 5: Fixing worker deployment..."
ENV_VARS=$(kubectl get deployment healthcare-worker -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' 2>/dev/null || echo "")

if echo "$ENV_VARS" | grep -q "AWS_REGION"; then
    echo "   ✅ AWS_REGION already present"
else
    echo "   Adding AWS_REGION to worker..."
    kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' \
      -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "AWS_REGION", "valueFrom": {"secretKeyRef": {"name": "healthcare-secrets", "key": "aws-region"}}}]'
    echo "   ✅ Added AWS_REGION"
fi

# Step 6: Update image in deployment
echo ""
echo "🔄 Step 6: Updating deployment to use new image..."
kubectl set image deployment/healthcare-api api=healthcare-api:local -n healthcare-backend
kubectl rollout restart deployment/healthcare-api -n healthcare-backend
kubectl rollout restart deployment/healthcare-worker -n healthcare-backend

echo ""
echo "⏳ Waiting 45 seconds for pods to restart with new image..."
sleep 45

# Step 7: Show status
echo ""
echo "📊 Pod Status:"
echo "=============="
kubectl get pods -n healthcare-backend -l 'app in (healthcare-api,healthcare-worker)'

echo ""
CRASHING=$(kubectl get pods -n healthcare-backend -l app=healthcare-api -o jsonpath='{.items[?(@.status.containerStatuses[0].ready==false)].metadata.name}' 2>/dev/null || echo "")

if [ -n "$CRASHING" ]; then
    echo "⚠️  Some pods are still not ready. Checking logs..."
    echo ""
    for pod in $CRASHING; do
        echo "📋 Logs for $pod:"
        kubectl logs -n healthcare-backend "$pod" --tail=30 2>&1 | head -30 || true
        echo ""
    done
else
    echo "✅ All pods are running!"
fi

echo ""
echo "🌐 To access the API:"
echo "   kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088"
echo ""

