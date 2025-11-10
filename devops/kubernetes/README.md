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

## Production Deployment

### Step 1: Update Image Registry

Edit `overlays/production/kustomization.yaml`:
```yaml
images:
  - name: your-registry/healthcare-api
    newName: ghcr.io/YOUR_USERNAME/healthcare-api
    newTag: v1.0.0
```

### Step 2: Setup Secrets

```powershell
.\scripts\setup-production-secrets.ps1
```

### Step 3: Deploy

```powershell
.\scripts\deploy-production.ps1
```

### Step 4: Verify

```bash
kubectl get pods -n healthcare-backend
curl https://api.ishswami.in/health
```

---

## Local Deployment (Docker Desktop) ⭐ **RECOMMENDED**

**Why Docker Desktop?**
- ✅ Better tooling and IDE integration
- ✅ Easier debugging with GUI tools
- ✅ Seamless WSL2 integration
- ✅ Works with your existing scripts

### Step 1: Enable Kubernetes & Containerd

Docker Desktop → Settings → Kubernetes → Enable
- Containerd is the default runtime (automatically enabled)
- Ensure WSL2 integration is enabled in Docker Desktop settings

### Step 2: Deploy

**Option A: Full deployment (builds image and deploys)**
```powershell
.\scripts\deploy-local.ps1
```

**Option B: Skip build (uses existing image)**
```powershell
.\scripts\deploy-local.ps1 -SkipBuild
```

**Option C: Using npm scripts**
```powershell
npm run k8s:local:deploy        # Full deployment
npm run k8s:local:deploy:nobuild # Skip build
```

**Available flags:**
- `-SkipBuild` - Skip Docker image build (uses existing `healthcare-api:local` image)
- `-SkipSecrets` - Skip secret creation (uses existing secrets)
- `-SkipMigration` - Skip database migration job
- `-ImageTag <tag>` - Use custom image tag (default: `local`)

**Note:** Docker Desktop automatically shares images with containerd/Kubernetes

### Step 3: Access

```bash
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088
# Open: http://localhost:8088
```

**Or use npm script:**
```powershell
npm run k8s:local:portforward
```

### Step 4: Monitor & Debug

```powershell
# View logs
npm run k8s:local:logs

# Check status
npm run k8s:local:status

# Access shell
npm run k8s:local:shell
```

### Step 5: Clean Up

```powershell
.\scripts\teardown-local.ps1
# OR
npm run k8s:local:teardown
```

### Troubleshooting

**Docker build fails with network errors:**
- Retry the build when network is stable
- Or use `-SkipBuild` flag if you have an existing image
- Check Docker Desktop network settings

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