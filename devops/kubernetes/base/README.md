# Kubernetes Base Configuration

## 📋 Overview

This directory contains the base Kubernetes configurations for the Healthcare Backend, optimized for **2-3 node clusters** (6 vCPU, 12GB RAM per node).

---

## 🚀 Quick Start

### Deploy Everything

```bash
# Deploy all resources
kubectl apply -k devops/kubernetes/base/

# Check status
kubectl get pods -n healthcare-backend
kubectl get hpa -n healthcare-backend
```

### Switch Resource Quota (2 → 3 Nodes)

1. Edit `resourcequota.yaml`
2. Comment out 2-node section
3. Uncomment 3-node section
4. Apply: `kubectl apply -f devops/kubernetes/base/resourcequota.yaml`

---

## 📊 Auto-Scaling Configuration

### Horizontal Pod Autoscaler (HPA)

**API Pods:**
- **Min Replicas:** 3
- **Max Replicas:** 50
- **CPU Threshold:** 70%
- **Memory Threshold:** 80%
- **Scale Up:** Aggressive (double or +5 pods every 30s)
- **Scale Down:** Conservative (max 50% or -2 pods every 60s, wait 5 min)

**Worker Pods:**
- **Min Replicas:** 3
- **Max Replicas:** 50
- **CPU Threshold:** 70%
- **Memory Threshold:** 80%

### Monitor Auto-Scaling

```bash
# Check HPA status
kubectl get hpa -n healthcare-backend

# View HPA details
kubectl describe hpa healthcare-api-hpa -n healthcare-backend

# Check current replicas
kubectl get deployment healthcare-api -n healthcare-backend
kubectl get deployment healthcare-worker -n healthcare-backend
```

### Vertical Pod Autoscaler (VPA) - Optional

VPA is configured in `vpa.yaml` but commented out in `kustomization.yaml`. Uncomment if VPA controller is installed:

```yaml
# In kustomization.yaml, uncomment:
# - vpa.yaml
```

---

## 💾 Resource Allocation

### 2 Nodes (12 vCPU, 24GB RAM total)

**Available for Pods:** 8 vCPU, 16GB RAM (67% of total)

| Component | Replicas | CPU Request | RAM Request | Total CPU | Total RAM |
|-----------|----------|-------------|-------------|-----------|-----------|
| Redis | 3 | 0.5 vCPU | 1GB | 1.5 vCPU | 3GB |
| Dragonfly | 1 | 0.5 vCPU | 2GB | 0.5 vCPU | 2GB |
| PostgreSQL | 1 | 1 vCPU | 2GB | 1 vCPU | 2GB |
| API | 3 | 0.5 vCPU | 1GB | 1.5 vCPU | 3GB |
| Worker | 3 | 0.25 vCPU | 512MB | 0.75 vCPU | 1.5GB |
| PgBouncer | 1 | 0.2 vCPU | 256MB | 0.2 vCPU | 256MB |
| **Total** | **12** | | | **5.45 vCPU** | **12GB** |
| **Remaining** | | | | **2.55 vCPU** | **4GB** |

### 3 Nodes (18 vCPU, 36GB RAM total)

**Available for Pods:** 12 vCPU, 24GB RAM (67% of total)

| Component | Replicas | CPU Request | RAM Request | Total CPU | Total RAM |
|-----------|----------|-------------|-------------|-----------|-----------|
| Redis | 3 | 0.5 vCPU | 1GB | 1.5 vCPU | 3GB |
| Dragonfly | 1 | 0.5 vCPU | 2GB | 0.5 vCPU | 2GB |
| PostgreSQL | 1 | 1 vCPU | 2GB | 1 vCPU | 2GB |
| API | 3-6 | 0.5 vCPU | 1GB | 1.5-3 vCPU | 3-6GB |
| Worker | 3-6 | 0.25 vCPU | 512MB | 0.75-1.5 vCPU | 1.5-3GB |
| PgBouncer | 1 | 0.2 vCPU | 256MB | 0.2 vCPU | 256MB |
| **Total** | **12-18** | | | **5.45-8.45 vCPU** | **12-16GB** |
| **Remaining** | | | | **3.55-6.55 vCPU** | **8-12GB** |

---

## 🗂️ File Structure

```
base/
├── kustomization.yaml          # Main entry point
├── resourcequota.yaml          # Unified quota (switch 2/3 nodes)
│
├── Core Infrastructure
│   ├── rbac.yaml
│   ├── network-policies.yaml
│   └── limitrange.yaml
│
├── Configuration
│   ├── configmap.yaml
│   ├── postgres-config.yaml
│   └── pgbouncer-configmap.yaml
│
├── Application Deployments (with HPA)
│   ├── api-deployment.yaml
│   └── worker-deployment.yaml
│
├── Database & Cache
│   ├── postgres-statefulset.yaml
│   ├── redis-optimized.yaml
│   ├── dragonfly-optimized.yaml
│   └── pgbouncer-deployment.yaml
│
├── Jobs & Maintenance
│   ├── init-job.yaml
│   └── postgres-restore-job.yaml
│
├── Networking
│   └── ingress.yaml
│
├── High Availability
│   └── pdb.yaml
│
└── Optional
    ├── vpa.yaml                # Optional vertical auto-scaling
    └── secrets.yaml.template
```

---

## 🔧 Common Commands

### Deployment

```bash
# Deploy all
kubectl apply -k devops/kubernetes/base/

# Deploy specific resource
kubectl apply -f devops/kubernetes/base/resourcequota.yaml

# Check deployment status
kubectl get pods -n healthcare-backend -o wide
```

### Monitoring

```bash
# Resource usage
kubectl top nodes
kubectl top pods -n healthcare-backend

# Resource quota
kubectl describe resourcequota healthcare-quotas -n healthcare-backend

# Pod distribution
kubectl get pods -n healthcare-backend -o wide
```

### Scaling

```bash
# Manual scaling (if needed)
kubectl scale deployment healthcare-api -n healthcare-backend --replicas=5

# Check HPA
kubectl get hpa -n healthcare-backend

# View scaling events
kubectl get events -n healthcare-backend --sort-by='.lastTimestamp' | grep -i scale
```

### Troubleshooting

```bash
# View logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend

# Restart deployment
kubectl rollout restart deployment/healthcare-api -n healthcare-backend

# Check events
kubectl get events -n healthcare-backend --sort-by='.lastTimestamp'

# Describe resource
kubectl describe pod <pod-name> -n healthcare-backend
```

---

## 🔄 Scaling Strategy

### Horizontal Scaling (Add Nodes)

1. **Add 3rd Node:**
   ```bash
   # Join new node to cluster
   kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>
   ```

2. **Update Resource Quota:**
   ```bash
   # Edit resourcequota.yaml and uncomment 3-node section
   kubectl apply -f devops/kubernetes/base/resourcequota.yaml
   ```

3. **Redis Will Auto-Rebalance:**
   - Pods automatically spread across 3 nodes (1 per node)

### Vertical Scaling (Increase Node Size)

When ready to increase node size (e.g., 8 vCPU, 16GB RAM):

```bash
# Use script to update quota
./devops/kubernetes/scripts/update-resource-quota.sh 3 8 16

# Or manually edit resourcequota.yaml
```

---

## ⚙️ Configuration Files

### `resourcequota.yaml`
- Unified resource quota for 2/3 nodes
- Switch by uncommenting the appropriate section
- Default: 2 nodes configuration

### `kustomization.yaml`
- Main entry point for all resources
- Uses consolidated files (no duplicates)
- VPA is optional (commented out)

### `api-deployment.yaml` & `worker-deployment.yaml`
- Include HPA auto-scaling configuration
- Optimized for 2-3 node clusters
- Can be overridden in production overlay

---

## 📚 Additional Resources

- **Main README:** `../README.md` - Complete setup and deployment guide
- **Scaling Guide:** `../CLUSTER_SCALING_GUIDE.md` - Detailed scaling instructions
- **Architecture:** `../ARCHITECTURE.md` - System architecture overview

---

## ✅ Verification Checklist

After deployment, verify:

- [ ] All pods are running: `kubectl get pods -n healthcare-backend`
- [ ] HPA is active: `kubectl get hpa -n healthcare-backend`
- [ ] Resource quota applied: `kubectl describe resourcequota healthcare-quotas -n healthcare-backend`
- [ ] Redis pods distributed: `kubectl get pods -l app=redis -n healthcare-backend -o wide`
- [ ] Services accessible: `kubectl get svc -n healthcare-backend`

---

## 🆘 Troubleshooting

### Pods Not Scheduling

```bash
# Check resource quota
kubectl describe resourcequota healthcare-quotas -n healthcare-backend

# Check node resources
kubectl describe nodes

# Check pod events
kubectl describe pod <pod-name> -n healthcare-backend
```

### HPA Not Scaling

```bash
# Check metrics server
kubectl get deployment metrics-server -n kube-system

# Check pod metrics
kubectl top pods -n healthcare-backend

# Check HPA status
kubectl describe hpa healthcare-api-hpa -n healthcare-backend
```

### High Resource Usage

```bash
# Check resource usage
kubectl top pods -n healthcare-backend --sort-by=memory

# Scale down if needed
kubectl scale deployment healthcare-api -n healthcare-backend --replicas=2
```

---

## 📝 Notes

- **Resource Quota:** Default is 2 nodes. Edit `resourcequota.yaml` for 3 nodes.
- **Auto-Scaling:** HPA is configured and active. VPA is optional.
- **High Availability:** Redis has 3 replicas with pod anti-affinity.
- **Persistent Storage:** All stateful components use PVCs.


