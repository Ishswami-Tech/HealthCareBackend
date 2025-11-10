# Kubernetes Setup Guide

## Current Configuration: 3 × VPS 10 (Dev Phase)

**Cluster Setup:**
- **3 × CLOUD VPS 10**: 4 vCPU, 8GB RAM each
- **Total Resources**: 12 vCPU, 24GB RAM
- **Cost**: $11.88/month
- **Capacity**: 150-200 active users (dev/testing)

**Note:** Starting with VPS 10 for dev phase, will upgrade to VPS 20+ for production.

---

## Quick Start

### 1. Setup Kubernetes Cluster

#### On ALL Servers (Initial Setup)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Set hostnames
sudo hostnamectl set-hostname k8s-master      # On master
sudo hostnamectl set-hostname k8s-worker-1    # On worker 1
sudo hostnamectl set-hostname k8s-worker-2    # On worker 2

# Add to /etc/hosts (replace with actual IPs)
sudo tee -a /etc/hosts <<EOF
<MASTER_IP> k8s-master
<WORKER1_IP> k8s-worker-1
<WORKER2_IP> k8s-worker-2
EOF

# Disable swap
sudo swapoff -a
sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab

# Load kernel modules
sudo modprobe overlay
sudo modprobe br_netfilter

# Configure sysctl
sudo tee /etc/sysctl.d/kubernetes.conf <<EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system

# Install containerd
sudo apt install -y containerd
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable containerd

# Install Kubernetes
sudo apt install -y apt-transport-https ca-certificates curl gpg
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt update
sudo apt install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable kubelet

# Configure firewall
sudo ufw allow 6443/tcp
sudo ufw allow 2379:2380/tcp
sudo ufw allow 10250/tcp
sudo ufw allow 10259/tcp
sudo ufw allow 10257/tcp
sudo ufw allow 30000:32767/tcp
sudo ufw allow 179/tcp
sudo ufw allow 4789/udp
sudo ufw allow 51820/udp
sudo ufw allow 51821/udp
```

#### On CONTROL PLANE Only

```bash
# Initialize cluster (replace <MASTER_IP> with actual IP)
sudo kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --apiserver-advertise-address=<MASTER_IP> \
  --control-plane-endpoint=<MASTER_IP> \
  --upload-certs

# Configure kubectl
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Install Calico
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.4/manifests/calico.yaml
kubectl wait --for=condition=ready pod -l k8s-app=calico-node -n kube-system --timeout=300s

# Get join command (save for workers)
kubeadm token create --print-join-command
```

#### On WORKER NODES Only

```bash
# Run the join command from master
sudo kubeadm join <MASTER_IP>:6443 \
  --token <TOKEN> \
  --discovery-token-ca-cert-hash sha256:<HASH>
```

### 2. Configure Application

```bash
# Label nodes
kubectl label node k8s-master node-role=control-plane workload=stateful
kubectl label node k8s-worker-1 node-role=worker workload=stateful
kubectl label node k8s-worker-2 node-role=worker workload=stateless

# Optional: Taint master to prevent workloads
kubectl taint nodes k8s-master node-role=control-plane:NoSchedule
```

### 3. Apply Dynamic Configuration

```bash
# Step 1: Calculate configuration for VPS 10 (dev phase)
.\devops\kubernetes\scripts\calculate-cluster-config.ps1 -NewTier vps10 -NodeCount 3

# Step 2: Apply all configurations (resources, HPA, quotas)
./devops/kubernetes/scripts/apply-dynamic-config.sh
```

### 4. Deploy Application

```powershell
# Production
.\scripts\deploy-production.ps1

# Local (Docker Desktop)
.\scripts\deploy-local.ps1
```

---

## Resource Configuration

### Resource Limits (VPS 10 - Dev Phase)

| Component | Requests | Limits |
|-----------|----------|--------|
| **PostgreSQL** | 1 vCPU, 2GB | 2 vCPU, 3GB |
| **Redis (per pod)** | 0.25 vCPU, 512MB | 0.5 vCPU, 1GB |
| **API Pod** | 0.25 vCPU, 512MB | 1.5 vCPU, 1.5GB |
| **Worker Pod** | 0.25 vCPU, 512MB | 1.5 vCPU, 1.5GB |
| **PgBouncer** | 0.05 vCPU, 64MB | 0.2 vCPU, 256MB |

### HPA Settings (VPS 10)

- **API**: 3-15 pods (min-max), Target: 70% CPU, 80% Memory
- **Workers**: 2-10 pods (min-max), Target: 70% CPU, 80% Memory

### Pod Distribution (VPS 10)

```
k8s-master:    redis-0, 2-3 API pods, 1-2 Worker pods
k8s-worker-1:  postgres-0, redis-1, pgbouncer, 3-4 API pods, 2 Worker pods
k8s-worker-2:  redis-2, 4-5 API pods, 2-3 Worker pods
```

---

## Bottleneck Prevention

### Key Optimizations

1. **PostgreSQL**: Reduced max_connections to 100, optimized memory settings
2. **Connection Pools**: API 50 max, Workers 30 max (prevents exhaustion)
3. **Redis**: Optimized memory policy, increased resources
4. **HPA**: Scales earlier (65% CPU, 75% Memory) to prevent bottlenecks

### Monitoring

```bash
# Check resources
kubectl top nodes
kubectl top pods -n healthcare-backend

# Check HPA
kubectl get hpa -n healthcare-backend

# Check database connections
kubectl exec -it postgres-0 -n healthcare-backend -- \
  psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## Troubleshooting

### Node Not Joining

```bash
# Check kubelet
sudo systemctl status kubelet
sudo journalctl -u kubelet -f
```

### Pods Stuck in Pending

```bash
kubectl describe pod <pod-name> -n healthcare-backend
kubectl describe node <node-name>
```

### High Resource Usage

```bash
# Identify resource-heavy pods
kubectl top pods -n healthcare-backend --sort-by=memory
kubectl top pods -n healthcare-backend --sort-by=cpu
```

### Database Performance

```bash
# Check PostgreSQL resources
kubectl top pod postgres-0 -n healthcare-backend

# Check connections
kubectl exec -it postgres-0 -n healthcare-backend -- \
  psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

### Reset Cluster

```bash
# On master
sudo kubeadm reset
sudo rm -rf /etc/cni/net.d /var/lib/etcd

# On workers
sudo kubeadm reset
```

---

## Verification

```bash
# Check nodes
kubectl get nodes

# Check pods
kubectl get pods -n healthcare-backend -o wide

# Check resource quotas
kubectl describe resourcequota healthcare-quotas -n healthcare-backend

# Check HPA status
kubectl get hpa -n healthcare-backend
```

---

## Next Steps

1. Setup ingress controller (nginx, traefik)
2. Configure persistent storage
3. Setup monitoring (Prometheus, Grafana)
4. Configure backup strategy
5. **Upgrade to VPS 20** when moving to production (see [SCALING_GUIDE.md](./SCALING_GUIDE.md))

