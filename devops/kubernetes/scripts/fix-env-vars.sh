#!/usr/bin/env bash
# Fix environment variables for API deployment
# Loads all ConfigMap values as environment variables

set -euo pipefail

echo "🔧 Fixing environment variables for API deployment..."
echo ""

# Check current deployment
echo "   Checking current deployment..."
CURRENT_ENV=$(kubectl get deployment healthcare-api -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].envFrom}' 2>/dev/null || echo "")

if echo "$CURRENT_ENV" | grep -q "healthcare-api-config"; then
    echo "   ✅ ConfigMap already loaded via envFrom"
else
    echo "   Adding ConfigMap as envFrom..."
    
    # Get current deployment spec
    kubectl get deployment healthcare-api -n healthcare-backend -o json > /tmp/api-deployment.json
    
    # Add envFrom if it doesn't exist
    if ! cat /tmp/api-deployment.json | jq '.spec.template.spec.containers[0] | has("envFrom")' 2>/dev/null | grep -q "true"; then
        # Add envFrom array
        cat /tmp/api-deployment.json | jq '.spec.template.spec.containers[0].envFrom = [{"configMapRef": {"name": "healthcare-api-config"}}]' | kubectl apply -f -
        echo "   ✅ Added envFrom"
    else
        # Check if ConfigMap is already in envFrom
        if ! cat /tmp/api-deployment.json | jq '.spec.template.spec.containers[0].envFrom[] | select(.configMapRef.name == "healthcare-api-config")' 2>/dev/null | grep -q "healthcare-api-config"; then
            # Add ConfigMap to existing envFrom
            cat /tmp/api-deployment.json | jq '.spec.template.spec.containers[0].envFrom += [{"configMapRef": {"name": "healthcare-api-config"}}]' | kubectl apply -f -
            echo "   ✅ Added ConfigMap to envFrom"
        else
            echo "   ✅ ConfigMap already in envFrom"
        fi
    fi
    
    rm -f /tmp/api-deployment.json
fi

# For now, ensure ConfigMap has all required values
echo "   Ensuring ConfigMap has required values..."
kubectl patch configmap healthcare-api-config -n healthcare-backend --type='merge' -p='{"data":{"SWAGGER_URL":"/docs","BULL_BOARD_URL":"/queue-dashboard","SOCKET_URL":"/socket.io","API_URL":"http://localhost:8088"}}' 2>&1 | grep -v "Warning:" || true

echo ""
echo "🔄 Restarting deployment..."
kubectl rollout restart deployment/healthcare-api -n healthcare-backend

echo ""
echo "⏳ Waiting for rollout..."
kubectl rollout status deployment/healthcare-api -n healthcare-backend --timeout=120s 2>&1 || true

echo ""
echo "✅ Done! Check pods:"
kubectl get pods -n healthcare-backend -l app=healthcare-api

