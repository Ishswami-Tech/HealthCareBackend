#!/usr/bin/env bash
# Fix secrets and config for local deployment

set -euo pipefail

echo "🔧 Fixing secrets and config for local deployment..."
echo ""

# Delete existing secrets
kubectl delete secret healthcare-secrets -n healthcare-backend 2>/dev/null || true

# Create secrets with all required fields
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
    --dry-run=client -o yaml | kubectl apply -f -

echo "✅ Secrets updated"
echo ""

# Update ConfigMap with required values for local development
# Use ClusterIP directly to bypass DNS issues in k3s (10.43.199.102)
# TODO: Fix DNS resolution issue - CoreDNS might not be working properly
# Note: REDIS_PASSWORD is NOT added to ConfigMap since Redis doesn't require authentication (protected mode disabled)
kubectl patch configmap healthcare-api-config -n healthcare-backend --type='merge' -p='{"data":{"API_URL":"http://localhost:8088","SWAGGER_URL":"/docs","BULL_BOARD_URL":"/queue-dashboard","SOCKET_URL":"/socket.io","NODE_ENV":"development","LOG_LEVEL":"debug","ENABLE_DEBUG":"true","CORS_ORIGIN":"http://localhost:3000,http://localhost:8088","REDIS_HOST":"10.43.199.102","REDIS_COMMANDER_URL":"http://localhost:8081","PRISMA_STUDIO_URL":"/prisma","PGADMIN_URL":"/pgadmin"}}'

# Remove REDIS_PASSWORD from ConfigMap if it exists (Redis doesn't require auth with protected mode disabled)
# Use kubectl patch to remove the key
kubectl patch configmap healthcare-api-config -n healthcare-backend --type=json -p='[{"op":"remove","path":"/data/REDIS_PASSWORD"}]' 2>&1 | grep -v Warning || \
  echo "   Note: REDIS_PASSWORD removed or not present (Redis protected mode disabled)"

echo "✅ ConfigMap updated with local development values"
echo ""

# Load all ConfigMap values as environment variables using envFrom
echo "   Loading ConfigMap values as environment variables..."
# Remove any existing API_URL env var (we'll use envFrom instead)
kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "remove", "path": "/spec/template/spec/containers/0/env", "value": [{"name": "API_URL"}]}]' 2>&1 | grep -v "Warning:" || true

# Add envFrom to load ConfigMap
if ! kubectl get deployment healthcare-api -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].envFrom}' 2>/dev/null | grep -q "healthcare-api-config"; then
    kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "add", "path": "/spec/template/spec/containers/0/envFrom", "value": [{"configMapRef": {"name": "healthcare-api-config"}}]}]' 2>&1 | grep -v "Warning:" || true
    echo "   ConfigMap loaded as envFrom"
else
    echo "   ConfigMap already loaded"
fi

# Add DATABASE_URL and JWT_SECRET from secrets
echo "   Adding DATABASE_URL and JWT_SECRET from secrets..."
kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "DATABASE_URL", "valueFrom": {"secretKeyRef": {"name": "healthcare-secrets", "key": "database-url"}}}}, {"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "JWT_SECRET", "valueFrom": {"secretKeyRef": {"name": "healthcare-secrets", "key": "jwt-secret"}}}}]' 2>&1 | grep -v "Warning:" || true

# Add AWS_REGION to worker if not present
echo "   Adding AWS_REGION to worker deployment..."
# Check if AWS_REGION already exists in env
if ! kubectl get deployment healthcare-worker -n healthcare-backend -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' | grep -q "AWS_REGION"; then
    kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "AWS_REGION", "valueFrom": {"secretKeyRef": {"name": "healthcare-secrets", "key": "aws-region"}}}}]' 2>&1 | grep -v "Warning:" || true
else
    echo "   AWS_REGION already present"
fi

# Restart deployments to pick up changes
echo "🔄 Restarting deployments..."
kubectl rollout restart deployment/healthcare-api -n healthcare-backend
kubectl rollout restart deployment/healthcare-worker -n healthcare-backend

echo "✅ Deployments restarted"
echo ""

# Wait a moment
sleep 5

# Show status
echo "📊 Current pod status:"
kubectl get pods -n healthcare-backend

echo ""
echo "✅ Fix complete! Pods should restart with correct configuration."

