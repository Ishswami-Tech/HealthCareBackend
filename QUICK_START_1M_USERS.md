# ⚡ Quick Start: Deploy for 1 Million Users

## 5-Minute Production Deployment Guide

---

## 🎯 Prerequisites (One-Time Setup)

```bash
# 1. Verify cluster resources
kubectl top nodes
# Need: 20+ cores, 50GB+ RAM available

# 2. Install Metrics Server (if not installed)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# 3. Install cert-manager for SSL (if not installed)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# 4. Verify installations
kubectl get pods -n kube-system | grep metrics-server
kubectl get pods -n cert-manager
```

---

## 🚀 Deploy in 3 Steps

### Step 1: Create Namespace

```bash
kubectl apply -f devops/kubernetes/base/namespace.yaml
```

### Step 2: Create Secrets

**IMPORTANT:** Replace ALL `CHANGE_ME` and `YOUR_*` values with actual credentials!

```bash
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://postgres:YOUR_SECURE_PASSWORD@postgres:5432/userdb' \
  --from-literal=jwt-secret='YOUR_JWT_SECRET_MIN_32_CHARACTERS_LONG_RANDOM_STRING' \
  --from-literal=postgres-user='postgres' \
  --from-literal=postgres-password='YOUR_SECURE_POSTGRES_PASSWORD' \
  --from-literal=redis-password='YOUR_REDIS_PASSWORD' \
  --from-literal=google-client-id='YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com' \
  --from-literal=google-client-secret='YOUR_GOOGLE_CLIENT_SECRET' \
  --from-literal=aws-access-key-id='YOUR_AWS_ACCESS_KEY_ID' \
  --from-literal=aws-secret-access-key='YOUR_AWS_SECRET_ACCESS_KEY' \
  --namespace=healthcare-backend
```

### Step 3: Deploy All Resources

```bash
# Production deployment
kubectl apply -k devops/kubernetes/overlays/production/

# Watch pods starting
kubectl get pods -n healthcare-backend --watch
```

---

## ✅ Verify Deployment

```bash
# 1. Check all resources
kubectl get all,hpa,vpa,pdb -n healthcare-backend

# 2. Check HPA status
kubectl describe hpa healthcare-api-hpa -n healthcare-backend

# 3. Check pod health
kubectl get pods -n healthcare-backend

# 4. View logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend

# 5. Port forward to test locally
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088

# 6. Test health endpoint
curl http://localhost:8088/health
```

---

## 📊 Monitor Auto-Scaling

```bash
# Watch HPA in real-time
kubectl get hpa -n healthcare-backend --watch

# Check current pod count
kubectl get pods -n healthcare-backend -l app=healthcare-api

# View resource usage
kubectl top pods -n healthcare-backend

# Check custom metrics (if configured)
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1
```

---

## 🔍 Access Dashboards

### Custom Logging Dashboard
```
http://your-domain.com/logger
```
- HIPAA-compliant logging
- Real-time log viewing
- Audit trails
- PHI access tracking

### Queue Dashboard
```
http://your-domain.com/queue-dashboard
```
- Background job monitoring
- Queue depths
- Failed jobs

### Health Check
```
http://your-domain.com/health
```

### Metrics (Prometheus Format)
```
http://your-domain.com/metrics
```

---

## 🎯 Expected Auto-Scaling Behavior

| Current Users | Expected Pods | CPU Usage | Action |
|---------------|---------------|-----------|--------|
| 0-25K | 5 (min) | <30% | Baseline |
| 50K | 10 | 50% | Scaling up |
| 100K | 20 | 60% | Scaling up |
| 500K | 100 | 70% | Scaling up |
| **1M** | **200 (max)** | **70%** | **Max capacity** |

### Scaling Timeline
- **Scale Up:** ~2-3 minutes (30s stabilization + pod startup)
- **Scale Down:** ~5-6 minutes (300s stabilization)

---

## 🔥 Load Testing (Recommended)

### Before Production

```bash
# Install k6 (load testing tool)
# https://k6.io/docs/getting-started/installation/

# Basic load test
k6 run - <<EOF
import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },    // Ramp up to 100 users
    { duration: '5m', target: 100 },    // Stay at 100 users
    { duration: '2m', target: 1000 },   // Ramp up to 1000 users
    { duration: '5m', target: 1000 },   // Stay at 1000 users
    { duration: '2m', target: 0 },      // Ramp down
  ],
};

export default function () {
  http.get('http://your-domain.com/health');
  sleep(1);
}
EOF

# Watch HPA scaling during test
kubectl get hpa -n healthcare-backend --watch
```

---

## 🛠️ Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n healthcare-backend

# Common issues:
# 1. ImagePullBackOff - Check image registry
# 2. CrashLoopBackOff - Check logs
# 3. Pending - Check resource availability

# Check logs
kubectl logs <pod-name> -n healthcare-backend
```

### HPA Not Scaling

```bash
# 1. Check metrics server
kubectl get apiservice v1beta1.metrics.k8s.io

# 2. Check if metrics are available
kubectl top pods -n healthcare-backend

# 3. Check HPA status
kubectl describe hpa healthcare-api-hpa -n healthcare-backend

# 4. Check HPA conditions
kubectl get hpa healthcare-api-hpa -n healthcare-backend -o yaml
```

### Database Connection Issues

```bash
# 1. Check PostgreSQL pod
kubectl get pods -n healthcare-backend -l app=postgres

# 2. Check PostgreSQL logs
kubectl logs -f statefulset/postgres -n healthcare-backend

# 3. Test connection from API pod
kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh
# Inside pod:
# apk add postgresql-client
# psql $DATABASE_URL

# 4. Check secrets
kubectl get secret healthcare-secrets -n healthcare-backend -o yaml
```

### Redis Connection Issues

```bash
# 1. Check Redis pods
kubectl get pods -n healthcare-backend -l app=redis

# 2. Check Redis logs
kubectl logs -f statefulset/redis -n healthcare-backend

# 3. Test connection
kubectl exec -it statefulset/redis-0 -n healthcare-backend -- redis-cli ping
```

---

## 🔄 Update Deployment

### Update Application Image

```bash
# 1. Build new image
docker build -t your-registry/healthcare-api:v2.0.0 -f devops/docker/Dockerfile .

# 2. Push to registry
docker push your-registry/healthcare-api:v2.0.0

# 3. Update deployment
kubectl set image deployment/healthcare-api \
  api=your-registry/healthcare-api:v2.0.0 \
  -n healthcare-backend

# 4. Watch rollout
kubectl rollout status deployment/healthcare-api -n healthcare-backend

# 5. Verify new pods
kubectl get pods -n healthcare-backend -l app=healthcare-api
```

### Rollback if Needed

```bash
# Rollback to previous version
kubectl rollout undo deployment/healthcare-api -n healthcare-backend

# Check rollout history
kubectl rollout history deployment/healthcare-api -n healthcare-backend

# Rollback to specific revision
kubectl rollout undo deployment/healthcare-api --to-revision=3 -n healthcare-backend
```

---

## 📊 Resource Monitoring

### Real-Time Monitoring

```bash
# API pod resources
kubectl top pods -n healthcare-backend -l app=healthcare-api

# All pods
kubectl top pods -n healthcare-backend

# Nodes
kubectl top nodes

# HPA status
kubectl get hpa -n healthcare-backend
```

### Check Limits and Requests

```bash
# View resource allocation
kubectl describe deployment healthcare-api -n healthcare-backend | grep -A 5 "Limits:\|Requests:"

# View all resource quotas
kubectl describe resourcequota -n healthcare-backend
```

---

## 🎯 Performance Tips

### 1. Database Connection Pooling

Already configured in PostgreSQL:
- `max_connections = 500`
- Prisma handles pooling automatically

### 2. Redis Caching

Already configured:
- Cache TTL: 3600s
- LRU eviction policy
- Cluster mode for HA

### 3. API Optimization

- Enable compression in Ingress
- Configure CDN for static assets
- Use Redis for session storage

### 4. Monitoring Custom Metrics

```bash
# Check if custom metrics are working
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/healthcare-backend/pods/*/http_requests_per_second | jq .

# View active appointments metric
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/healthcare-backend/pods/*/active_appointments_count | jq .
```

---

## 🔐 Security Checklist

Before going live:

- [ ] All secrets have strong, unique passwords (min 32 chars)
- [ ] JWT secret is cryptographically random
- [ ] Database password is strong and unique
- [ ] OAuth credentials are from production apps
- [ ] AWS credentials have minimal required permissions
- [ ] SSL/TLS is configured on Ingress
- [ ] Rate limiting is enabled
- [ ] Network policies are applied
- [ ] RBAC is configured and tested
- [ ] Audit logging is enabled at `/logger`

---

## 📞 Quick Commands Reference

```bash
# Status
kubectl get all -n healthcare-backend
kubectl get hpa,vpa,pdb -n healthcare-backend

# Logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend

# Scale manually (for testing)
kubectl scale deployment healthcare-api --replicas=10 -n healthcare-backend

# Restart deployment
kubectl rollout restart deployment/healthcare-api -n healthcare-backend

# Delete everything (careful!)
kubectl delete namespace healthcare-backend

# Port forward
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088

# Shell into pod
kubectl exec -it deployment/healthcare-api -n healthcare-backend -- /bin/sh

# Database shell
kubectl exec -it statefulset/postgres -n healthcare-backend -- psql -U postgres -d userdb

# Redis CLI
kubectl exec -it statefulset/redis-0 -n healthcare-backend -- redis-cli
```

---

## 🎉 Success Indicators

### ✅ Deployment is Successful When:

1. All pods are `Running` and `Ready`
   ```bash
   kubectl get pods -n healthcare-backend
   ```

2. HPA shows metrics and current replicas
   ```bash
   kubectl get hpa -n healthcare-backend
   ```

3. Health endpoint returns `200 OK`
   ```bash
   curl http://your-domain.com/health
   ```

4. Logging dashboard is accessible
   ```
   http://your-domain.com/logger
   ```

5. Metrics are being collected
   ```bash
   kubectl top pods -n healthcare-backend
   ```

---

## 📈 Next Steps After Deployment

1. **Monitor for 24 hours**
   - Watch HPA behavior
   - Check custom logging dashboard
   - Monitor database connections

2. **Load test with real traffic patterns**
   - Gradual ramp-up
   - Monitor scaling behavior
   - Check response times

3. **Fine-tune if needed**
   - Adjust HPA thresholds
   - Optimize resource limits
   - Add read replicas if database is bottleneck

4. **Set up alerts** (optional)
   - Prometheus AlertManager
   - Webhook to Slack/PagerDuty
   - Email notifications

5. **Backup strategy**
   ```bash
   # Schedule automated backups
   make db-backup
   ```

---

**You're now ready for 1 MILLION concurrent users!** 🚀

**Questions?** Check [PRODUCTION_OPTIMIZATION_1M_USERS.md](PRODUCTION_OPTIMIZATION_1M_USERS.md) for detailed documentation.
