# Jitsi Meet Kubernetes Setup Guide

This guide explains how to set up and configure self-hosted Jitsi Meet in the Kubernetes cluster.

## 📋 Overview

Jitsi Meet is integrated into the Kubernetes deployment with the following components:

- **Prosody** (XMPP Server): Handles authentication and XMPP communication
- **Jitsi Web** (Web Interface): The user-facing web application
- **Jicofo** (Conference Focus): Manages conference sessions
- **JVB** (Jitsi Videobridge): Handles media streaming (scalable)

## 🚀 Quick Start

### 1. Create Required Secrets

Jitsi requires several secrets for secure operation. Add them to `devops/kubernetes/base/secrets.yaml`:

```bash
# Generate secure random passwords
JICOFO_SECRET=$(openssl rand -base64 32)
FOCUS_PASSWORD=$(openssl rand -base64 32)
JVB_PASSWORD=$(openssl rand -base64 32)
JIGASI_PASSWORD=$(openssl rand -base64 32)
JIBRI_RECORDER_PASSWORD=$(openssl rand -base64 32)
JIBRI_XMPP_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)

# Base64 encode them
echo -n "$JICOFO_SECRET" | base64
echo -n "$FOCUS_PASSWORD" | base64
echo -n "$JVB_PASSWORD" | base64
echo -n "$JIGASI_PASSWORD" | base64
echo -n "$JIBRI_RECORDER_PASSWORD" | base64
echo -n "$JIBRI_XMPP_PASSWORD" | base64
echo -n "$JWT_SECRET" | base64
```

Add these to your `secrets.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: healthcare-secrets
  namespace: healthcare-backend
type: Opaque
data:
  # ... existing secrets ...
  
  # Jitsi Meet Secrets
  jitsi-jicofo-secret: <BASE64_ENCODED_JICOFO_SECRET>
  jitsi-focus-password: <BASE64_ENCODED_FOCUS_PASSWORD>
  jitsi-jvb-password: <BASE64_ENCODED_JVB_PASSWORD>
  jitsi-jigasi-password: <BASE64_ENCODED_JIGASI_PASSWORD>
  jitsi-jibri-recorder-password: <BASE64_ENCODED_JIBRI_RECORDER_PASSWORD>
  jitsi-jibri-xmpp-password: <BASE64_ENCODED_JIBRI_XMPP_PASSWORD>
  jitsi-jwt-secret: <BASE64_ENCODED_JWT_SECRET>
```

### 2. Deploy Jitsi Services

```bash
# Deploy all Jitsi components
kubectl apply -f devops/kubernetes/base/jitsi-deployment.yaml

# Or deploy everything together
kubectl apply -k devops/kubernetes/base/
```

### 3. Verify Deployment

```bash
# Check Jitsi pods
kubectl get pods -n healthcare-backend -l app=jitsi

# Check services
kubectl get svc -n healthcare-backend -l app=jitsi

# Check ingress
kubectl get ingress -n healthcare-backend
```

## 🔧 Configuration

### Domain Configuration

The Jitsi deployment is configured for `meet.ishswami.in`. Update the following if using a different domain:

1. **Deployment files** (`jitsi-deployment.yaml`): Update all `XMPP_DOMAIN`, `PUBLIC_URL`, etc.
2. **ConfigMap** (`configmap.yaml`): Update `JITSI_DOMAIN`, `JITSI_BASE_URL`, `JITSI_WS_URL`
3. **Ingress** (`ingress.yaml`): Update host rules for your domain

### Resource Allocation

Default resource requests/limits for Jitsi components:

| Component | Replicas | CPU Request | RAM Request | CPU Limit | RAM Limit |
|-----------|----------|-------------|-------------|-----------|-----------|
| Prosody   | 1        | 100m        | 256Mi       | 500m      | 512Mi     |
| Web       | 2        | 100m        | 256Mi       | 500m      | 512Mi     |
| Jicofo    | 1        | 200m        | 512Mi       | 1000m     | 1Gi       |
| JVB       | 2        | 500m        | 1Gi         | 2000m     | 2Gi       |

**Total:** ~1.2 vCPU, ~2.5GB RAM (requests)

### Scaling JVB

JVB (Jitsi Videobridge) handles media streaming and can be scaled horizontally:

```bash
# Scale JVB to handle more concurrent conferences
kubectl scale deployment jitsi-jvb -n healthcare-backend --replicas=4
```

**Note:** Each JVB instance can handle multiple conferences. Scale based on:
- Number of concurrent conferences
- Participants per conference
- Video quality settings

## 🌐 Network Configuration

### Ingress Routing

Jitsi is accessible via:
- **Web Interface:** `https://meet.ishswami.in`
- **XMPP BOSH:** `https://meet.ishswami.in/http-bind`
- **WebSocket:** `wss://meet.ishswami.in/xmpp-websocket`

### UDP Ports (RTP)

JVB requires UDP port 10000 for RTP traffic. The service is configured as `NodePort`:

- **NodePort:** 30000 (UDP)
- **Container Port:** 10000 (UDP)

**Important:** Ensure your firewall allows UDP traffic on port 30000.

### Firewall Rules

For Contabo VPS or other cloud providers, open these ports:

```bash
# UDP for RTP (media streaming)
Port 30000 (UDP) - JVB RTP traffic

# TCP for HTTPS (already open via ingress)
Port 443 (TCP) - HTTPS via ingress
```

## 🔐 Security

### JWT Authentication

Jitsi is configured with JWT authentication. The backend API generates JWT tokens for authenticated users.

**JWT Configuration:**
- **App ID:** `healthcare-jitsi-app`
- **Secret:** Stored in Kubernetes secret `jitsi-jwt-secret`
- **Issuer:** `healthcare-jitsi-app`
- **Audience:** `healthcare-jitsi-app`

### Token Generation

The backend API service (`jitsi-video.service.ts`) generates JWT tokens for meetings:

```typescript
// Token includes:
{
  iss: 'healthcare-jitsi-app',
  aud: 'healthcare-jitsi-app',
  sub: 'meet.ishswami.in',
  room: '<meeting-room-name>',
  exp: <expiration-timestamp>
}
```

## 📊 Monitoring

### Health Checks

All Jitsi components have health checks configured:

```bash
# Check pod health
kubectl get pods -n healthcare-backend -l app=jitsi

# View logs
kubectl logs -f deployment/jitsi-web -n healthcare-backend
kubectl logs -f deployment/jitsi-jvb -n healthcare-backend
kubectl logs -f deployment/jitsi-jicofo -n healthcare-backend
kubectl logs -f deployment/jitsi-prosody -n healthcare-backend
```

### Resource Usage

```bash
# Monitor resource usage
kubectl top pods -n healthcare-backend -l app=jitsi

# Check JVB stats (via HTTP API)
kubectl port-forward svc/jitsi-jvb 8080:8080 -n healthcare-backend
curl http://localhost:8080/stats
```

## 🔄 Updates & Maintenance

### Updating Jitsi Images

```bash
# Pull latest images
kubectl set image deployment/jitsi-prosody prosody=jitsi/prosody:latest -n healthcare-backend
kubectl set image deployment/jitsi-web web=jitsi/web:latest -n healthcare-backend
kubectl set image deployment/jitsi-jicofo jicofo=jitsi/jicofo:latest -n healthcare-backend
kubectl set image deployment/jitsi-jvb jvb=jitsi/jvb:latest -n healthcare-backend

# Rollout restart if needed
kubectl rollout restart deployment/jitsi-prosody -n healthcare-backend
kubectl rollout restart deployment/jitsi-web -n healthcare-backend
kubectl rollout restart deployment/jitsi-jicofo -n healthcare-backend
kubectl rollout restart deployment/jitsi-jvb -n healthcare-backend
```

### Backup Configuration

Jitsi configuration is stored in emptyDir volumes (ephemeral). For persistence:

1. Create PersistentVolumeClaims for each component
2. Update `jitsi-deployment.yaml` to use PVCs instead of emptyDir

## 🐛 Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n healthcare-backend

# Check logs
kubectl logs <pod-name> -n healthcare-backend

# Common issues:
# - Missing secrets (check secret keys match)
# - Resource limits too low
# - Network policies blocking communication
```

### Connection Issues

```bash
# Check ingress
kubectl describe ingress healthcare-ingress -n healthcare-backend

# Check services
kubectl get svc -n healthcare-backend -l app=jitsi

# Test connectivity
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- curl http://jitsi-web:80
```

### Media Not Working

1. **Check UDP port:** Ensure port 30000 (UDP) is open
2. **Check JVB pods:** Ensure JVB pods are running and healthy
3. **Check STUN servers:** Verify STUN servers are accessible
4. **Check firewall:** Ensure UDP traffic is not blocked

### High Resource Usage

```bash
# Check resource usage
kubectl top pods -n healthcare-backend -l app=jitsi

# Scale JVB if needed
kubectl scale deployment jitsi-jvb -n healthcare-backend --replicas=4

# Adjust resource limits in jitsi-deployment.yaml if needed
```

## 📚 Additional Resources

- **Jitsi Documentation:** https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker
- **Jitsi Kubernetes Examples:** https://github.com/jitsi/docker-jitsi-meet
- **Backend Integration:** See `src/services/appointments/plugins/video/jitsi-video.service.ts`

## ✅ Checklist

- [ ] Secrets created and added to `secrets.yaml`
- [ ] Domain configured (DNS points to cluster)
- [ ] Firewall rules configured (UDP port 30000)
- [ ] Ingress TLS certificate configured (Let's Encrypt)
- [ ] Jitsi services deployed
- [ ] Health checks passing
- [ ] Backend API configured with Jitsi domain
- [ ] Test meeting creation from backend API
- [ ] Test video call functionality

---

**Note:** This setup is for production use. Ensure all secrets are properly secured and not committed to version control.
