# OpenVidu Custom Domain Deployment Guide

## Overview

This guide shows you how to deploy OpenVidu on your custom domain (e.g., `video.ishswami.in`) **for production only**.

> **⚠️ Important:** Custom domain configuration is for **PRODUCTION (Kubernetes)** only.  
> **Development (Docker Compose)** should use `localhost` for local testing.

## Prerequisites

✅ **You Already Have:**
- Domain: `ishswami.in` (configured)
- Kubernetes ingress for `video.ishswami.in` (already set up)
- Docker Compose for local development (uses localhost)
- SSL certificates (Let's Encrypt via cert-manager)

## Environment Separation

### Development (Docker Compose)
- **Purpose:** Local development and testing
- **Domain:** `localhost` or `127.0.0.1`
- **URL:** `https://localhost:4443`
- **Configuration:** `devops/docker/docker-compose.dev.yml`
- **No custom domain needed** ✅

### Production (Kubernetes)
- **Purpose:** Production deployment
- **Domain:** `video.ishswami.in`
- **URL:** `https://video.ishswami.in`
- **Configuration:** `devops/kubernetes/base/`
- **Custom domain required** ✅

---

## Development Setup (Docker Compose)

### Default Configuration

Docker Compose is already configured for local development:

```yaml
# devops/docker/docker-compose.dev.yml
openvidu-server:
  environment:
    - OPENVIDU_PUBLICURL=${OPENVIDU_URL:-https://localhost:4443}
    - OPENVIDU_DOMAIN=${OPENVIDU_DOMAIN:-localhost}
```

**No changes needed for development!** Just run:
```bash
docker-compose -f devops/docker/docker-compose.dev.yml up -d
```

Access OpenVidu at: `https://localhost:4443`

> **Note:** If you need to test with a custom domain locally, you can override via `.env`:
> ```bash
> OPENVIDU_URL=https://video.ishswami.in
> OPENVIDU_DOMAIN=video.ishswami.in
> ```
> But this is **not recommended** for development.

#### Step 3: Configure Reverse Proxy (Nginx)

If using Nginx as reverse proxy, add configuration:

```nginx
# OpenVidu Server Configuration
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name video.ishswami.in;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/video.ishswami.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/video.ishswami.in/privkey.pem;
    
    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # WebSocket Support
    location / {
        proxy_pass https://localhost:4443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for long-lived connections
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

#### Step 4: DNS Configuration

Add DNS A record:
```
video.ishswami.in  A  <your-server-ip>
```

Or if using Cloudflare:
```
video.ishswami.in  A  <your-server-ip>  (Proxied)
```

#### Step 5: SSL Certificate

**Option A: Let's Encrypt (Recommended)**
```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d video.ishswami.in

# Auto-renewal (already configured in certbot)
```

**Option B: Cloudflare SSL**
- Use Cloudflare's SSL/TLS
- Set mode to "Full (strict)"
- Cloudflare handles SSL termination

#### Step 6: Update Backend Configuration

Update your backend `.env`:
```bash
OPENVIDU_URL=https://video.ishswami.in
OPENVIDU_DOMAIN=video.ishswami.in
```

#### Step 7: Restart Services

```bash
# Restart OpenVidu
docker-compose -f devops/docker/docker-compose.dev.yml restart openvidu-server

# Restart Nginx (if using)
sudo systemctl restart nginx

# Verify
curl -k https://video.ishswami.in/api/config -u OPENVIDUAPP:YOUR_SECRET
```

---

## Production Setup (Kubernetes)

> **This is where you configure the custom domain!**

### Option 1: Kubernetes (Production - Already Configured!)

You already have Kubernetes ingress configured! Just need to:

#### Step 1: Verify Ingress Configuration

Your ingress at `devops/kubernetes/base/ingress.yaml` already has:
```yaml
- host: video.ishswami.in
  http:
    paths:
    - path: /
      pathType: Prefix
      backend:
        service:
          name: openvidu-server
          port:
            number: 4443
```

#### Step 2: Update OpenVidu ConfigMap

Update `devops/kubernetes/base/openvidu-configmap.yaml`:
```yaml
OPENVIDU_DOMAIN: "video.ishswami.in"
OPENVIDU_URL: "https://video.ishswami.in"
```

#### Step 3: Update Deployment Environment

Ensure OpenVidu deployment has:
```yaml
env:
  - name: OPENVIDU_PUBLICURL
    value: "https://video.ishswami.in"
  - name: OPENVIDU_DOMAIN
    value: "video.ishswami.in"
```

#### Step 4: Apply Configuration

```bash
# Apply configmap
kubectl apply -f devops/kubernetes/base/openvidu-configmap.yaml

# Apply ingress
kubectl apply -f devops/kubernetes/base/ingress.yaml

# Restart OpenVidu deployment
kubectl rollout restart deployment/openvidu-server -n healthcare-backend
```

#### Step 5: Verify DNS

```bash
# Check DNS resolution
nslookup video.ishswami.in
dig video.ishswami.in

# Should resolve to your Kubernetes ingress IP
```

#### Step 6: Verify SSL Certificate

```bash
# Check certificate
kubectl get certificate -n healthcare-backend
kubectl describe certificate healthcare-tls -n healthcare-backend

# Check cert-manager
kubectl get pods -n cert-manager
```

---

## Complete Checklist

### DNS Configuration
- [ ] DNS A record: `video.ishswami.in` → Your server IP
- [ ] DNS propagation verified (can take up to 48 hours)
- [ ] Test: `nslookup video.ishswami.in`

### SSL Certificate
- [ ] SSL certificate obtained (Let's Encrypt or custom)
- [ ] Certificate installed and configured
- [ ] Auto-renewal configured
- [ ] Test: `curl -I https://video.ishswami.in`

### OpenVidu Configuration
- [ ] `OPENVIDU_URL` set to `https://video.ishswami.in`
- [ ] `OPENVIDU_DOMAIN` set to `video.ishswami.in`
- [ ] `OPENVIDU_PUBLICURL` matches domain
- [ ] Container restarted with new config

### Backend Configuration
- [ ] Backend `.env` updated with new domain
- [ ] API endpoints use new domain
- [ ] CORS configured for new domain
- [ ] Webhook endpoints updated (if using)

### Network & Firewall
- [ ] Port 443 open (HTTPS)
- [ ] Port 80 open (HTTP redirect)
- [ ] Port 4443 accessible (if direct access needed)
- [ ] Ports 3478, 50000-51000 open (TURN/STUN)

### Testing
- [ ] API accessible: `https://video.ishswami.in/api/config`
- [ ] SSL certificate valid
- [ ] WebSocket connections work (WSS)
- [ ] Video sessions can be created
- [ ] Backend can connect to OpenVidu

---

## Quick Start

### Development (Docker Compose)

**No configuration needed!** Just run:
```bash
docker-compose -f devops/docker/docker-compose.dev.yml up -d
```

Access at: `https://localhost:4443`

---

### Production (Kubernetes)

### 1. Update ConfigMap

```bash
kubectl edit configmap openvidu-config -n healthcare-backend
# Set OPENVIDU_URL and OPENVIDU_DOMAIN
```

### 2. Verify Ingress

```bash
kubectl get ingress -n healthcare-backend
# Should show video.ishswami.in
```

### 3. Restart Deployment

```bash
kubectl rollout restart deployment/openvidu-server -n healthcare-backend
```

### 4. Verify

```bash
curl https://video.ishswami.in/api/config -u OPENVIDUAPP:YOUR_SECRET
```

---

## Backend Integration Updates

### Update Video Service Configuration

```typescript
// src/config/video.config.ts or .env
OPENVIDU_URL=https://video.ishswami.in
OPENVIDU_DOMAIN=video.ishswami.in
```

### Update CORS Configuration

```typescript
// src/main.ts or security config
CORS_ORIGIN=https://ishswami.in,https://www.ishswami.in,https://video.ishswami.in
```

### Update Webhook Endpoints (if using)

```bash
OPENVIDU_WEBHOOK_ENDPOINT=https://api.ishswami.in/api/v1/webhooks/openvidu
```

---

## Troubleshooting

### Domain Not Resolving

```bash
# Check DNS
nslookup video.ishswami.in
dig video.ishswami.in

# Check DNS propagation
# https://www.whatsmydns.net/#A/video.ishswami.in
```

### SSL Certificate Issues

```bash
# Check certificate
openssl s_client -connect video.ishswami.in:443 -servername video.ishswami.in

# Check cert expiration
echo | openssl s_client -connect video.ishswami.in:443 2>/dev/null | openssl x509 -noout -dates
```

### Connection Issues

```bash
# Test API
curl -k https://video.ishswami.in/api/config -u OPENVIDUAPP:YOUR_SECRET

# Check OpenVidu logs
docker logs healthcare-openvidu-server
# OR
kubectl logs -l app=openvidu-server -n healthcare-backend
```

### Port Issues

```bash
# Check if ports are open
netstat -tulpn | grep 4443
# OR
ss -tulpn | grep 4443

# Check firewall
sudo ufw status
```

---

## Production Recommendations

1. **Use Kubernetes** - Better for production scaling
2. **Use Let's Encrypt** - Free, auto-renewing SSL
3. **Enable Cloudflare** - DDoS protection, CDN, SSL
4. **Monitor SSL Expiration** - Set up alerts
5. **Backup Certificates** - Keep SSL certs backed up
6. **Use Health Checks** - Monitor OpenVidu health
7. **Set Up Logging** - Centralized logging for troubleshooting

---

## Current Status

✅ **Development (Docker Compose):**
- Configured for `localhost` ✅
- Ready for local development ✅
- No custom domain needed ✅

✅ **Production (Kubernetes):**
- Kubernetes ingress configured for `video.ishswami.in` ✅
- ConfigMap configured with `video.ishswami.in` ✅
- SSL certificate setup (cert-manager) ✅
- Domain `ishswami.in` configured ✅

**What You Need for Production:**
1. ✅ DNS A record: `video.ishswami.in` → Your Kubernetes ingress IP
2. ✅ Verify SSL certificate is valid (auto-generated by cert-manager)
3. ✅ Deploy to Kubernetes
4. ✅ Test the domain

---

## Summary

| Environment | Domain | Configuration | Status |
|------------|--------|---------------|--------|
| **Development** | `localhost` | Docker Compose | ✅ Ready |
| **Production** | `video.ishswami.in` | Kubernetes | ✅ Configured |

**Next Steps for Production:**
1. Ensure DNS A record is configured
2. Deploy to Kubernetes
3. Verify SSL certificate
4. Test: `curl https://video.ishswami.in/api/config`

