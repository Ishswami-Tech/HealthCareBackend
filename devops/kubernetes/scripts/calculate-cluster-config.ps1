# PowerShell Script for Dynamic Cluster Configuration
# Works on Windows and cross-platform

param(
    [Parameter(Mandatory=$false)]
    [string]$CurrentTier = "vps10",
    
    [Parameter(Mandatory=$false)]
    [string]$NewTier = "vps10",
    
    [Parameter(Mandatory=$false)]
    [int]$NodeCount = 3,
    
    [Parameter(Mandatory=$false)]
    [string]$Namespace = "healthcare-backend"
)

Write-Host "🔄 Cluster Configuration Calculator" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Current Tier: $CurrentTier"
Write-Host "New Tier: $NewTier"
Write-Host "Node Count: $NodeCount"
Write-Host ""

# Tier configurations
$tierConfigs = @{
    "vps10" = @{ VCPU = 4; RAM_GB = 8 }
    "vps20" = @{ VCPU = 6; RAM_GB = 12 }
    "vps30" = @{ VCPU = 8; RAM_GB = 24 }
    "vps40" = @{ VCPU = 12; RAM_GB = 48 }
    "vps50" = @{ VCPU = 16; RAM_GB = 64 }
    "vps60" = @{ VCPU = 18; RAM_GB = 96 }
}

# Get tier config
if (-not $tierConfigs.ContainsKey($NewTier)) {
    Write-Host "❌ Unknown tier: $NewTier" -ForegroundColor Red
    Write-Host "Available tiers: $($tierConfigs.Keys -join ', ')" -ForegroundColor Yellow
    exit 1
}

$tier = $tierConfigs[$NewTier]
$NODE_VCPU = $tier.VCPU
$NODE_RAM_GB = $tier.RAM_GB

# Calculate totals
$TOTAL_VCPU = $NODE_VCPU * $NodeCount
$TOTAL_RAM_GB = $NODE_RAM_GB * $NodeCount

# PostgreSQL resources (30% of node resources, capped)
$POSTGRES_RAM_GB = [Math]::Min([Math]::Round($NODE_RAM_GB * 0.3, 1), 12)
$POSTGRES_VCPU = [Math]::Min([Math]::Round($NODE_VCPU * 0.3, 1), 6)

# PostgreSQL max connections: min(RAM_GB * 10, vCPU * 40, 200)
$calc1 = [int]($POSTGRES_RAM_GB * 10)
$calc2 = [int]($POSTGRES_VCPU * 40)
$POSTGRES_MAX_CONNECTIONS = [Math]::Min([Math]::Min($calc1, $calc2), 200)

# PostgreSQL shared buffers (25% of RAM in MB)
$POSTGRES_SHARED_BUFFERS_MB = [int]($POSTGRES_RAM_GB * 1024 / 4)
$POSTGRES_SHARED_BUFFERS = "${POSTGRES_SHARED_BUFFERS_MB}MB"

# PostgreSQL effective cache (70% of RAM)
$POSTGRES_EFFECTIVE_CACHE_GB = [Math]::Round($POSTGRES_RAM_GB * 0.7, 1)
$POSTGRES_EFFECTIVE_CACHE = "${POSTGRES_EFFECTIVE_CACHE_GB}GB"

# Redis resources (4% of node RAM per node)
$REDIS_RAM_GB_PER_NODE = [Math]::Round($NODE_RAM_GB * 0.04, 1)
$REDIS_VCPU_PER_NODE = [Math]::Round($NODE_VCPU * 0.1, 2)

# API Pod resources
$API_POD_RAM_MB = 2048
$API_POD_VCPU = 2
$API_DB_POOL_MAX = [Math]::Min([int]($TOTAL_VCPU * 2), 200)
$API_DB_POOL_MIN = [Math]::Max([int]($API_DB_POOL_MAX / 5), 5)

# Worker Pod resources
$WORKER_POD_RAM_MB = 2048
$WORKER_POD_VCPU = 2
$WORKER_DB_POOL_MAX = [Math]::Min([int]($TOTAL_VCPU * 1.5), 200)
$WORKER_DB_POOL_MIN = [Math]::Max([int]($WORKER_DB_POOL_MAX / 6), 3)

# HPA settings
$API_HPA_MAX_REPLICAS = [int](($TOTAL_VCPU / $API_POD_VCPU) * 0.8)
$API_HPA_MIN_REPLICAS = $NodeCount + 1
$WORKER_HPA_MAX_REPLICAS = [int](($TOTAL_VCPU / $WORKER_POD_VCPU) * 0.6)
$WORKER_HPA_MIN_REPLICAS = $NodeCount

# Display calculated values
Write-Host "📊 Calculated Configuration:" -ForegroundColor Green
Write-Host "  Total vCPU: $TOTAL_VCPU"
Write-Host "  Total RAM: ${TOTAL_RAM_GB}GB"
Write-Host "  PostgreSQL: ${POSTGRES_RAM_GB}GB RAM, ${POSTGRES_VCPU} vCPU, $POSTGRES_MAX_CONNECTIONS max connections"
Write-Host "  PostgreSQL Shared Buffers: $POSTGRES_SHARED_BUFFERS"
Write-Host "  PostgreSQL Effective Cache: $POSTGRES_EFFECTIVE_CACHE"
Write-Host "  API DB Pool: $API_DB_POOL_MIN-$API_DB_POOL_MAX"
Write-Host "  Worker DB Pool: $WORKER_DB_POOL_MIN-$WORKER_DB_POOL_MAX"
Write-Host "  API HPA: $API_HPA_MIN_REPLICAS-$API_HPA_MAX_REPLICAS"
Write-Host "  Worker HPA: $WORKER_HPA_MIN_REPLICAS-$WORKER_HPA_MAX_REPLICAS"
Write-Host ""

# Calculate Resource Quota values
$REQUESTS_CPU = [int]($TOTAL_VCPU * 0.67)  # 67% of total vCPU
$REQUESTS_MEMORY_GB = [int]($TOTAL_RAM_GB * 0.67)  # 67% of total RAM
$LIMITS_CPU = $TOTAL_VCPU  # 100% of total vCPU
$LIMITS_MEMORY_GB = $TOTAL_RAM_GB  # 100% of total RAM
$MAX_PODS = [int](($TOTAL_VCPU / 2) * 10)  # Reasonable pod limit

# Create ConfigMap
Write-Host "📝 Creating/Updating ConfigMap..." -ForegroundColor Yellow

$configMapYaml = @"
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-resource-config
  namespace: $Namespace
data:
  CLUSTER_TIER: "$NewTier"
  NODE_VCPU: "$NODE_VCPU"
  NODE_RAM_GB: "$NODE_RAM_GB"
  NODE_COUNT: "$NodeCount"
  TOTAL_VCPU: "$TOTAL_VCPU"
  TOTAL_RAM_GB: "$TOTAL_RAM_GB"
  POSTGRES_RAM_GB: "$POSTGRES_RAM_GB"
  POSTGRES_VCPU: "$POSTGRES_VCPU"
  POSTGRES_MAX_CONNECTIONS: "$POSTGRES_MAX_CONNECTIONS"
  POSTGRES_SHARED_BUFFERS: "$POSTGRES_SHARED_BUFFERS"
  POSTGRES_EFFECTIVE_CACHE_SIZE: "$POSTGRES_EFFECTIVE_CACHE"
  REDIS_RAM_GB_PER_NODE: "$REDIS_RAM_GB_PER_NODE"
  REDIS_VCPU_PER_NODE: "$REDIS_VCPU_PER_NODE"
  API_POD_RAM_MB: "$API_POD_RAM_MB"
  API_POD_VCPU: "$API_POD_VCPU"
  API_DB_POOL_MAX: "$API_DB_POOL_MAX"
  API_DB_POOL_MIN: "$API_DB_POOL_MIN"
  WORKER_POD_RAM_MB: "$WORKER_POD_RAM_MB"
  WORKER_POD_VCPU: "$WORKER_POD_VCPU"
  WORKER_DB_POOL_MAX: "$WORKER_DB_POOL_MAX"
  WORKER_DB_POOL_MIN: "$WORKER_DB_POOL_MIN"
  API_HPA_MAX_REPLICAS: "$API_HPA_MAX_REPLICAS"
  API_HPA_MIN_REPLICAS: "$API_HPA_MIN_REPLICAS"
  WORKER_HPA_MAX_REPLICAS: "$WORKER_HPA_MAX_REPLICAS"
  WORKER_HPA_MIN_REPLICAS: "$WORKER_HPA_MIN_REPLICAS"
  REQUESTS_CPU: "$REQUESTS_CPU"
  REQUESTS_MEMORY_GB: "$REQUESTS_MEMORY_GB"
  LIMITS_CPU: "$LIMITS_CPU"
  LIMITS_MEMORY_GB: "$LIMITS_MEMORY_GB"
  MAX_PODS: "$MAX_PODS"
"@

$configMapYaml | kubectl apply -f -

Write-Host "✅ ConfigMap updated!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Resource Quota Configuration:" -ForegroundColor Cyan
Write-Host "  Requests CPU: $REQUESTS_CPU (67% of $TOTAL_VCPU vCPU)"
Write-Host "  Requests Memory: ${REQUESTS_MEMORY_GB}GB (67% of ${TOTAL_RAM_GB}GB)"
Write-Host "  Limits CPU: $LIMITS_CPU (100% of $TOTAL_VCPU vCPU)"
Write-Host "  Limits Memory: ${LIMITS_MEMORY_GB}GB (100% of ${TOTAL_RAM_GB}GB)"
Write-Host "  Max Pods: $MAX_PODS"
Write-Host ""
Write-Host "🚀 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Update Resource Quota: kubectl patch resourcequota healthcare-quotas -n $Namespace --type='json' -p='[{\"op\": \"replace\", \"path\": \"/spec/hard/requests.cpu\", \"value\": \"$REQUESTS_CPU\"}, {\"op\": \"replace\", \"path\": \"/spec/hard/requests.memory\", \"value\": \"${REQUESTS_MEMORY_GB}Gi\"}, {\"op\": \"replace\", \"path\": \"/spec/hard/limits.cpu\", \"value\": \"$LIMITS_CPU\"}, {\"op\": \"replace\", \"path\": \"/spec/hard/limits.memory\", \"value\": \"${LIMITS_MEMORY_GB}Gi\"}, {\"op\": \"replace\", \"path\": \"/spec/hard/pods\", \"value\": \"$MAX_PODS\"}]'"
Write-Host "  2. Update PostgreSQL: kubectl set env statefulset/postgres -n $Namespace POSTGRES_MAX_CONNECTIONS=$POSTGRES_MAX_CONNECTIONS POSTGRES_SHARED_BUFFERS=$POSTGRES_SHARED_BUFFERS POSTGRES_EFFECTIVE_CACHE_SIZE=$POSTGRES_EFFECTIVE_CACHE"
Write-Host "  3. Update API: kubectl set env deployment/healthcare-api -n $Namespace DB_POOL_MAX=$API_DB_POOL_MAX DB_POOL_MIN=$API_DB_POOL_MIN"
Write-Host "  4. Update Workers: kubectl set env deployment/healthcare-worker -n $Namespace DB_POOL_MAX=$WORKER_DB_POOL_MAX DB_POOL_MIN=$WORKER_DB_POOL_MIN"
Write-Host "  5. Update HPA: kubectl patch hpa healthcare-api-hpa -n $Namespace --type='json' -p='[{\"op\": \"replace\", \"path\": \"/spec/maxReplicas\", \"value\": $API_HPA_MAX_REPLICAS}]'"
Write-Host ""
Write-Host "Or run: ./devops/kubernetes/scripts/apply-dynamic-config.sh to apply all changes automatically."

