# 🚀 Kubernetes Deployment Guide

Production-ready Kubernetes manifests with enterprise-grade autoscaling for Healthcare Backend supporting **1M+ concurrent users** and **200+ clinics**.

## 📁 Structure

```
kubernetes/
├── base/                           # Base Kubernetes resources
│   ├── namespace.yaml              # Namespace definition
│   ├── api-deployment.yaml         # API deployment with HPA
│   ├── postgres-statefulset.yaml   # PostgreSQL StatefulSet
│   ├── redis-cluster.yaml          # Redis cluster with HA
│   ├── ingress.yaml                # Ingress with SSL/TLS
│   ├── pdb.yaml                    # PodDisruptionBudget for HA
│   ├── vpa.yaml                    # VerticalPodAutoscaler
│   ├── metrics-server.yaml         # Custom metrics configuration
│   ├── kustomization.yaml          # Kustomize base config
│   └── secrets.yaml.template       # Secrets template
│
└── overlays/                       # Environment-specific configs
    ├── staging/
    │   └── kustomization.yaml      # Staging overrides
    └── production/
        └── kustomization.yaml      # Production overrides
```

## 🎯 Features

### ✅ Horizontal Pod Autoscaler (HPA)
- **API Scaling:** 3-50 pods based on CPU, memory, and custom metrics
- **Redis Scaling:** 3-9 nodes based on memory/CPU
- **Custom Metrics:**
  - `http_requests_per_second` - Scale at 1000 RPS per pod
  - `active_appointments_count` - Scale at 500 active appointments per pod

### ✅ Vertical Pod Autoscaler (VPA)
- **Auto-adjust** resource requests/limits based on actual usage
- **API VPA:** 250m-4000m CPU, 512Mi-8Gi memory
- **Redis VPA:** 100m-2000m CPU, 256Mi-4Gi memory
- **PostgreSQL VPA:** 500m-4000m CPU, 1Gi-16Gi memory

### ✅ High Availability
- **PodDisruptionBudget:** Ensures minimum pods during updates
- **Pod Anti-Affinity:** Redis nodes spread across different hosts
- **Rolling Updates:** Zero-downtime deployments
- **Health Probes:** Liveness, readiness, and startup checks

### ✅ Resource Management
- **Production API:** 2Gi-8Gi memory, 2-4 CPU per pod
- **Production PostgreSQL:** 8Gi-16Gi memory, 100Gi storage
- **Production Redis Cluster:** 3-6 nodes with 10Gi storage each

## 🚀 Quick Start

### Prerequisites

```bash
# Required tools
kubectl v1.28+
kustomize v5.0+
helm v3.0+ (for metrics-server)

# Required cluster addons
- Metrics Server
- Vertical Pod Autoscaler (optional but recommended)
- Prometheus Operator (for custom metrics)
- cert-manager (for SSL/TLS)
```

### 1. Install Cluster Prerequisites

```bash
# Install Metrics Server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Install VPA (optional)
git clone https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler
./hack/vpa-up.sh

# Install Prometheus Operator (for custom metrics)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace

# Install cert-manager (for SSL)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

### 2. Deploy Application

#### Development/Staging

```bash
# Create namespace
kubectl apply -f base/namespace.yaml

# Create secrets (update values first)
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://user:pass@postgres:5432/userdb' \
  --from-literal=jwt-secret='your-jwt-secret' \
  --from-literal=postgres-user='postgres' \
  --from-literal=postgres-password='your-password' \
  --namespace=healthcare-backend

# Deploy all resources
kubectl apply -k base/

# Check status
kubectl get pods -n healthcare-backend
kubectl get hpa -n healthcare-backend
kubectl get vpa -n healthcare-backend
```

#### Staging Environment

```bash
# Deploy to staging
kubectl apply -k overlays/staging/

# Verify
kubectl get pods -n healthcare-backend-staging
kubectl get hpa -n healthcare-backend-staging
```

#### Production Environment

```bash
# Deploy to production
kubectl apply -k overlays/production/

# Verify deployment
kubectl get pods -n healthcare-backend
kubectl get hpa,vpa,pdb -n healthcare-backend

# Check autoscaling status
kubectl describe hpa healthcare-api-hpa -n healthcare-backend
```

## 📊 Monitoring & Observability

### Check Deployment Status

```bash
# Get all resources
kubectl get all -n healthcare-backend

# Get pods with resource usage
kubectl top pods -n healthcare-backend

# Get nodes resource usage
kubectl top nodes

# Watch HPA scaling
kubectl get hpa -n healthcare-backend --watch

# Check VPA recommendations
kubectl describe vpa healthcare-api-vpa -n healthcare-backend
```

### View Logs

```bash
# API logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend

# PostgreSQL logs
kubectl logs -f statefulset/postgres -n healthcare-backend

# Redis logs
kubectl logs -f statefulset/redis -n healthcare-backend

# All pod logs
kubectl logs -f -l app=healthcare-api -n healthcare-backend
```

### Access Services

```bash
# Port forward API
kubectl port-forward svc/healthcare-api 8088:8088 -n healthcare-backend

# Port forward PostgreSQL
kubectl port-forward svc/postgres 5432:5432 -n healthcare-backend

# Port forward Redis
kubectl port-forward svc/redis 6379:6379 -n healthcare-backend

# Access via exec
kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh
```

## 🔄 Scaling Operations

### Manual Scaling

```bash
# Scale API manually
kubectl scale deployment healthcare-api --replicas=10 -n healthcare-backend

# Scale Redis cluster
kubectl scale statefulset redis --replicas=6 -n healthcare-backend
```

### HPA Configuration

```bash
# View HPA status
kubectl get hpa healthcare-api-hpa -n healthcare-backend

# Describe HPA (shows current metrics)
kubectl describe hpa healthcare-api-hpa -n healthcare-backend

# Edit HPA
kubectl edit hpa healthcare-api-hpa -n healthcare-backend
```

### Custom Metrics

```bash
# Check if custom metrics are available
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq .

# View specific custom metric
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/healthcare-backend/pods/*/http_requests_per_second" | jq .

# View active appointments metric
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/healthcare-backend/pods/*/active_appointments_count" | jq .
```

## 🔄 Updates & Rollbacks

### Rolling Updates

```bash
# Update API image
kubectl set image deployment/healthcare-api \
  api=your-registry/healthcare-api:v2.0.0 \
  -n healthcare-backend

# Watch rollout
kubectl rollout status deployment/healthcare-api -n healthcare-backend

# Check rollout history
kubectl rollout history deployment/healthcare-api -n healthcare-backend
```

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/healthcare-api -n healthcare-backend

# Rollback to specific revision
kubectl rollout undo deployment/healthcare-api --to-revision=3 -n healthcare-backend

# Pause rollout
kubectl rollout pause deployment/healthcare-api -n healthcare-backend

# Resume rollout
kubectl rollout resume deployment/healthcare-api -n healthcare-backend
```

## 🔐 Secrets Management

### Create Secrets

```bash
# From literal values
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://user:pass@postgres:5432/userdb' \
  --from-literal=jwt-secret='your-jwt-secret' \
  --from-literal=postgres-user='postgres' \
  --from-literal=postgres-password='your-password' \
  --namespace=healthcare-backend

# From files
kubectl create secret generic healthcare-secrets \
  --from-file=database-url=./secrets/database-url.txt \
  --from-file=jwt-secret=./secrets/jwt-secret.txt \
  --namespace=healthcare-backend

# From env file
kubectl create secret generic healthcare-secrets \
  --from-env-file=.env.production \
  --namespace=healthcare-backend
```

### Using Sealed Secrets (Recommended for Production)

```bash
# Install Sealed Secrets controller
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Create sealed secret
kubeseal --format yaml < secrets.yaml > sealed-secrets.yaml

# Apply sealed secret
kubectl apply -f sealed-secrets.yaml -n healthcare-backend
```

## 🏗️ Resource Requirements

### Development

| Component | Replicas | CPU Request | CPU Limit | Memory Request | Memory Limit | Storage |
|-----------|----------|-------------|-----------|----------------|--------------|---------|
| API | 3 | 500m | 2000m | 1Gi | 2Gi | - |
| PostgreSQL | 1 | 1000m | 2000m | 2Gi | 4Gi | 20Gi |
| Redis | 3 | 250m | 500m | 512Mi | 1Gi | 10Gi |

### Staging

| Component | Replicas | CPU Request | CPU Limit | Memory Request | Memory Limit | Storage |
|-----------|----------|-------------|-----------|----------------|--------------|---------|
| API | 3-20 (HPA) | 1000m | 2000m | 2Gi | 4Gi | - |
| PostgreSQL | 1 | 1000m | 2000m | 4Gi | 8Gi | 50Gi |
| Redis | 3 | 500m | 1000m | 1Gi | 2Gi | 10Gi |

### Production

| Component | Replicas | CPU Request | CPU Limit | Memory Request | Memory Limit | Storage |
|-----------|----------|-------------|-----------|----------------|--------------|---------|
| API | 10-100 (HPA) | 2000m | 4000m | 4Gi | 8Gi | - |
| PostgreSQL | 1 | 2000m | 4000m | 8Gi | 16Gi | 100Gi |
| Redis | 6-9 (HPA) | 500m | 1000m | 1Gi | 2Gi | 10Gi each |

## 🔧 Troubleshooting

### Common Issues

#### Pods Not Scaling

```bash
# Check HPA status
kubectl describe hpa healthcare-api-hpa -n healthcare-backend

# Check metrics server
kubectl get apiservice v1beta1.metrics.k8s.io -o yaml

# Check if metrics are available
kubectl top pods -n healthcare-backend
```

#### Custom Metrics Not Working

```bash
# Check Prometheus Operator
kubectl get pods -n monitoring

# Check ServiceMonitor
kubectl get servicemonitor -n healthcare-backend

# Check PrometheusRule
kubectl get prometheusrule -n healthcare-backend

# View Prometheus targets
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
# Open http://localhost:9090/targets
```

#### VPA Not Working

```bash
# Check VPA components
kubectl get pods -n kube-system | grep vpa

# Check VPA recommendations
kubectl describe vpa healthcare-api-vpa -n healthcare-backend

# View VPA status
kubectl get vpa -n healthcare-backend -o yaml
```

#### Pod Evictions

```bash
# Check PodDisruptionBudget
kubectl get pdb -n healthcare-backend

# Check node resources
kubectl describe nodes | grep -A 5 "Allocated resources"

# Check pod priority
kubectl get pods -n healthcare-backend -o custom-columns=NAME:.metadata.name,PRIORITY:.spec.priority
```

### Health Checks

```bash
# Check pod health
kubectl get pods -n healthcare-backend -o wide

# Check events
kubectl get events -n healthcare-backend --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n healthcare-backend
kubectl top nodes

# Check cluster autoscaler (if enabled)
kubectl logs -f deployment/cluster-autoscaler -n kube-system
```

## 📈 Performance Optimization

### Enable Cluster Autoscaler

```bash
# For AWS EKS
helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  --namespace kube-system \
  --set autoDiscovery.clusterName=<CLUSTER_NAME> \
  --set awsRegion=<REGION>

# For GKE
gcloud container clusters update <CLUSTER_NAME> \
  --enable-autoscaling \
  --min-nodes=3 \
  --max-nodes=20
```

### Optimize Resource Limits

```bash
# Get VPA recommendations
kubectl describe vpa healthcare-api-vpa -n healthcare-backend

# Apply recommended limits
kubectl patch deployment healthcare-api -n healthcare-backend \
  --patch "$(kubectl get vpa healthcare-api-vpa -n healthcare-backend -o jsonpath='{.status.recommendation}')"
```

## 🎯 Production Checklist

- [ ] Metrics Server installed and working
- [ ] VPA installed (optional but recommended)
- [ ] Prometheus Operator installed for custom metrics
- [ ] cert-manager installed for SSL/TLS
- [ ] Secrets created and properly configured
- [ ] Resource requests and limits configured
- [ ] HPA configured with appropriate thresholds
- [ ] PodDisruptionBudget configured
- [ ] Ingress with SSL/TLS configured
- [ ] Backup strategy for PostgreSQL
- [ ] Monitoring and alerting setup
- [ ] Log aggregation configured
- [ ] Network policies applied
- [ ] RBAC policies configured
- [ ] Image pull secrets configured
- [ ] CI/CD pipeline integrated

## 📚 Additional Resources

- [Kubernetes HPA Documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [VPA Documentation](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
- [Custom Metrics API](https://github.com/kubernetes-sigs/custom-metrics-apiserver)
- [Prometheus Operator](https://github.com/prometheus-operator/prometheus-operator)
- [Kustomize Documentation](https://kustomize.io/)

---

**Last Updated:** January 2025
**Kubernetes Version:** 1.28+
**Status:** ✅ Production Ready
