# 🚀 Running Kubernetes Locally

Yes! You can run Kubernetes on your local machine for development and testing.

## 🎯 Local Kubernetes Options

### Comparison

| Tool | Best For | Resource Usage | Setup Time | Windows Support |
|------|----------|----------------|------------|-----------------|
| **Docker Desktop K8s** | Simplest setup | Medium | 5 min | ✅ Excellent |
| **Minikube** | Feature-rich | Medium-High | 10 min | ✅ Good |
| **kind** | CI/CD, fast | Low | 5 min | ✅ Good |
| **k3s/k3d** | Lightweight | Low | 5 min | ⚠️ WSL required |
| **MicroK8s** | Linux-focused | Medium | 5 min | ⚠️ WSL required |

**Recommended for Windows: Docker Desktop with Kubernetes enabled**

---

## ⚡ Quick Start: Docker Desktop (Easiest)

### 1. Enable Kubernetes in Docker Desktop

```bash
# 1. Open Docker Desktop
# 2. Go to Settings → Kubernetes
# 3. Check "Enable Kubernetes"
# 4. Click "Apply & Restart"
# 5. Wait 2-3 minutes for K8s to start

# Verify installation
kubectl version --short
kubectl cluster-info
kubectl get nodes
```

### 2. Deploy Healthcare Backend to Local K8s

```bash
# Navigate to project
cd c:\Users\aadesh.bhujbal\Downloads\Project\HealthCareBackend

# Create namespace
kubectl apply -f devops/kubernetes/base/namespace.yaml

# Create secrets
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://postgres:postgres@postgres:5432/userdb' \
  --from-literal=jwt-secret='local-dev-secret-key-change-in-production' \
  --from-literal=postgres-user='postgres' \
  --from-literal=postgres-password='postgres' \
  --namespace=healthcare-backend

# Deploy all resources
kubectl apply -k devops/kubernetes/overlays/local/

# Watch pods starting
kubectl get pods -n healthcare-backend --watch
```

### 3. Access Services

```bash
# API
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088
# Access: http://localhost:8088

# PostgreSQL
kubectl port-forward -n healthcare-backend svc/postgres 5432:5432
# Connect: postgresql://postgres:postgres@localhost:5432/userdb

# Redis
kubectl port-forward -n healthcare-backend svc/redis 6379:6379
# Connect: redis://localhost:6379

# Prisma Studio (if deployed)
kubectl port-forward -n healthcare-backend svc/healthcare-api 5555:5555
# Access: http://localhost:5555
```

---

## 🐳 Option 2: Minikube (Feature-Rich)

### Installation (Windows)

```powershell
# Install via Chocolatey
choco install minikube

# Or download installer
# https://minikube.sigs.k8s.io/docs/start/

# Start minikube
minikube start --cpus=4 --memory=8192 --disk-size=20g

# Verify
kubectl get nodes
minikube status
```

### Deploy Healthcare Backend

```bash
# Enable required addons
minikube addons enable metrics-server
minikube addons enable ingress
minikube addons enable dashboard

# Build and load local images
eval $(minikube docker-env)
docker build -t healthcare-api:local -f devops/docker/Dockerfile .

# Deploy
kubectl apply -f devops/kubernetes/base/namespace.yaml
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://postgres:postgres@postgres:5432/userdb' \
  --from-literal=jwt-secret='local-dev-secret' \
  --from-literal=postgres-user='postgres' \
  --from-literal=postgres-password='postgres' \
  --namespace=healthcare-backend

kubectl apply -k devops/kubernetes/overlays/local/

# Access services
minikube service healthcare-api -n healthcare-backend

# Open dashboard
minikube dashboard
```

---

## 🔧 Option 3: kind (Lightweight)

### Installation

```powershell
# Install via Chocolatey
choco install kind

# Or download from GitHub
# https://kind.sigs.k8s.io/docs/user/quick-start/

# Create cluster
kind create cluster --name healthcare-local --config devops/kubernetes/kind-config.yaml

# Verify
kubectl cluster-info --context kind-healthcare-local
kubectl get nodes
```

### Deploy Healthcare Backend

```bash
# Load local image to kind
docker build -t healthcare-api:local -f devops/docker/Dockerfile .
kind load docker-image healthcare-api:local --name healthcare-local

# Deploy
kubectl apply -f devops/kubernetes/base/namespace.yaml
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://postgres:postgres@postgres:5432/userdb' \
  --from-literal=jwt-secret='local-dev-secret' \
  --from-literal=postgres-user='postgres' \
  --from-literal=postgres-password='postgres' \
  --namespace=healthcare-backend

kubectl apply -k devops/kubernetes/overlays/local/

# Port forward to access
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088
```

---

## 📁 Local Kubernetes Configuration

We'll create a local overlay with optimized settings:

**File:** `devops/kubernetes/overlays/local/kustomization.yaml`

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

bases:
  - ../../base

namespace: healthcare-backend

commonLabels:
  environment: local
  tier: development

# Local development - use local images
images:
  - name: your-registry/healthcare-api
    newName: healthcare-api
    newTag: local

# Local-specific patches
patches:
  # Minimal replicas for local
  - target:
      kind: Deployment
      name: healthcare-api
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 1

  # Lower HPA limits
  - target:
      kind: HorizontalPodAutoscaler
      name: healthcare-api-hpa
    patch: |-
      - op: replace
        path: /spec/minReplicas
        value: 1
      - op: replace
        path: /spec/maxReplicas
        value: 3

  # Reduced resources for local
  - target:
      kind: Deployment
      name: healthcare-api
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/resources/requests/cpu
        value: "250m"
      - op: replace
        path: /spec/template/spec/containers/0/resources/requests/memory
        value: "512Mi"
      - op: replace
        path: /spec/template/spec/containers/0/resources/limits/cpu
        value: "1000m"
      - op: replace
        path: /spec/template/spec/containers/0/resources/limits/memory
        value: "1Gi"

  # Local image pull policy
  - target:
      kind: Deployment
      name: healthcare-api
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: "IfNotPresent"

  # Smaller PostgreSQL storage
  - target:
      kind: StatefulSet
      name: postgres
    patch: |-
      - op: replace
        path: /spec/volumeClaimTemplates/0/spec/resources/requests/storage
        value: "5Gi"

  # Single Redis instance
  - target:
      kind: StatefulSet
      name: redis
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 1

# Local config
configMapGenerator:
  - name: api-config
    behavior: merge
    literals:
      - NODE_ENV=development
      - LOG_LEVEL=debug
      - MAX_CONNECTIONS=50
      - ENABLE_DEBUG=true
```

---

## 🎮 Makefile Commands for Local K8s

Add these to your `Makefile`:

```makefile
## k8s-local-start: Start local Kubernetes cluster
k8s-local-start:
	@echo "$(BLUE)Starting local Kubernetes...$(NC)"
	@command -v minikube >/dev/null 2>&1 && minikube start || \
	 echo "Using Docker Desktop Kubernetes (already running)"

## k8s-local-build: Build and load local image
k8s-local-build:
	@echo "$(BLUE)Building local Kubernetes image...$(NC)"
	docker build -t healthcare-api:local -f devops/docker/Dockerfile .
	@command -v minikube >/dev/null 2>&1 && \
	 (eval $$(minikube docker-env) && docker build -t healthcare-api:local .) || \
	 echo "Using Docker Desktop (image already available)"

## k8s-local-deploy: Deploy to local Kubernetes
k8s-local-deploy:
	@echo "$(BLUE)Deploying to local Kubernetes...$(NC)"
	kubectl apply -f devops/kubernetes/base/namespace.yaml
	@kubectl get secret healthcare-secrets -n healthcare-backend >/dev/null 2>&1 || \
	 kubectl create secret generic healthcare-secrets \
	  --from-literal=database-url='postgresql://postgres:postgres@postgres:5432/userdb' \
	  --from-literal=jwt-secret='local-dev-secret-key' \
	  --from-literal=postgres-user='postgres' \
	  --from-literal=postgres-password='postgres' \
	  --namespace=healthcare-backend
	kubectl apply -k devops/kubernetes/overlays/local/
	@echo "$(GREEN)✓ Deployed to local Kubernetes$(NC)"
	@echo "$(YELLOW)Run 'make k8s-local-access' to access services$(NC)"

## k8s-local-access: Port forward services for local access
k8s-local-access:
	@echo "$(BLUE)Port forwarding services...$(NC)"
	@echo "$(YELLOW)API will be available at: http://localhost:8088$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to stop$(NC)"
	kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088

## k8s-local-status: Check local Kubernetes status
k8s-local-status:
	@echo "$(BLUE)Local Kubernetes Status:$(NC)"
	kubectl get all -n healthcare-backend
	@echo ""
	@echo "$(BLUE)Resource Usage:$(NC)"
	kubectl top pods -n healthcare-backend 2>/dev/null || echo "Metrics server not available"

## k8s-local-logs: View API logs
k8s-local-logs:
	kubectl logs -f -l app=healthcare-api -n healthcare-backend

## k8s-local-shell: Shell into API pod
k8s-local-shell:
	kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh

## k8s-local-stop: Stop and cleanup local Kubernetes
k8s-local-stop:
	@echo "$(RED)Cleaning up local Kubernetes...$(NC)"
	kubectl delete namespace healthcare-backend --ignore-not-found=true
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

## k8s-local-restart: Restart deployment
k8s-local-restart:
	kubectl rollout restart deployment/healthcare-api -n healthcare-backend
	kubectl rollout status deployment/healthcare-api -n healthcare-backend
```

---

## 🎯 Complete Local K8s Workflow

```bash
# 1. Enable Kubernetes (Docker Desktop or Minikube)
# Docker Desktop: Settings → Kubernetes → Enable
# Or: minikube start

# 2. Build local image
make k8s-local-build

# 3. Deploy to local K8s
make k8s-local-deploy

# 4. Wait for pods to be ready
kubectl get pods -n healthcare-backend --watch

# 5. Access API
make k8s-local-access
# Open: http://localhost:8088

# 6. View logs
make k8s-local-logs

# 7. Check status
make k8s-local-status

# 8. Test autoscaling (simulate load)
kubectl run -n healthcare-backend load-test --image=busybox:1.28 \
  --restart=Never -- /bin/sh -c \
  "while true; do wget -q -O- http://healthcare-api:8088/health; done"

# 9. Watch HPA scaling
kubectl get hpa -n healthcare-backend --watch

# 10. Cleanup when done
make k8s-local-stop
```

---

## 📊 Resource Requirements

### Minimum (Docker Desktop K8s)
- **CPU:** 4 cores
- **RAM:** 8 GB
- **Disk:** 20 GB

### Recommended
- **CPU:** 6-8 cores
- **RAM:** 16 GB
- **Disk:** 40 GB

### Docker Desktop Settings

```
Docker Desktop → Settings → Resources:
├── CPUs: 4-6
├── Memory: 8-12 GB
├── Swap: 2 GB
└── Disk: 40 GB
```

---

## 🔍 Troubleshooting Local K8s

### Pods Stuck in Pending

```bash
# Check events
kubectl get events -n healthcare-backend --sort-by='.lastTimestamp'

# Check node resources
kubectl describe nodes

# Reduce resource requests
kubectl edit deployment healthcare-api -n healthcare-backend
```

### Image Pull Errors

```bash
# For Docker Desktop - image should be available
docker images | grep healthcare-api

# For Minikube - load image
eval $(minikube docker-env)
docker build -t healthcare-api:local .

# For kind - load image
kind load docker-image healthcare-api:local
```

### Metrics Server Not Working

```bash
# Docker Desktop - may not have metrics-server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Minikube - enable addon
minikube addons enable metrics-server

# Verify
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
```

### Port Forward Fails

```bash
# Check if pod is running
kubectl get pods -n healthcare-backend

# Find pod name
POD_NAME=$(kubectl get pods -n healthcare-backend -l app=healthcare-api -o jsonpath='{.items[0].metadata.name}')

# Port forward directly to pod
kubectl port-forward -n healthcare-backend $POD_NAME 8088:8088
```

---

## 🎯 Docker Compose vs Local K8s

| Feature | Docker Compose | Local Kubernetes |
|---------|----------------|------------------|
| **Startup Time** | ⚡ 10 seconds | 🐢 2-3 minutes |
| **Resource Usage** | 💚 2GB RAM | 💛 4-6GB RAM |
| **Autoscaling Test** | ❌ No | ✅ Yes (HPA) |
| **Production Parity** | ⚠️ 60% | ✅ 95% |
| **Debugging** | ✅ Easy | ⚠️ Medium |
| **Hot Reload** | ✅ Yes | ❌ Need rebuild |
| **Best For** | Daily coding | Testing K8s features |

### When to Use Local K8s?

✅ **Use Local K8s When:**
- Testing autoscaling behavior
- Validating K8s manifests before deploying
- Testing HA scenarios
- Learning Kubernetes
- Debugging production K8s issues locally

✅ **Use Docker Compose When:**
- Daily development (code → test → code)
- Quick debugging
- Working on a single service
- Limited laptop resources
- Need fast iteration

---

## 💡 Pro Tips

### 1. Faster Rebuilds with Skaffold

```bash
# Install Skaffold
choco install skaffold

# Auto rebuild and deploy on file changes
skaffold dev --port-forward
```

### 2. Use Telepresence for Hot Reload

```bash
# Install Telepresence
choco install telepresence

# Replace K8s pod with local process
telepresence intercept healthcare-api -n healthcare-backend --port 8088:8088
pnpm start:dev  # Run locally, connected to K8s cluster
```

### 3. K9s for Easy Management

```bash
# Install K9s (Kubernetes TUI)
choco install k9s

# Launch
k9s -n healthcare-backend
```

### 4. Switch Contexts Easily

```bash
# View contexts
kubectl config get-contexts

# Switch to Docker Desktop
kubectl config use-context docker-desktop

# Switch to Minikube
kubectl config use-context minikube

# Create alias
alias k8s-local='kubectl config use-context docker-desktop'
alias k8s-prod='kubectl config use-context production-cluster'
```

---

## 📚 Recommended Workflow

```bash
# Daily Development
┌─────────────────────────────────────┐
│ Use Docker Compose (make start)    │
│ - Fast iteration                    │
│ - Hot reload                        │
│ - Easy debugging                    │
└─────────────────────────────────────┘

# Testing K8s Features (1-2 times/week)
┌─────────────────────────────────────┐
│ Use Local K8s (make k8s-local-*)   │
│ - Test autoscaling                  │
│ - Validate manifests                │
│ - Test HA scenarios                 │
└─────────────────────────────────────┘

# Before Production Deploy
┌─────────────────────────────────────┐
│ Test on Staging K8s Cluster         │
│ - Real environment                  │
│ - Load testing                      │
│ - Integration tests                 │
└─────────────────────────────────────┘
```

---

## ✅ Quick Setup Checklist

- [ ] Install Docker Desktop
- [ ] Enable Kubernetes in Docker Desktop
- [ ] Verify: `kubectl get nodes`
- [ ] Create local overlay: `devops/kubernetes/overlays/local/`
- [ ] Add Makefile commands for local K8s
- [ ] Build local image: `make k8s-local-build`
- [ ] Deploy: `make k8s-local-deploy`
- [ ] Access: `make k8s-local-access`
- [ ] Test autoscaling
- [ ] Cleanup: `make k8s-local-stop`

---

**Recommendation:** Start with **Docker Desktop Kubernetes** - it's the easiest and works great on Windows! 🎯
