#!/usr/bin/env bash
# Complete fix for deployment - run this in WSL terminal
# No jq required - uses kubectl patch directly

set -euo pipefail

echo "🔧 Fixing Healthcare API Deployment"
echo "==================================="
echo ""

# Step 1: Update ConfigMap
echo "📝 Step 1: Updating ConfigMap..."
kubectl patch configmap healthcare-api-config -n healthcare-backend --type='merge' \
  -p='{"data":{"API_URL":"http://localhost:8088","SWAGGER_URL":"/docs","BULL_BOARD_URL":"/queue-dashboard","SOCKET_URL":"/socket.io","NODE_ENV":"development","LOG_LEVEL":"debug"}}'

echo "✅ ConfigMap updated"
echo ""

# Step 2: Verify ConfigMap values
echo "📋 Step 2: Verifying ConfigMap..."
kubectl get configmap healthcare-api-config -n healthcare-backend -o jsonpath='{.data.API_URL}' && echo ""
echo "   ✅ ConfigMap values set"
echo ""

# Step 3: Check if envFrom exists in deployment
echo "📦 Step 3: Checking deployment configuration..."
ENVFROM=$(kubectl get deployment healthcare-api -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].envFrom}' 2>/dev/null || echo "")

if [ -z "$ENVFROM" ] || [ "$ENVFROM" = "null" ]; then
    echo "   Adding envFrom to deployment..."
    kubectl patch deployment healthcare-api -n healthcare-backend --type='json' \
      -p='[{"op": "add", "path": "/spec/template/spec/containers/0/envFrom", "value": [{"configMapRef": {"name": "healthcare-api-config"}}]}]'
    echo "   ✅ Added envFrom"
else
    echo "   ✅ envFrom already configured"
    echo "   Current envFrom: $ENVFROM"
fi
echo ""

# Step 4: Fix worker deployment (add AWS_REGION)
echo "👷 Step 4: Fixing worker deployment..."
ENV_VARS=$(kubectl get deployment healthcare-worker -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' 2>/dev/null || echo "")

if echo "$ENV_VARS" | grep -q "AWS_REGION"; then
    echo "   ✅ AWS_REGION already present"
else
    echo "   Adding AWS_REGION to worker..."
    kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' \
      -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "AWS_REGION", "valueFrom": {"secretKeyRef": {"name": "healthcare-secrets", "key": "aws-region"}}}]'
    echo "   ✅ Added AWS_REGION"
fi
echo ""

# Step 5: Restart deployments
echo "🔄 Step 5: Restarting deployments..."
kubectl rollout restart deployment/healthcare-api -n healthcare-backend
kubectl rollout restart deployment/healthcare-worker -n healthcare-backend

echo ""
echo "⏳ Waiting 30 seconds for pods to restart..."
sleep 30

# Step 6: Show status
echo ""
echo "📊 Current Pod Status:"
echo "======================"
kubectl get pods -n healthcare-backend -l app=healthcare-api
echo ""

kubectl get pods -n healthcare-backend -l app=healthcare-worker
echo ""

# Check if any pods are still crashing
CRASHING=$(kubectl get pods -n healthcare-backend -l app=healthcare-api -o jsonpath='{.items[?(@.status.containerStatuses[0].ready==false)].metadata.name}' 2>/dev/null || echo "")

if [ -n "$CRASHING" ]; then
    echo "⚠️  Some pods are still not ready. Checking logs..."
    echo ""
    for pod in $CRASHING; do
        echo "📋 Logs for $pod:"
        kubectl logs -n healthcare-backend "$pod" --tail=20 2>&1 | head -20 || true
        echo ""
    done
else
    echo "✅ All API pods are running!"
fi

echo ""
echo "🌐 To access the API:"
echo "   kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088"
echo ""
