# Kubernetes Deployment Guide

## 🎯 Quick Start

### Option 1: Docker Desktop (Recommended)
```powershell
# Enable Kubernetes in Docker Desktop settings
npm run k8s:local:deploy
```

### Option 2: Containerd/k3s on WSL2
```bash
# Setup: ./devops/kubernetes/scripts/setup-containerd-wsl2.sh
# Build: ./devops/kubernetes/scripts/build-containerd.sh
# Deploy: ./devops/kubernetes/scripts/deploy-containerd.sh
```

**See:** [`WSL2_STEP_BY_STEP.md`](./WSL2_STEP_BY_STEP.md) for detailed WSL2/k3s instructions.

---

## Current Configuration: 3 × VPS 10 (Dev Phase)

**Cluster Setup:**
- **3 × CLOUD VPS 10**: 4 vCPU, 8GB RAM each
- **Total Resources**: 12 vCPU, 24GB RAM
- **Cost**: $11.88/month
- **Capacity**: 150-200 active users (dev/testing)

---

## Production Deployment

### 1. Setup Cluster
See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for complete cluster setup instructions.

### 2. Apply Configuration
```bash
# Calculate configuration for VPS 10 (dev phase)
.\devops\kubernetes\scripts\calculate-cluster-config.ps1 -NewTier vps10 -NodeCount 3

# Apply configuration
./devops/kubernetes/scripts/apply-dynamic-config.sh
```

### 3. Deploy Application
```powershell
# Production
.\scripts\deploy-production.ps1

# Local (Docker Desktop)
.\scripts\deploy-local.ps1
```

---

## Local Deployment (Docker Desktop) ⭐ **RECOMMENDED**

**Why Docker Desktop?**
- ✅ Better tooling and IDE integration
- ✅ Easier debugging with GUI tools
- ✅ Seamless WSL2 integration
- ✅ Works with your existing scripts

**Setup:**
Docker Desktop → Settings → Kubernetes → Enable
- Containerd is the default runtime (automatically enabled)
- Ensure WSL2 integration is enabled in Docker Desktop settings

**Image not found:**
- Build manually: `docker build -f devops/docker/Dockerfile -t healthcare-api:local .`
- Or let the script build it (may take longer)

---

## Local Deployment with Containerd/k3s on WSL2

**Setup:**
```bash
./devops/kubernetes/scripts/setup-containerd-wsl2.sh
```

**Build & Deploy:**
```bash
./devops/kubernetes/scripts/build-containerd.sh
./devops/kubernetes/scripts/deploy-containerd.sh
# Or use deploy-direct.sh if kustomize fails
```

**Access:**
```bash
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088
```

**See:** [`WSL2_STEP_BY_STEP.md`](./WSL2_STEP_BY_STEP.md) for detailed instructions and troubleshooting.

---

## Documentation

1. **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Complete setup, configuration, and troubleshooting
2. **[SCALING_GUIDE.md](./SCALING_GUIDE.md)** - Dynamic scaling, upgrades, and capacity planning
3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Architecture, pod placement, and design decisions

---

## Key Features

- ✅ **Dynamic Configuration** - Automatically scales with cluster resources
- ✅ **Dev-Optimized** - Configured for 3 × VPS 10 (dev phase)
- ✅ **Auto-Scaling** - HPA scales pods based on CPU/Memory
- ✅ **High Availability** - Distributed pods across nodes
- ✅ **Easy Upgrade** - Single command to upgrade to production

---

## Common Commands

```bash
# Check cluster status
kubectl get nodes
kubectl get pods -n healthcare-backend

# Monitor resources
kubectl top nodes
kubectl top pods -n healthcare-backend

# Check HPA
kubectl get hpa -n healthcare-backend

# View logs
kubectl logs -n healthcare-backend -l app=healthcare-api
```

---

## Upgrade Path

**Current (Dev):** 3 × VPS 10 ($11.88/month) → 150-200 users
**Next (Production):** 3 × VPS 20 ($19.08/month) → 250-350 users
**Future:** 3 × VPS 30 ($36/month) → 500-700 users

See [SCALING_GUIDE.md](./SCALING_GUIDE.md) for detailed upgrade instructions.

---

## Support

- **Setup Issues:** See [SETUP_GUIDE.md](./SETUP_GUIDE.md) troubleshooting section
- **Scaling Questions:** See [SCALING_GUIDE.md](./SCALING_GUIDE.md)
- **Architecture Questions:** See [ARCHITECTURE.md](./ARCHITECTURE.md)
