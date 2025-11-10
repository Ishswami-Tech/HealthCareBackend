#!/usr/bin/env bash
# Quick fix: Load ConfigMap as environment variables and fix REDIS_URL

set -euo pipefail

echo "🔧 Fixing environment variables for API deployment..."
echo ""

# Update ConfigMap with all required values
echo "   Updating ConfigMap..."
kubectl patch configmap healthcare-api-config -n healthcare-backend --type='merge' \
  -p='{"data":{"API_URL":"http://localhost:8088","SWAGGER_URL":"/docs","BULL_BOARD_URL":"/queue-dashboard","SOCKET_URL":"/socket.io"}}'

echo "✅ ConfigMap updated"
echo ""

# Get deployment JSON
echo "   Checking deployment..."
kubectl get deployment healthcare-api -n healthcare-backend -o json > /tmp/deploy.json

# Add envFrom if not present
if ! jq -e '.spec.template.spec.containers[0].envFrom[]? | select(.configMapRef.name == "healthcare-api-config")' /tmp/deploy.json > /dev/null 2>&1; then
    echo "   Adding envFrom to load ConfigMap..."
    jq '.spec.template.spec.containers[0].envFrom = [{"configMapRef": {"name": "healthcare-api-config"}}]' /tmp/deploy.json | kubectl apply -f -
    echo "   ✅ Added envFrom"
else
    echo "   ✅ ConfigMap already loaded via envFrom"
fi

# Also add REDIS_URL as direct env var if needed
if ! jq -e '.spec.template.spec.containers[0].env[]? | select(.name == "REDIS_URL")' /tmp/deploy.json > /dev/null 2>&1; then
    echo "   Adding REDIS_URL as environment variable..."
    jq '.spec.template.spec.containers[0].env += [{"name": "REDIS_URL", "value": "redis://:redis123@redis:6379"}]' /tmp/deploy.json | kubectl apply -f -
    echo "   ✅ Added REDIS_URL"
fi

rm -f /tmp/deploy.json

# Restart deployment
echo ""
echo "🔄 Restarting deployment..."
kubectl rollout restart deployment/healthcare-api -n healthcare-backend

echo ""
echo "⏳ Waiting for rollout (30 seconds)..."
sleep 30

echo ""
echo "📊 Pod status:"
kubectl get pods -n healthcare-backend -l app=healthcare-api

echo ""
echo "✅ Done! Check logs if pods are still crashing:"
echo "   kubectl logs -n healthcare-backend -l app=healthcare-api --tail=50"

