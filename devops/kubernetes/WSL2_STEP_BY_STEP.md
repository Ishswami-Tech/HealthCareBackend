# Complete Step-by-Step Guide: Running Healthcare Backend on WSL2 with k3s

## Prerequisites Check ✅

You've already completed:
- ✅ Installed nerdctl
- ✅ Installed BuildKit
- ✅ Configured kubectl

## Step-by-Step Instructions

### Step 1: Verify k3s is Installed and Running

```bash
# Check if k3s is installed
which k3s

# If not installed, install it:
curl -sfL https://get.k3s.io | sh -

# Check k3s status
sudo systemctl status k3s

# If k3s is not running, start it:
sudo systemctl start k3s

# Enable k3s to start on boot (optional)
sudo systemctl enable k3s

# Verify k3s is running
sudo systemctl is-active k3s
# Should output: active
```

**Expected output:**
```
● k3s.service - Lightweight Kubernetes
     Loaded: loaded (/etc/systemd/system/k3s.service; enabled)
     Active: active (running)
```

---

### Step 2: Configure nerdctl for k3s

```bash
# Create nerdctl config directory
mkdir -p ~/.config/nerdctl

# Create configuration file
cat > ~/.config/nerdctl/nerdctl.toml <<EOF
address = "/run/k3s/containerd/containerd.sock"
namespace = "k8s.io"
EOF

# Verify the config file was created
cat ~/.config/nerdctl/nerdctl.toml

# Test nerdctl can connect to k3s containerd
nerdctl images
```

**Expected output:**
```
REPOSITORY    TAG       IMAGE ID    CREATED    SIZE
```

---

### Step 3: Verify kubectl is Configured

```bash
# Check if kubectl can connect to k3s
kubectl cluster-info

# Check nodes
kubectl get nodes

# Should show something like:
# NAME              STATUS   ROLES                  AGE   VERSION
# bsome-desktop...  Ready    control-plane,master   1d    v1.28.x+k3s1
```

**If kubectl is not configured:**

```bash
# Create kubectl config directory
mkdir -p ~/.kube

# Copy k3s kubeconfig
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config

# Set correct permissions
sudo chown $USER:$USER ~/.kube/config
chmod 600 ~/.kube/config

# Update server URL to use localhost
sed -i 's/127.0.0.1/localhost/g' ~/.kube/config

# Test again
kubectl get nodes
```

---

### Step 4: Navigate to Project Directory

```bash
# Go to your project directory
cd /mnt/d/project/Healthcare/HealthCareBackend

# Verify you're in the right place
pwd
# Should output: /mnt/d/project/Healthcare/HealthCareBackend

# Check if Dockerfile exists
ls -la devops/docker/Dockerfile
```

---

### Step 5: Build the Docker Image

```bash
# Build the image (this will take 5-10 minutes the first time)
nerdctl build -f devops/docker/Dockerfile -t healthcare-api:local .

# Watch the build progress - you'll see:
# [1/8] FROM node:20-slim
# [2/8] RUN corepack enable...
# etc.
```

**Expected output:**
```
[+] Building 123.4s (18/18) FINISHED
 => [internal] load build definition from Dockerfile
 => [internal] load .dockerignore
 => [1/8] FROM docker.io/library/node:20-slim
 ...
 => [8/8] CMD ["node", "dist/main.js"]
 => exporting to image
 => => exporting layers
 => => writing image sha256:abc123...
 => => naming to docker.io/library/healthcare-api:local
✅ Image built successfully!
```

**If you get permission errors:**
```bash
# Try with sudo (if needed)
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io build -f devops/docker/Dockerfile -t healthcare-api:local .
```

---

### Step 6: Verify the Image was Built

```bash
# List all images
nerdctl images

# You should see healthcare-api:local in the list
nerdctl images | grep healthcare-api

# Or check in k3s namespace
sudo nerdctl --namespace k8s.io images | grep healthcare-api
```

**Expected output:**
```
docker.io/library/healthcare-api    local    abc123def456    2 minutes ago    500MB
```

---

### Step 7: Deploy to Kubernetes

```bash
# Make sure you're in the project directory
cd /mnt/d/project/Healthcare/HealthCareBackend

# Deploy using the deployment script
./devops/kubernetes/scripts/deploy-containerd.sh
```

**Or deploy manually:**

```bash
# Create namespace
kubectl create namespace healthcare-backend --dry-run=client -o yaml | kubectl apply -f -

# Create secrets
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

kubectl create secret generic wal-g-secrets \
    --namespace healthcare-backend \
    --from-literal=WALG_S3_PREFIX=dummy \
    --from-literal=AWS_ACCESS_KEY_ID=dummy \
    --from-literal=AWS_SECRET_ACCESS_KEY=dummy \
    --from-literal=AWS_REGION=us-east-1 \
    --from-literal=WALG_S3_ENDPOINT=dummy \
    --dry-run=client -o yaml | kubectl apply -f -

# Apply Kubernetes resources
cd devops/kubernetes/overlays/local
kubectl kustomize . | kubectl apply -f -
```

---

### Step 8: Wait for Deployment to Complete

```bash
# Watch pods being created
kubectl get pods -n healthcare-backend -w

# Or check status
kubectl get pods -n healthcare-backend

# Check if all pods are running (wait for them to be "Running")
kubectl wait --for=condition=ready pod -l app=healthcare-api -n healthcare-backend --timeout=300s
```

**Expected output:**
```
NAME                              READY   STATUS    RESTARTS   AGE
healthcare-api-xxxxx-xxxxx        1/1     Running   0          2m
healthcare-worker-xxxxx-xxxxx     1/1     Running   0          2m
postgres-0                        1/1     Running   0          3m
redis-0                           1/1     Running   0          3m
```

**If pods are not starting:**
```bash
# Check pod status
kubectl describe pod <pod-name> -n healthcare-backend

# Check logs
kubectl logs <pod-name> -n healthcare-backend

# Check events
kubectl get events -n healthcare-backend --sort-by='.lastTimestamp'
```

---

### Step 9: Check Services

```bash
# List all services
kubectl get svc -n healthcare-backend

# Should show:
# NAME              TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
# healthcare-api    ClusterIP   10.43.x.x       <none>        8088/TCP   5m
# postgres          ClusterIP   10.43.x.x       <none>        5432/TCP   5m
# redis             ClusterIP   10.43.x.x       <none>        6379/TCP   5m
```

---

### Step 10: Access the Application

```bash
# Port forward the API service
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088

# Keep this terminal open - it will show:
# Forwarding from 127.0.0.1:8088 -> 8088
# Forwarding from [::1]:8088 -> 8088
```

**In a NEW terminal (keep the port-forward running):**

```bash
# Test the health endpoint
curl http://localhost:8088/health

# Or test in browser
# Open: http://localhost:8088/health
```

**Expected response:**
```json
{"status":"ok","timestamp":"2024-..."}
```

---

## Quick Reference Commands

### Check Everything is Working

```bash
# Check k3s
sudo systemctl status k3s

# Check images
nerdctl images | grep healthcare-api

# Check pods
kubectl get pods -n healthcare-backend

# Check services
kubectl get svc -n healthcare-backend

# View logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend
```

### View Application Logs

```bash
# API logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend

# Worker logs
kubectl logs -f deployment/healthcare-worker -n healthcare-backend

# All logs
kubectl logs -f --all-containers=true -l app=healthcare-api -n healthcare-backend
```

### Access Pod Shell

```bash
# Get into API pod
kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh

# Get into database pod
kubectl exec -it postgres-0 -n healthcare-backend -- /bin/sh
```

### Restart Deployment

```bash
# Restart API
kubectl rollout restart deployment/healthcare-api -n healthcare-backend

# Restart worker
kubectl rollout restart deployment/healthcare-worker -n healthcare-backend
```

### Clean Up

```bash
# Delete entire namespace (removes everything)
kubectl delete namespace healthcare-backend

# Delete specific deployment
kubectl delete deployment healthcare-api -n healthcare-backend
```

---

## Troubleshooting

### Issue: "rootless containerd not running"

**Solution:** Already fixed in Step 2, but if you still see this:
```bash
cat ~/.config/nerdctl/nerdctl.toml
# Should show:
# address = "/run/k3s/containerd/containerd.sock"
# namespace = "k8s.io"
```

### Issue: "k3s not running"

```bash
# Start k3s
sudo systemctl start k3s

# Check logs
sudo journalctl -u k3s -f
```

### Issue: "ImagePullBackOff" or "ErrImagePull"

```bash
# Verify image exists in k3s namespace
sudo nerdctl --namespace k8s.io images | grep healthcare-api

# If not, import it
nerdctl save healthcare-api:local | sudo nerdctl --namespace k8s.io load -i -

# Restart the deployment
kubectl rollout restart deployment/healthcare-api -n healthcare-backend
```

### Issue: Pods stuck in "Pending"

```bash
# Check why
kubectl describe pod <pod-name> -n healthcare-backend

# Check node resources
kubectl top nodes

# Check if there are enough resources
kubectl describe nodes
```

### Issue: Port forward not working

```bash
# Make sure port 8088 is not in use
netstat -tlnp | grep 8088

# Try different port
kubectl port-forward -n healthcare-backend svc/healthcare-api 8089:8088

# Then access: http://localhost:8089
```

---

## Summary Checklist

- [ ] k3s installed and running
- [ ] nerdctl configured for k3s
- [ ] kubectl configured
- [ ] Image built successfully
- [ ] Deployed to Kubernetes
- [ ] All pods running
- [ ] Port forward active
- [ ] Application accessible at http://localhost:8088

---

## Next Steps After Setup

1. **Set up database migrations:**
   ```bash
   kubectl get jobs -n healthcare-backend
   kubectl logs job/healthcare-db-migration -n healthcare-backend
   ```

2. **Monitor the application:**
   ```bash
   kubectl get pods -n healthcare-backend -w
   ```

3. **Access API documentation:**
   - If Swagger is enabled: http://localhost:8088/api/docs

4. **View logs continuously:**
   ```bash
   kubectl logs -f deployment/healthcare-api -n healthcare-backend
   ```

---

## Complete Command Sequence

Here's everything in one sequence (copy and paste):

```bash
# 1. Install k3s (if not installed)
curl -sfL https://get.k3s.io | sh -
sudo systemctl start k3s

# 2. Configure nerdctl
mkdir -p ~/.config/nerdctl
cat > ~/.config/nerdctl/nerdctl.toml <<EOF
address = "/run/k3s/containerd/containerd.sock"
namespace = "k8s.io"
EOF

# 3. Configure kubectl (if needed)
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER:$USER ~/.kube/config
chmod 600 ~/.kube/config
sed -i 's/127.0.0.1/localhost/g' ~/.kube/config

# 4. Navigate to project
cd /mnt/d/project/Healthcare/HealthCareBackend

# 5. Build image
nerdctl build -f devops/docker/Dockerfile -t healthcare-api:local .

# 6. Deploy
./devops/kubernetes/scripts/deploy-containerd.sh

# 7. Wait for pods
kubectl wait --for=condition=ready pod -l app=healthcare-api -n healthcare-backend --timeout=300s

# 8. Port forward (keep this running)
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088
```

That's it! Your application should now be running at http://localhost:8088

