# Kubernetes Production Setup Checklist

## ✅ Verification Summary

This document summarizes the Kubernetes production setup verification and fixes applied.

## 🔧 Fixed Issues

### 1. Secrets Template
**Status:** ✅ **FIXED**

Added missing secret to `devops/kubernetes/base/secrets.yaml.template`:

- ✅ `openvidu-secret` - OpenVidu server secret (minimum 32 characters)

**Note:** All secrets must be base64 encoded before adding to secrets.yaml.

### 2. Secrets Application Script
**Status:** ✅ **ENHANCED**

Updated `devops/kubernetes/scripts/apply-healthcare-secrets.sh` to support optional secrets:

- ✅ `OPENVIDU_SECRET` - OpenVidu server secret
- ✅ `GOOGLE_CLIENT_ID` - Google OAuth client ID
- ✅ `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- ✅ `AWS_ACCESS_KEY_ID` - AWS access key
- ✅ `AWS_SECRET_ACCESS_KEY` - AWS secret key
- ✅ `AWS_REGION` - AWS region
- ✅ `FIREBASE_PROJECT_ID` - Firebase project ID
- ✅ `FIREBASE_PRIVATE_KEY` - Firebase private key
- ✅ `FIREBASE_CLIENT_EMAIL` - Firebase client email

## ✅ Verified Components

### 3. API Deployment
**Status:** ✅ **VERIFIED**

The API deployment (`devops/kubernetes/base/api-deployment.yaml`) is properly configured:

- ✅ Loads secrets from `healthcare-secrets`:
  - `DATABASE_URL` (from `database-url`)
  - `JWT_SECRET` (from `jwt-secret`)
  - `SESSION_SECRET` (from `session-secret`)
  - `COOKIE_SECRET` (from `cookie-secret`)
- ✅ Loads config from `healthcare-api-config` ConfigMap
- ✅ Health checks configured (liveness, readiness, startup)
- ✅ Resource limits set (1Gi request, 2Gi limit)
- ✅ Security context configured (non-root, read-only filesystem)
- ✅ Pod anti-affinity for high availability
- ✅ HPA configured (3-200 replicas)

### 4. Worker Deployment
**Status:** ✅ **VERIFIED**

The Worker deployment (`devops/kubernetes/base/worker-deployment.yaml`) is properly configured:

- ✅ Loads secrets from `healthcare-secrets`:
  - `DATABASE_URL` (from `database-url`)
  - `JWT_SECRET` (from `jwt-secret`)
  - `REDIS_PASSWORD` (from `redis-password`, optional)
  - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (optional)
  - `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` (optional)
- ✅ Resource limits set (1Gi request, 2Gi limit)
- ✅ Security context configured
- ✅ Pod anti-affinity for high availability
- ✅ HPA configured (3-200 replicas)

### 5. ConfigMap
**Status:** ✅ **VERIFIED**

The ConfigMap (`devops/kubernetes/base/configmap.yaml`) contains:

- ✅ Application configuration (non-sensitive)
- ✅ Cache configuration (Dragonfly/Redis)
- ✅ Session configuration (timeout, secure cookies, same-site)
- ✅ CORS configuration
- ✅ Video provider configuration (OpenVidu/Jitsi)
- ✅ Logging configuration
- ✅ Rate limiting configuration

**Note:** Sensitive values (secrets, passwords) are NOT in ConfigMap - they're in Secrets.

### 6. Production Overlay
**Status:** ✅ **VERIFIED**

The production overlay (`devops/kubernetes/overlays/production/kustomization.yaml`) includes:

- ✅ Production-specific patches
- ✅ Resource limit adjustments
- ✅ Pod anti-affinity for high availability
- ✅ Redis cluster configuration
- ✅ Production image tags
- ✅ ConfigMap overrides

### 7. Secrets Template
**Status:** ✅ **VERIFIED**

The secrets template (`devops/kubernetes/base/secrets.yaml.template`) includes:

- ✅ Database credentials (`postgres-user`, `postgres-password`, `database-url`, `database-migration-url`)
- ✅ Redis password (`redis-password`)
- ✅ Application secrets (`jwt-secret`, `session-secret`, `cookie-secret`)
- ✅ Google OAuth (`google-client-id`, `google-client-secret`)
- ✅ AWS credentials (`aws-access-key-id`, `aws-secret-access-key`, `aws-region`)
- ✅ Firebase credentials (`firebase-project-id`, `firebase-private-key`, `firebase-client-email`)
- ✅ OpenVidu secret (`openvidu-secret`) - **ADDED**
- ✅ Jitsi secrets (multiple)

## 📋 Pre-Deployment Checklist

Before deploying to production, ensure:

### Secrets Configuration

1. **Create secrets.yaml from template:**
   ```bash
   cp devops/kubernetes/base/secrets.yaml.template devops/kubernetes/base/secrets.yaml
   # Edit secrets.yaml with base64 encoded values
   ```

2. **Or use the secrets script:**
   ```bash
   export DB_URL="postgresql://user:pass@pgbouncer:6432/userdb?pgbouncer=true"
   export DB_MIGRATION_URL="postgresql://user:pass@postgres:5432/userdb"
   export POSTGRES_USER="postgres"
   export POSTGRES_PASSWORD="your-password"
   export REDIS_PASSWORD="your-redis-password"
   export JWT_SECRET="your-jwt-secret-min-32-chars"
   export SESSION_SECRET="your-session-secret-min-32-chars"  # Optional, auto-generated if not set
   export COOKIE_SECRET="your-cookie-secret-min-32-chars"    # Optional, auto-generated if not set
   export OPENVIDU_SECRET="your-openvidu-secret-min-32-chars"  # Optional
   
   ./devops/kubernetes/scripts/apply-healthcare-secrets.sh
   ```

3. **Required Secrets:**
   - [ ] `database-url` - PostgreSQL connection via PgBouncer
   - [ ] `database-migration-url` - Direct PostgreSQL for migrations
   - [ ] `postgres-user` - PostgreSQL username
   - [ ] `postgres-password` - PostgreSQL password
   - [ ] `redis-password` - Redis password
   - [ ] `jwt-secret` - JWT signing secret (minimum 32 characters)
   - [ ] `session-secret` - Fastify session secret (minimum 32 characters)
   - [ ] `cookie-secret` - Cookie signing secret (minimum 32 characters)

4. **Optional Secrets (if using):**
   - [ ] `openvidu-secret` - OpenVidu server secret
   - [ ] `google-client-id` - Google OAuth client ID
   - [ ] `google-client-secret` - Google OAuth client secret
   - [ ] `aws-access-key-id` - AWS access key
   - [ ] `aws-secret-access-key` - AWS secret key
   - [ ] `aws-region` - AWS region
   - [ ] `firebase-project-id` - Firebase project ID
   - [ ] `firebase-private-key` - Firebase private key
   - [ ] `firebase-client-email` - Firebase client email

### Infrastructure

- [ ] Kubernetes cluster is running (2-3 nodes minimum)
- [ ] Resource quota configured for your node count (2 or 3 nodes)
- [ ] Storage class configured for PVCs
- [ ] Ingress controller installed (e.g., nginx-ingress)
- [ ] Cert-manager installed (for TLS certificates)
- [ ] Metrics server installed (for HPA)
- [ ] Network policies configured (if using)

### Configuration

- [ ] Update production overlay image registry
- [ ] Configure production domains in ConfigMap
- [ ] Set production resource limits
- [ ] Configure HPA min/max replicas
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategy (WAL-G for PostgreSQL)

## 🚀 Deployment Commands

### 1. Apply Secrets

```bash
# Option 1: Using the script (recommended)
export DB_URL="postgresql://user:pass@pgbouncer:6432/userdb?pgbouncer=true"
export DB_MIGRATION_URL="postgresql://user:pass@postgres:5432/userdb"
export POSTGRES_USER="postgres"
export POSTGRES_PASSWORD="your-password"
export REDIS_PASSWORD="your-redis-password"
export JWT_SECRET="your-jwt-secret-min-32-chars"

./devops/kubernetes/scripts/apply-healthcare-secrets.sh
```

```bash
# Option 2: Manual creation
kubectl apply -f devops/kubernetes/base/secrets.yaml
```

### 2. Deploy Base Configuration

```bash
# Deploy all base resources
kubectl apply -k devops/kubernetes/base/

# Verify deployment
kubectl get pods -n healthcare-backend
kubectl get hpa -n healthcare-backend
```

### 3. Deploy Production Overlay

```bash
# Deploy production-specific configuration
kubectl apply -k devops/kubernetes/overlays/production/

# Verify rollout
kubectl rollout status deployment/healthcare-api -n healthcare-backend
kubectl rollout status deployment/healthcare-worker -n healthcare-backend
```

### 4. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n healthcare-backend

# Check services
kubectl get svc -n healthcare-backend

# Check HPA
kubectl get hpa -n healthcare-backend

# Check ingress
kubectl get ingress -n healthcare-backend

# View logs
kubectl logs -f deployment/healthcare-api -n healthcare-backend
```

## 🔍 Verification Checklist

After deployment, verify:

- [ ] All pods are in `Running` state
- [ ] All pods have `Ready` status (1/1, 2/2, etc.)
- [ ] HPA is active and showing metrics
- [ ] Services are accessible
- [ ] Ingress is configured correctly
- [ ] TLS certificates are issued (if using cert-manager)
- [ ] Health endpoints respond correctly
- [ ] Database migrations completed
- [ ] Cache connections are working
- [ ] Worker pods are processing jobs

## 📚 Documentation

- **Kubernetes README**: `devops/kubernetes/README.md` - Complete deployment guide
- **Base Configuration**: `devops/kubernetes/base/README.md` - Base configuration details
- **Docker Production**: `devops/docker/PRODUCTION_DEPLOYMENT.md` - Docker production guide
- **Main README**: `README.md` - Project overview

## ✨ Summary

All Kubernetes production components have been verified and configured:

1. ✅ Secrets template updated with `openvidu-secret`
2. ✅ Secrets application script enhanced with optional secrets
3. ✅ API deployment verified with all required secrets
4. ✅ Worker deployment verified with all required secrets
5. ✅ ConfigMap verified (non-sensitive configuration)
6. ✅ Production overlay verified
7. ✅ Documentation created

**Next Steps:**
1. Create and apply secrets using the script or manual method
2. Deploy base configuration
3. Deploy production overlay
4. Verify all pods are running
5. Monitor HPA and resource usage
6. Set up monitoring and alerting


