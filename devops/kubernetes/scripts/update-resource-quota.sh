#!/bin/bash
# Script to update resource quota when scaling cluster (horizontal or vertical)
# Usage: ./update-resource-quota.sh <node-count> [cpu-per-node] [ram-per-node-gb]
# Examples:
#   Horizontal scaling: ./update-resource-quota.sh 4 6 12  # 4 nodes, 6 vCPU, 12GB each
#   Vertical scaling:   ./update-resource-quota.sh 3 8 16  # 3 nodes, 8 vCPU, 16GB each
#   Large cluster:      ./update-resource-quota.sh 8 12 24 # 8 nodes, 12 vCPU, 24GB each

set -e

NODE_COUNT=${1:-3}
CPU_PER_NODE=${2:-6}
RAM_PER_NODE_GB=${3:-12}

# Validate inputs
if [ "$NODE_COUNT" -lt 2 ] || [ "$NODE_COUNT" -gt 16 ]; then
  echo "Error: Node count must be between 2 and 16"
  exit 1
fi

if [ "$CPU_PER_NODE" -lt 2 ] || [ "$CPU_PER_NODE" -gt 32 ]; then
  echo "Error: CPU per node must be between 2 and 32"
  exit 1
fi

if [ "$RAM_PER_NODE_GB" -lt 4 ] || [ "$RAM_PER_NODE_GB" -gt 128 ]; then
  echo "Error: RAM per node must be between 4GB and 128GB"
  exit 1
fi

# Calculate totals
TOTAL_CPU=$((NODE_COUNT * CPU_PER_NODE))
TOTAL_RAM=$((NODE_COUNT * RAM_PER_NODE_GB))

# Calculate requests (67% of total - allows 33% headroom for system/kubelet)
REQUESTS_CPU=$(echo "scale=0; $TOTAL_CPU * 0.67" | bc | cut -d. -f1)
REQUESTS_RAM=$(echo "scale=0; $TOTAL_RAM * 0.67" | bc | cut -d. -f1)

# Limits are 100% of total (can use all resources if needed)
LIMITS_CPU=$TOTAL_CPU
LIMITS_RAM="${TOTAL_RAM}Gi"

# Calculate pod limit: (Total vCPU / 2) × 10
# This allows ~10 pods per vCPU (conservative estimate)
POD_LIMIT=$((TOTAL_CPU / 2 * 10))

# Calculate PVC limit: 5 per node (minimum), up to 50 max
PVC_LIMIT=$((NODE_COUNT * 5))
if [ "$PVC_LIMIT" -gt 50 ]; then
  PVC_LIMIT=50
fi

# Calculate service limit: 10 per node (minimum), up to 100 max
SERVICE_LIMIT=$((NODE_COUNT * 10))
if [ "$SERVICE_LIMIT" -gt 100 ]; then
  SERVICE_LIMIT=100
fi

# Determine scaling type
if [ "$CPU_PER_NODE" -gt 6 ] || [ "$RAM_PER_NODE_GB" -gt 12 ]; then
  SCALING_TYPE="vertical"
else
  SCALING_TYPE="horizontal"
fi

echo "=========================================="
echo "Updating Resource Quota"
echo "=========================================="
echo "Nodes: $NODE_COUNT"
echo "Per Node: $CPU_PER_NODE vCPU, ${RAM_PER_NODE_GB}GB RAM"
echo "Scaling Type: $SCALING_TYPE"
echo ""
echo "Total Resources:"
echo "  CPU: $TOTAL_CPU vCPU"
echo "  RAM: ${TOTAL_RAM}GB"
echo ""
echo "Resource Quota:"
echo "  Requests: $REQUESTS_CPU vCPU, ${REQUESTS_RAM}GB RAM (67% of total)"
echo "  Limits: $LIMITS_CPU vCPU, $LIMITS_RAM RAM (100% of total)"
echo "  Pods: $POD_LIMIT max"
echo "  PVCs: $PVC_LIMIT max"
echo "  Services: $SERVICE_LIMIT max"
echo "=========================================="

# Create/update resource quota
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: healthcare-quotas
  namespace: healthcare-backend
  labels:
    app: healthcare-backend
    cluster-size: "${NODE_COUNT}-nodes"
    node-spec: "${CPU_PER_NODE}vCPU-${RAM_PER_NODE_GB}GB"
    scaling-type: "${SCALING_TYPE}"
spec:
  hard:
    requests.cpu: "${REQUESTS_CPU}"
    limits.cpu: "${LIMITS_CPU}"
    requests.memory: "${REQUESTS_RAM}Gi"
    limits.memory: "${LIMITS_RAM}"
    pods: "${POD_LIMIT}"
    persistentvolumeclaims: "${PVC_LIMIT}"
    services: "${SERVICE_LIMIT}"
EOF

echo ""
echo "✅ Resource quota updated successfully!"
echo ""
echo "Current quota status:"
kubectl describe resourcequota healthcare-quotas -n healthcare-backend | grep -A 10 "Resource Quotas:"
echo ""
echo "💡 Next steps:"
echo "   1. Verify HPA maxReplicas supports your cluster size (currently 200)"
echo "   2. Monitor resource usage: kubectl top nodes"
echo "   3. Check pod distribution: kubectl get pods -n healthcare-backend -o wide"

