# Cluster Architecture & Design

## Cluster Topology

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│   k8s-master         │  │   k8s-worker-1       │  │   k8s-worker-2       │
│   (Control Plane)    │  │   (Worker Node)      │  │   (Worker Node)      │
│   4 vCPU, 8GB RAM    │  │   4 vCPU, 8GB RAM    │  │   4 vCPU, 8GB RAM    │
├──────────────────────┤  ├──────────────────────┤  ├──────────────────────┤
│                      │  │                      │  │                      │
│ System Pods:         │  │ System Pods:         │  │ System Pods:         │
│ • kube-apiserver     │  │ • calico-node        │  │ • calico-node        │
│ • kube-scheduler     │  │ • kube-proxy         │  │ • kube-proxy         │
│ • kube-controller    │  │                      │  │                      │
│ • etcd               │  │ Application Pods:    │  │ Application Pods:    │
│ • calico-node        │  │                      │  │                      │
│                      │  │ • postgres-0         │  │ • redis-2            │
│ Application Pods:    │  │   (2 vCPU, 3GB)      │  │   (0.5 vCPU, 1GB)    │
│                      │  │                      │  │                      │
│ • redis-0            │  │ • redis-1            │  │ • api-pod-2, 5, 8    │
│   (0.5 vCPU, 1GB)    │  │   (0.5 vCPU, 1GB)    │  │   (0.25 vCPU, 512MB) │
│                      │  │                      │  │                      │
│ • api-pod-3, 6, 9    │  │ • pgbouncer-1        │  │ • worker-pod-2, 5, 8 │
│   (0.25 vCPU, 512MB) │  │   (0.2 vCPU, 256MB)  │  │   (0.25 vCPU, 512MB) │
│                      │  │                      │  │                      │
│ • worker-pod-3, 6, 9 │  │ • api-pod-1, 4, 7    │  │                      │
│   (0.25 vCPU, 512MB) │  │   (0.25 vCPU, 512MB) │  │                      │
│                      │  │                      │  │                      │
│                      │  │ • worker-pod-1, 4, 7 │  │                      │
│                      │  │   (0.25 vCPU, 512MB) │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

---

## Pod Placement Strategy

### Key Principle: Distribution, Not Duplication

**Each pod runs on ONE node only.** We distribute different pods across nodes for:
- High availability
- Load balancing
- Resource efficiency

### PostgreSQL (StatefulSet - 1 Replica)

**Placement:** One pod on worker-1 (preferred via nodeAffinity)

```yaml
k8s-worker-1: postgres-0 (2 vCPU, 3GB limit)
```

**Why only one?**
- StatefulSet with 1 replica
- Database needs persistent storage
- Single instance (not clustered)

### Redis (StatefulSet - 3 Replicas)

**Placement:** One pod per node (anti-affinity ensures this)

```yaml
k8s-master:    redis-0 (0.5 vCPU, 1GB)
k8s-worker-1:  redis-1 (0.5 vCPU, 1GB)
k8s-worker-2:  redis-2 (0.5 vCPU, 1GB)
```

**Anti-Affinity Rule:**
```yaml
podAntiAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app: redis
      topologyKey: kubernetes.io/hostname
```

**NOT 3 pods on each node** - that would be 9 pods total! We have 3 pods total, one on each node.

### API Pods (Deployment - Auto-scaling)

**Placement:** Distributed across all nodes

**Example with 10 API pods:**
```
k8s-master:    api-pod-3, 6, 9    (3 pods)
k8s-worker-1:  api-pod-1, 4, 7    (3 pods)
k8s-worker-2:  api-pod-2, 5, 8    (4 pods)
```

**NOT 10 pods on each node** - that would be 30 pods total! We have 10 pods total, distributed across nodes.

### Worker Pods (Deployment - Auto-scaling)

Same logic as API pods - distributed for load balancing and HA.

---

## Network Flow

```
Internet
   │
   ▼
┌─────────────────────────────────────────┐
│         Ingress Controller              │
│      (nginx/traefik - external)         │
└─────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────┐
│      healthcare-api Service             │
│      (ClusterIP - Load Balancer)        │
└─────────────────────────────────────────┘
   │
   ├──────────┬──────────┬──────────┐
   ▼          ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
│ API  │  │ API  │  │ API  │  │ API  │
│ Pod  │  │ Pod  │  │ Pod  │  │ Pod  │
│  1   │  │  2   │  │  3   │  │ ...  │
└──────┘  └──────┘  └──────┘  └──────┘
   │          │          │          │
   ├──────────┴──────────┴──────────┤
   │                                │
   ▼                                ▼
┌──────────────┐          ┌──────────────┐
│  PostgreSQL  │          │    Redis     │
│  (via        │          │   Cluster    │
│  PgBouncer)  │          │              │
└──────────────┘          └──────────────┘
   │                                │
   │                                │
   ▼                                ▼
┌─────────────────────────────────────────┐
│      Worker Pods (Background Jobs)      │
│  • Email sending                        │
│  • Notifications                        │
│  • Data processing                      │
└─────────────────────────────────────────┘
```

---

## Scaling Flow

### Horizontal Pod Autoscaler (HPA)

```
┌─────────────────────────────────────────┐
│      Metrics Server (every 15s)         │
│  Collects: CPU, Memory from all pods    │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│      HPA Controller (every 15s)         │
│  Calculates desired replica count       │
└─────────────────────────────────────────┘
              │
              ├─── CPU > 70%? ────┐
              │                    │
              └─── Memory > 80%? ──┤
                                   │
                                   ▼
                    ┌──────────────────────┐
                    │  Scale Up Decision   │
                    │  • Add pods          │
                    │  • Max 3 at a time   │
                    │  • Wait 30s          │
                    └──────────────────────┘
```

### Scale Down Flow

```
┌─────────────────────────────────────────┐
│  Metrics: CPU < 50%, Memory < 60%      │
│  For: 5 minutes (stabilization window)  │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│      Scale Down Decision                │
│  • Remove max 2 pods at a time          │
│  • Or remove 50% of pods                │
│  • Wait 5 minutes between decisions     │
└─────────────────────────────────────────┘
```

---

## High Availability Strategy

### Pod Disruption Budgets

- **API**: minAvailable = 2 (always keep 2 pods running)
- **Workers**: minAvailable = 1 (always keep 1 worker running)
- **Redis**: minAvailable = 2 (keep majority of cluster)
- **PostgreSQL**: minAvailable = 1 (single instance)

### Node Failure Scenario

**If k8s-worker-1 fails:**
- PostgreSQL: DOWN (single instance) - requires restore from backup
- Redis: Degraded (2/3 nodes) - cluster continues with 2 nodes
- API/Workers: Reduced capacity - pods reschedule on other nodes

**Recovery:**
- Fix node or replace
- Restore PostgreSQL from backup
- Redis cluster auto-recovery
- API/Workers auto-scale on other nodes

---

## Resource Allocation

### Per Node Breakdown

**k8s-master (4 vCPU, 8GB RAM):**
- System: ~1 vCPU, 1GB RAM
- Kubernetes: ~0.5 vCPU, 1GB RAM
- Available: ~2.5 vCPU, 6GB RAM

**k8s-worker-1 (4 vCPU, 8GB RAM):**
- System: ~0.5 vCPU, 1GB RAM
- PostgreSQL: 2 vCPU, 3GB RAM
- Redis-1: 0.5 vCPU, 1GB RAM
- PgBouncer: 0.2 vCPU, 256MB RAM
- Available: ~0.8 vCPU, ~2.7GB RAM

**k8s-worker-2 (4 vCPU, 8GB RAM):**
- System: ~0.5 vCPU, 1GB RAM
- Redis-2: 0.5 vCPU, 1GB RAM
- Available: ~3 vCPU, ~6GB RAM

---

## Key Design Decisions

1. **PostgreSQL**: Single instance on worker-1 (consider external DB for HA)
2. **Redis**: 3 pods, one per node (highly available)
3. **API**: Distributed, auto-scales 3-18 pods based on load
4. **Workers**: Distributed, auto-scales 2-12 pods based on load
5. **Scaling**: Automatic via HPA, respects resource limits
6. **Availability**: Protected by Pod Disruption Budgets

---

## Verification

```bash
# See which node each pod is on
kubectl get pods -n healthcare-backend -o wide

# Count pods per node
kubectl get pods -n healthcare-backend -o wide | awk '{print $7}' | sort | uniq -c

# Check pod distribution
kubectl get pods -n healthcare-backend -o wide | grep -E "NAME|api|worker"
```

This shows pods are **distributed**, not duplicated!

