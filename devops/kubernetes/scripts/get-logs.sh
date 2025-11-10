#!/usr/bin/env bash
# Get logs from the latest healthcare-api pod

set -uo pipefail

NAMESPACE="healthcare-backend"
APP_LABEL="app=healthcare-api"

echo "📋 Getting latest pod logs..."
echo ""

# Get the latest pod name
POD=$(kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)

if [ -z "$POD" ]; then
    echo "❌ No pods found with label $APP_LABEL"
    exit 1
fi

echo "📦 Latest pod: $POD"
echo ""
echo "📄 Logs (last 80 lines):"
echo "=================================================="
kubectl logs -n "$NAMESPACE" "$POD" --tail=80 2>&1

