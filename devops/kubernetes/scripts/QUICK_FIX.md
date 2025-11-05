# Quick Fix Commands for Local Deployment Issues

## Current Status

The deployment script has been updated to handle:
- ✅ Worker image patching
- ✅ Secret creation with AWS keys
- ✅ PgBouncer scaling down
- ✅ Replica scaling for local dev

## If Pods Are Still Failing

Run these commands to fix the current deployment:

```powershell
# 1. Recreate secret with all required keys
kubectl delete secret healthcare-secrets -n healthcare-backend
kubectl create secret generic healthcare-secrets `
  --namespace healthcare-backend `
  --from-literal=postgres-user=postgres `
  --from-literal=postgres-password=postgres123 `
  --from-literal=database-url=postgresql://postgres:postgres123@postgres:5432/userdb?schema=public `
  --from-literal=database-migration-url=postgresql://postgres:postgres123@postgres:5432/userdb?schema=public `
  --from-literal=redis-password=redis123 `
  --from-literal=jwt-secret=local-dev-jwt-secret `
  --from-literal=aws-access-key-id=dummy `
  --from-literal=aws-secret-access-key=dummy `
  --from-literal=aws-region=us-east-1

# 2. Reapply worker deployment with optional secrets
kubectl apply -f devops\kubernetes\base\worker-deployment.yaml -n healthcare-backend

# 3. Delete stuck pods
kubectl delete pods -l app=healthcare-worker -n healthcare-backend --force --grace-period=0
kubectl delete pods -l app=healthcare-api -n healthcare-backend --force --grace-period=0

# 4. Update images
kubectl set image deployment/healthcare-api api=healthcare-api:local -n healthcare-backend
kubectl set image deployment/healthcare-worker worker=healthcare-api:local -n healthcare-backend

# 5. Set image pull policy
kubectl patch deployment healthcare-api -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]'
kubectl patch deployment healthcare-worker -n healthcare-backend --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]'

# 6. Scale down for local
kubectl scale deployment healthcare-api --replicas=1 -n healthcare-backend
kubectl scale deployment healthcare-worker --replicas=1 -n healthcare-backend
kubectl scale deployment pgbouncer --replicas=0 -n healthcare-backend

# 7. Check status
kubectl get pods -n healthcare-backend
```

## Verify Everything Works

```powershell
# Check all pods are running
kubectl get pods -n healthcare-backend

# Check API is accessible
kubectl port-forward -n healthcare-backend svc/healthcare-api 8088:8088
# Then open: http://localhost:8088/health
```

