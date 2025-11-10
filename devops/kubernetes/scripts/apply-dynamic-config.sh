#!/bin/bash

# Apply Dynamic Configuration from ConfigMap
# Reads values from ConfigMap and applies to all deployments

set -e

NAMESPACE="${1:-healthcare-backend}"

echo "🚀 Applying Dynamic Configuration from ConfigMap..."

# Check if ConfigMap exists
if ! kubectl get configmap cluster-resource-config -n "$NAMESPACE" &> /dev/null; then
    echo "❌ ConfigMap 'cluster-resource-config' not found!"
    echo "   Run: ./devops/kubernetes/scripts/calculate-cluster-config.ps1 -NewTier vps20 -NodeCount 3"
    exit 1
fi

# Read values from ConfigMap
POSTGRES_MAX_CONNECTIONS=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_MAX_CONNECTIONS}')
POSTGRES_SHARED_BUFFERS=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_SHARED_BUFFERS}')
POSTGRES_EFFECTIVE_CACHE=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_EFFECTIVE_CACHE_SIZE}')
POSTGRES_RAM_GB=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_RAM_GB}')
POSTGRES_VCPU=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_VCPU}')

API_DB_POOL_MAX=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.API_DB_POOL_MAX}')
API_DB_POOL_MIN=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.API_DB_POOL_MIN}')
API_POD_RAM_MB=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.API_POD_RAM_MB}')
API_POD_VCPU=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.API_POD_VCPU}')

WORKER_DB_POOL_MAX=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.WORKER_DB_POOL_MAX}')
WORKER_DB_POOL_MIN=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.WORKER_DB_POOL_MIN}')
WORKER_POD_RAM_MB=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.WORKER_POD_RAM_MB}')
WORKER_POD_VCPU=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.WORKER_POD_VCPU}')

API_HPA_MAX=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.API_HPA_MAX_REPLICAS}')
API_HPA_MIN=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.API_HPA_MIN_REPLICAS}')
WORKER_HPA_MAX=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.WORKER_HPA_MAX_REPLICAS}')
WORKER_HPA_MIN=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.WORKER_HPA_MIN_REPLICAS}')

# Resource Quota values
REQUESTS_CPU=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.REQUESTS_CPU}')
REQUESTS_MEMORY_GB=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.REQUESTS_MEMORY_GB}')
LIMITS_CPU=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.LIMITS_CPU}')
LIMITS_MEMORY_GB=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.LIMITS_MEMORY_GB}')
MAX_PODS=$(kubectl get configmap cluster-resource-config -n "$NAMESPACE" -o jsonpath='{.data.MAX_PODS}')

echo "📊 Configuration from ConfigMap:"
echo "  PostgreSQL: ${POSTGRES_RAM_GB}GB RAM, ${POSTGRES_VCPU} vCPU, $POSTGRES_MAX_CONNECTIONS max connections"
echo "  API Pool: $API_DB_POOL_MIN-$API_DB_POOL_MAX"
echo "  Worker Pool: $WORKER_DB_POOL_MIN-$WORKER_DB_POOL_MAX"
echo "  API HPA: $API_HPA_MIN-$API_HPA_MAX"
echo "  Worker HPA: $WORKER_HPA_MIN-$WORKER_HPA_MAX"
echo "  Resource Quota: ${REQUESTS_CPU} vCPU / ${REQUESTS_MEMORY_GB}GB requests, ${LIMITS_CPU} vCPU / ${LIMITS_MEMORY_GB}GB limits, $MAX_PODS max pods"
echo ""

# Update Resource Quota
echo "📋 Updating Resource Quota..."
kubectl patch resourcequota healthcare-quotas -n "$NAMESPACE" --type='json' \
  -p="[
    {\"op\": \"replace\", \"path\": \"/spec/hard/requests.cpu\", \"value\": \"$REQUESTS_CPU\"},
    {\"op\": \"replace\", \"path\": \"/spec/hard/requests.memory\", \"value\": \"${REQUESTS_MEMORY_GB}Gi\"},
    {\"op\": \"replace\", \"path\": \"/spec/hard/limits.cpu\", \"value\": \"$LIMITS_CPU\"},
    {\"op\": \"replace\", \"path\": \"/spec/hard/limits.memory\", \"value\": \"${LIMITS_MEMORY_GB}Gi\"},
    {\"op\": \"replace\", \"path\": \"/spec/hard/pods\", \"value\": \"$MAX_PODS\"}
  ]" || echo "⚠️  Resource Quota not found, creating..."

# If ResourceQuota doesn't exist, create it
if ! kubectl get resourcequota healthcare-quotas -n "$NAMESPACE" &> /dev/null; then
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: healthcare-quotas
  namespace: $NAMESPACE
spec:
  hard:
    requests.cpu: "$REQUESTS_CPU"
    requests.memory: ${REQUESTS_MEMORY_GB}Gi
    limits.cpu: "$LIMITS_CPU"
    limits.memory: ${LIMITS_MEMORY_GB}Gi
    pods: "$MAX_PODS"
EOF
fi

# Update PostgreSQL
echo "🐘 Updating PostgreSQL..."
kubectl patch statefulset postgres -n "$NAMESPACE" --type='json' \
  -p="[
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/requests/memory\", \"value\": \"${POSTGRES_RAM_GB}Gi\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/requests/cpu\", \"value\": \"${POSTGRES_VCPU}\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/limits/memory\", \"value\": \"${POSTGRES_RAM_GB}Gi\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/limits/cpu\", \"value\": \"${POSTGRES_VCPU}\"}
  ]" || echo "⚠️  PostgreSQL not found, skipping..."

kubectl set env statefulset/postgres -n "$NAMESPACE" \
  POSTGRES_MAX_CONNECTIONS="$POSTGRES_MAX_CONNECTIONS" \
  POSTGRES_SHARED_BUFFERS="$POSTGRES_SHARED_BUFFERS" \
  POSTGRES_EFFECTIVE_CACHE_SIZE="$POSTGRES_EFFECTIVE_CACHE" || echo "⚠️  Could not set PostgreSQL env vars"

# Update API deployment
echo "🌐 Updating API deployment..."
kubectl patch deployment healthcare-api -n "$NAMESPACE" --type='json' \
  -p="[
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/requests/memory\", \"value\": \"${API_POD_RAM_MB}Mi\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/requests/cpu\", \"value\": \"${API_POD_VCPU}\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/limits/memory\", \"value\": \"${API_POD_RAM_MB}Mi\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/limits/cpu\", \"value\": \"${API_POD_VCPU}\"}
  ]" || echo "⚠️  API deployment not found, skipping..."

kubectl set env deployment/healthcare-api -n "$NAMESPACE" \
  DB_POOL_MAX="$API_DB_POOL_MAX" \
  DB_POOL_MIN="$API_DB_POOL_MIN" || echo "⚠️  Could not set API env vars"

# Update Worker deployment
echo "⚙️  Updating Worker deployment..."
kubectl patch deployment healthcare-worker -n "$NAMESPACE" --type='json' \
  -p="[
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/requests/memory\", \"value\": \"${WORKER_POD_RAM_MB}Mi\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/requests/cpu\", \"value\": \"${WORKER_POD_VCPU}\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/limits/memory\", \"value\": \"${WORKER_POD_RAM_MB}Mi\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/resources/limits/cpu\", \"value\": \"${WORKER_POD_VCPU}\"}
  ]" || echo "⚠️  Worker deployment not found, skipping..."

kubectl set env deployment/healthcare-worker -n "$NAMESPACE" \
  DB_POOL_MAX="$WORKER_DB_POOL_MAX" \
  DB_POOL_MIN="$WORKER_DB_POOL_MIN" || echo "⚠️  Could not set Worker env vars"

# Update HPA
echo "📈 Updating HPA..."
kubectl patch hpa healthcare-api-hpa -n "$NAMESPACE" --type='json' \
  -p="[
    {\"op\": \"replace\", \"path\": \"/spec/minReplicas\", \"value\": $API_HPA_MIN},
    {\"op\": \"replace\", \"path\": \"/spec/maxReplicas\", \"value\": $API_HPA_MAX}
  ]" || echo "⚠️  API HPA not found, skipping..."

kubectl patch hpa healthcare-worker-hpa -n "$NAMESPACE" --type='json' \
  -p="[
    {\"op\": \"replace\", \"path\": \"/spec/minReplicas\", \"value\": $WORKER_HPA_MIN},
    {\"op\": \"replace\", \"path\": \"/spec/maxReplicas\", \"value\": $WORKER_HPA_MAX}
  ]" || echo "⚠️  Worker HPA not found, skipping..."

echo ""
echo "✅ Dynamic configuration applied successfully!"
echo ""
echo "📊 Updated Components:"
echo "  ✅ Resource Quota (requests: ${REQUESTS_CPU} vCPU / ${REQUESTS_MEMORY_GB}GB, limits: ${LIMITS_CPU} vCPU / ${LIMITS_MEMORY_GB}GB, max pods: $MAX_PODS)"
echo "  ✅ PostgreSQL (max_connections: $POSTGRES_MAX_CONNECTIONS)"
echo "  ✅ API Deployment (DB pool: $API_DB_POOL_MIN-$API_DB_POOL_MAX)"
echo "  ✅ Worker Deployment (DB pool: $WORKER_DB_POOL_MIN-$WORKER_DB_POOL_MAX)"
echo "  ✅ API HPA (replicas: $API_HPA_MIN-$API_HPA_MAX)"
echo "  ✅ Worker HPA (replicas: $WORKER_HPA_MIN-$WORKER_HPA_MAX)"
echo ""
echo "🔍 Verify with:"
echo "   kubectl get configmap cluster-resource-config -n $NAMESPACE -o yaml"
echo "   kubectl get resourcequota healthcare-quotas -n $NAMESPACE -o yaml"
echo "   kubectl get hpa -n $NAMESPACE"
echo "   kubectl top nodes"

