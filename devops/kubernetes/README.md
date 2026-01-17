# Kubernetes Deployment Guide

## Healthcare Backend - Production Setup

## 🎯 Quick Start

### Production Deployment (2-3 Nodes)

```bash
# 1. Review resource quota (switch 2/3 nodes in base/resourcequota.yaml)
# 2. Deploy everything
kubectl apply -k devops/kubernetes/base/

# 3. Verify deployment
kubectl get pods -n healthcare-backend
kubectl get hpa -n healthcare-backend
```

### Local Development (Docker Desktop)

```powershell
# Enable Kubernetes in Docker Desktop settings
yarn k8s:local:deploy
```

---

## 📋 Cluster Configuration

### Current Setup: 2-3 Nodes

**Specifications:**

- **Per Node:** 6 vCPU, 12GB RAM
- **2 Nodes:** 12 vCPU, 24GB RAM total
- **3 Nodes:** 18 vCPU, 36GB RAM total

**Resource Allocation:**

- **Available for Pods:** 67% (33% reserved for system/kubelet)
- **2 Nodes:** 8 vCPU, 16GB RAM available
- **3 Nodes:** 12 vCPU, 24GB RAM available

---

## 🚀 Production Deployment

### Phase 1: Deploy on 2 Nodes

```bash
# 1. Apply resource quota (default is 2 nodes)
kubectl apply -f devops/kubernetes/base/resourcequota.yaml

# 2. Deploy all resources
kubectl apply -k devops/kubernetes/base/

# 3. Verify deployment
kubectl get pods -n healthcare-backend -o wide
kubectl top nodes
kubectl top pods -n healthcare-backend
```

### Phase 2: Scale to 3 Nodes

```bash
# 1. Add third node to cluster
kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>

# 2. Update resource quota
# Edit base/resourcequota.yaml - uncomment 3-node section
kubectl apply -f devops/kubernetes/base/resourcequota.yaml

# 3. Redis will auto-rebalance (1 pod per node)
kubectl get pods -l app=redis -n healthcare-backend -o wide
```

### Phase 3: Vertical Scaling

When ready to increase node size (e.g., 8 vCPU, 16GB RAM):

```bash
# Update resource quota
./devops/kubernetes/scripts/update-resource-quota.sh 3 8 16

# Or manually edit base/resourcequota.yaml
```

---

## 📊 Auto-Scaling

### Horizontal Pod Autoscaler (HPA)

**Already Configured:**

| Component | Min Replicas | Max Replicas | Triggers                |
| --------- | ------------ | ------------ | ----------------------- |
| API       | 3            | 50           | CPU > 70%, Memory > 80% |
| Worker    | 3            | 50           | CPU > 70%, Memory > 80% |

**Monitor Auto-Scaling:**

```bash
# Check HPA status
kubectl get hpa -n healthcare-backend

# View HPA details
kubectl describe hpa healthcare-api-hpa -n healthcare-backend

# Check current replicas
kubectl get deployment healthcare-api -n healthcare-backend
```

**Scaling Behavior:**

- **Scale Up:** Aggressive (double or +5 pods every 30s)
- **Scale Down:** Conservative (max 50% or -2 pods every 60s, wait 5 min)

### Vertical Pod Autoscaler (VPA) - Optional

VPA is configured but optional. Uncomment in `base/kustomization.yaml` if VPA
controller is installed.

---

## 💾 Resource Allocation

### 2 Nodes (12 vCPU, 24GB RAM)

| Component     | Replicas | CPU Request | RAM Request | Total CPU     | Total RAM |
| ------------- | -------- | ----------- | ----------- | ------------- | --------- |
| Redis         | 3        | 0.5 vCPU    | 1GB         | 1.5 vCPU      | 3GB       |
| Dragonfly     | 1        | 0.5 vCPU    | 2GB         | 0.5 vCPU      | 2GB       |
| PostgreSQL    | 1        | 1 vCPU      | 2GB         | 1 vCPU        | 2GB       |
| API           | 3        | 0.5 vCPU    | 1GB         | 1.5 vCPU      | 3GB       |
| Worker        | 3        | 0.25 vCPU   | 512MB       | 0.75 vCPU     | 1.5GB     |
| PgBouncer     | 1        | 0.2 vCPU    | 256MB       | 0.2 vCPU      | 256MB     |
| **Total**     | **12**   |             |             | **5.45 vCPU** | **12GB**  |
| **Remaining** |          |             |             | **2.55 vCPU** | **4GB**   |

### 3 Nodes (18 vCPU, 36GB RAM)

| Component     | Replicas  | CPU Request | RAM Request | Total CPU          | Total RAM   |
| ------------- | --------- | ----------- | ----------- | ------------------ | ----------- |
| Redis         | 3         | 0.5 vCPU    | 1GB         | 1.5 vCPU           | 3GB         |
| Dragonfly     | 1         | 0.5 vCPU    | 2GB         | 0.5 vCPU           | 2GB         |
| PostgreSQL    | 1         | 1 vCPU      | 2GB         | 1 vCPU             | 2GB         |
| API           | 3-6       | 0.5 vCPU    | 1GB         | 1.5-3 vCPU         | 3-6GB       |
| Worker        | 3-6       | 0.25 vCPU   | 512MB       | 0.75-1.5 vCPU      | 1.5-3GB     |
| PgBouncer     | 1         | 0.2 vCPU    | 256MB       | 0.2 vCPU           | 256MB       |
| **Total**     | **12-18** |             |             | **5.45-8.45 vCPU** | **12-16GB** |
| **Remaining** |           |             |             | **3.55-6.55 vCPU** | **8-12GB**  |

---

## 🗂️ Directory Structure

```
kubernetes/
├── base/                    # Base configurations
│   ├── README.md           # Base configuration guide
│   ├── kustomization.yaml  # Main entry point
│   ├── resourcequota.yaml  # Unified quota (switch 2/3 nodes)
│   └── ...                  # All YAML configurations
│
├── overlays/                # Environment-specific configs
│   ├── production/         # Production overrides
│   ├── staging/            # Staging overrides
│   └── local/              # Local development
│
├── scripts/                 # Deployment scripts
│   └── update-resource-quota.sh
│
└── README.md               # This file
```

---

## 🔧 Configuration Files

### `base/resourcequota.yaml`

- **Purpose:** Unified resource quota for 2/3 nodes
- **Usage:** Uncomment the appropriate section (2-node or 3-node)
- **Default:** 2 nodes configuration

### `base/kustomization.yaml`

- **Purpose:** Main entry point for all resources
- **Features:** Uses consolidated files, organized by category
- **VPA:** Optional (commented out by default)

### `base/api-deployment.yaml` & `base/worker-deployment.yaml`

- **Purpose:** Application deployments with HPA
- **Features:** Auto-scaling configured, optimized for 2-3 nodes

---

## 📈 Monitoring & Maintenance

### Daily Checks

```bash
# Resource usage
kubectl top nodes
kubectl top pods -n healthcare-backend

# Pod health
kubectl get pods -n healthcare-backend

# Resource quota
kubectl describe resourcequota healthcare-quotas -n healthcare-backend
```

### Weekly Checks

```bash
# Redis cluster health
kubectl exec -it redis-0 -n healthcare-backend -- redis-cli -a $REDIS_PASSWORD cluster nodes

# PVC usage
kubectl get pvc -n healthcare-backend

# Node capacity
kubectl describe nodes
```

### Scaling Triggers

**Scale API pods when:**

- CPU usage > 70% for 5 minutes
- Memory usage > 80%
- Request latency > 500ms

**Scale Worker pods when:**

- Queue backlog > 100 jobs
- Worker CPU > 70%

---

## 🔄 Common Commands

### Deployment

```bash
# Deploy all
kubectl apply -k devops/kubernetes/base/

# Deploy specific resource
kubectl apply -f devops/kubernetes/base/resourcequota.yaml

# Check status
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

## 📚 Documentation

- **Base Configuration:** `base/README.md` - Detailed base configuration guide
- **Architecture:** `ARCHITECTURE.md` - System architecture overview
- **Setup Guide:** `SETUP_GUIDE.md` - Complete setup instructions (if exists)

---

## ✅ Features

- ✅ **Auto-Scaling:** HPA configured for API and Worker pods
- ✅ **High Availability:** Redis 3 replicas with pod anti-affinity
- ✅ **Resource Management:** Unified resource quotas for 2/3 nodes
- ✅ **Persistent Storage:** All stateful components use PVCs
- ✅ **Health Checks:** Liveness and readiness probes configured
- ✅ **Network Policies:** Security policies for pod communication
- ✅ **RBAC:** Role-based access control configured

---

## 🎯 Next Steps

1. ✅ Review `base/resourcequota.yaml` - Switch to 3 nodes when ready
2. ✅ Deploy: `kubectl apply -k devops/kubernetes/base/`
3. ✅ Monitor: Check HPA and resource usage
4. ✅ Scale: Add 3rd node when needed
5. ✅ Optimize: Adjust HPA settings based on actual usage

---

## 📝 Notes

- **Resource Quota:** Default is 2 nodes. Edit `base/resourcequota.yaml` for 3
  nodes.
- **Auto-Scaling:** HPA is active. VPA is optional.
- **High Availability:** Redis pods spread across nodes automatically.
- **Persistent Storage:** All data survives pod restarts.
