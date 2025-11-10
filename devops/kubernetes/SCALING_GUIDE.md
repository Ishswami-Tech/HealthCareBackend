# Scaling & Upgrade Guide

## Dynamic Configuration System

All configurations automatically scale when you upgrade your cluster. No manual updates needed!

---

## Quick Upgrade

### Upgrade VPS 10 → VPS 20 (Dev → Production)

```bash
# Step 1: Calculate new configuration
.\devops\kubernetes\scripts\calculate-cluster-config.ps1 -NewTier vps20 -NodeCount 3

# Step 2: Apply configuration
./devops/kubernetes/scripts/apply-dynamic-config.sh
```

**Result:**
- PostgreSQL max_connections: 100 → **100** (same) ✅
- API DB pool: 50 → **50** (same) ✅
- HPA max replicas: 15 → **18** ✅
- Resource quotas: Auto-updated ✅

### Upgrade VPS 20 → VPS 30 (Production Scaling)

```bash
# Step 1: Calculate new configuration
.\devops\kubernetes\scripts\calculate-cluster-config.ps1 -NewTier vps30 -NodeCount 3

# Step 2: Apply configuration
./devops/kubernetes/scripts/apply-dynamic-config.sh
```

**Result:**
- PostgreSQL max_connections: 100 → **150** ✅
- API DB pool: 50 → **80** ✅
- HPA max replicas: 18 → **25** ✅
- Resource quotas: Auto-updated ✅

### Add More Servers

```bash
# Add 4th server (still VPS 10)
.\devops\kubernetes\scripts\calculate-cluster-config.ps1 -NewTier vps10 -NodeCount 4
./devops/kubernetes/scripts/apply-dynamic-config.sh
```

---

## Scaling Formulas

### PostgreSQL Max Connections
```
min(RAM_GB × 10, vCPU × 40, 200)
```
- VPS 10: 100 connections
- VPS 20: 100 connections
- VPS 30: 150 connections
- VPS 40: 200 connections

### Database Connection Pools
```
API Pool Max: min(Total vCPU × 2, 200)
Worker Pool Max: min(Total vCPU × 1.5, 200)
```

### HPA Max Replicas
```
API Max: (Total vCPU / 2) × 0.8
Worker Max: (Total vCPU / 2) × 0.6
```

### Resource Quotas
```
Requests CPU: Total vCPU × 0.67 (67%)
Requests Memory: Total RAM × 0.67 (67%)
Limits CPU: Total vCPU (100%)
Limits Memory: Total RAM (100%)
Max Pods: (Total vCPU / 2) × 10
```

---

## Capacity Planning

### Current (Dev): 3 × VPS 10
- **Cost**: $11.88/month
- **Capacity**: 150-200 active users
- **Resources**: 12 vCPU, 24GB RAM

### Upgrade (Production): 3 × VPS 20
- **Cost**: $19.08/month (+$7.20)
- **Capacity**: 250-350 active users
- **Resources**: 18 vCPU, 36GB RAM

### Upgrade: 3 × VPS 30
- **Cost**: $36.00/month (+$16.92 from VPS 20)
- **Capacity**: 500-700 active users
- **Resources**: 24 vCPU, 72GB RAM

### Expand: 4 × VPS 30
- **Cost**: $48.00/month
- **Capacity**: 700-1000 active users
- **Resources**: 32 vCPU, 96GB RAM

### Expand: 5 × VPS 30
- **Cost**: $60.00/month
- **Capacity**: 900-1300 active users
- **Resources**: 40 vCPU, 120GB RAM

---

## Upgrade Scenarios

### Scenario 1: Dev → Production (VPS 10 → VPS 20)

**Before (Dev - 3 × VPS 10):**
- PostgreSQL: 100 max connections
- API Pool: 50 max
- HPA: 15 max API pods
- Capacity: 150-200 users

**After (Production - 3 × VPS 20):**
- PostgreSQL: **100 max connections** (same) ✅
- API Pool: **50 max** (same) ✅
- HPA: **18 max API pods** ✅
- Capacity: **250-350 users** ✅

### Scenario 2: Production Scaling (VPS 20 → VPS 30)

**Before:**
- PostgreSQL: 100 max connections
- API Pool: 50 max
- HPA: 18 max API pods

**After:**
- PostgreSQL: **150 max connections** ✅
- API Pool: **80 max** ✅
- HPA: **25 max API pods** ✅

### Scenario 3: Add 1 More Server

**Before (3 × VPS 10):**
- Total: 12 vCPU, 24GB RAM
- API Pool: 50 max

**After (4 × VPS 10):**
- Total: **16 vCPU, 32GB RAM** ✅
- API Pool: **60 max** ✅
- HPA: **20 max API pods** ✅

---

## Configuration Comparison

| Config | vCPU | RAM | PostgreSQL Max | API Pool | HPA Max | Cost/Month |
|--------|------|-----|----------------|----------|---------|------------|
| **3× VPS 10** | 12 | 24GB | 100 | 50 | 15 | $11.88 |
| **3× VPS 20** | 18 | 36GB | 100 | 50 | 18 | $19.08 |
| **3× VPS 30** | 24 | 72GB | 150 | 80 | 25 | $36.00 |
| **3× VPS 40** | 36 | 144GB | 200 | 120 | 40 | $62.40 |
| **4× VPS 10** | 16 | 32GB | 100 | 60 | 20 | $15.84 |
| **4× VPS 20** | 24 | 48GB | 100 | 60 | 20 | $25.44 |
| **4× VPS 30** | 32 | 96GB | 150 | 100 | 30 | $48.00 |
| **5× VPS 30** | 40 | 120GB | 150 | 120 | 35 | $60.00 |

---

## When to Upgrade

### Dev → Production (VPS 10 → VPS 20)
- Moving to production
- Need 200+ active users
- Want better performance
- Budget allows (+$7.20/month)

### Production Scaling (VPS 20 → VPS 30)
- CPU > 75% for 1+ hour
- Memory > 85% for 1+ hour
- HPA maxing out at max replicas
- Approaching 300+ active users
- Response times increasing

### Add Servers When:
- All nodes at 80%+ utilization
- Need more capacity than upgrade provides
- Want better fault tolerance
- Need geographic distribution

---

## VPS Plan Comparison

| Plan | vCPU | RAM | Storage | Cost/Month | Best For |
|------|------|-----|---------|------------|----------|
| **VPS 10** | 4 | 8GB | 75GB | $3.96 | Dev/Testing, 150-200 users |
| **VPS 20** | 6 | 12GB | 100GB | $6.36 | Production, 250-350 users |
| **VPS 30** | 8 | 24GB | 200GB | $12.00 | Production, 500-700 users |
| **VPS 40** | 12 | 48GB | 250GB | $20.80 | High traffic, 800-1200 users |

**Recommendation:** 
- **Dev Phase:** Start with 3 × VPS 10 ($11.88/month)
- **Production:** Upgrade to 3 × VPS 20 ($19.08/month)
- **Scaling:** Upgrade to 3 × VPS 30 ($36/month) when needed

---

## Scaling Strategy

### Phase 1: Dev Phase (Current)
- **3 × VPS 10** ($11.88/month)
- Capacity: 150-200 users
- Good for development and testing

### Phase 2: Production Launch
- **3 × VPS 20** ($19.08/month)
- Capacity: 250-350 users
- Good for initial production launch

### Phase 3: Production Scaling
- **3 × VPS 30** ($36/month)
- Capacity: 500-700 users
- Best balance of cost/performance

### Phase 4: Expand
- **4-5 × VPS 30** ($48-60/month)
- Capacity: 700-1300 users
- Better fault tolerance

---

## Verification

After upgrading:

```bash
# Check ConfigMap
kubectl get configmap cluster-resource-config -n healthcare-backend -o yaml

# Check PostgreSQL settings
kubectl exec -it postgres-0 -n healthcare-backend -- \
  psql -U postgres -c "SHOW max_connections;"

# Check HPA
kubectl get hpa -n healthcare-backend

# Check resource quotas
kubectl get resourcequota healthcare-quotas -n healthcare-backend -o yaml
```

---

## Benefits

✅ **Automatic Scaling** - Everything updates automatically
✅ **Formula-Based** - Consistent calculations
✅ **Safe Limits** - Prevents over-allocation
✅ **Easy Upgrades** - Single command to update everything
✅ **Future-Proof** - Works for any cluster size

