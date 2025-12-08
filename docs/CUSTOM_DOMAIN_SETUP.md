# Custom Domain Setup Guide for Video Conferencing

## Overview

This guide explains how to host video conferencing solutions on your own domain (e.g., `video.yourdomain.com`, `meet.yourdomain.com`).

---

## 🏆 Best Solutions for Custom Domain Hosting

### ✅ **Full Custom Domain Support (Self-Hosted)**

1. **OpenVidu** - ✅ Best for modern + custom domain
2. **BigBlueButton** - ✅ Best for healthcare + custom domain
3. **Jitsi** - ✅ Already configured on your domain
4. **Janus Gateway** - ✅ Full control
5. **Mediasoup** - ✅ Full control

### ⚠️ **Limited Custom Domain Support (Managed)**

1. **Agora** - ⚠️ Uses agora.io domain (may support subdomain)
2. **Daily.co** - ⚠️ Uses daily.co domain (white-label may be available)
3. **100ms** - ⚠️ Uses 100ms.live domain

---

## 1. OpenVidu - Custom Domain Setup

### Prerequisites

- Kubernetes cluster (you already have this ✅)
- Domain name (e.g., `yourdomain.com`)
- SSL certificate (Let's Encrypt or your own)

### Step 1: Deploy OpenVidu on Kubernetes

```yaml
# openvidu-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openvidu-server
  namespace: healthcare-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: openvidu-server
  template:
    metadata:
      labels:
        app: openvidu-server
    spec:
      containers:
      - name: openvidu-server
        image: openvidu/openvidu-server-kms:latest
        ports:
        - containerPort: 4443
        env:
        - name: DOMAIN_OR_PUBLIC_IP
          value: "video.yourdomain.com"  # Your custom domain
        - name: OPENVIDU_SECRET
          valueFrom:
            secretKeyRef:
              name: openvidu-secrets
              key: secret
        - name: CERTIFICATE_TYPE
          value: "letsencrypt"  # or "selfsigned" or "owncert"
        - name: LETSENCRYPT_EMAIL
          value: "admin@yourdomain.com"
        resources:
          requests:
            cpu: "1"
            memory: "2Gi"
          limits:
            cpu: "2"
            memory: "4Gi"
---
apiVersion: v1
kind: Service
metadata:
  name: openvidu-server
  namespace: healthcare-backend
spec:
  selector:
    app: openvidu-server
  ports:
  - port: 4443
    targetPort: 4443
  type: ClusterIP
```

### Step 2: Configure Ingress for Custom Domain

```yaml
# openvidu-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openvidu-ingress
  namespace: healthcare-backend
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
spec:
  ingressClassName: nginx
  rules:
  - host: video.yourdomain.com  # Your custom domain
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: openvidu-server
            port:
              number: 4443
  tls:
  - hosts:
    - video.yourdomain.com
    secretName: openvidu-tls
```

### Step 3: DNS Configuration

Add DNS A record:
```
video.yourdomain.com  A  <your-k8s-ingress-ip>
```

Or CNAME if using cloud load balancer:
```
video.yourdomain.com  CNAME  <your-load-balancer>
```

### Step 4: Update OpenVidu Configuration

```bash
# Set domain in OpenVidu
kubectl set env deployment/openvidu-server \
  DOMAIN_OR_PUBLIC_IP=video.yourdomain.com \
  -n healthcare-backend
```

### Step 5: Access Your Custom Domain

- **URL:** `https://video.yourdomain.com`
- **API:** `https://video.yourdomain.com/api`
- **WebSocket:** `wss://video.yourdomain.com`

---

## 2. BigBlueButton - Custom Domain Setup

### Step 1: Deploy BigBlueButton on Kubernetes

```yaml
# bigbluebutton-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bigbluebutton-web
  namespace: healthcare-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: bigbluebutton-web
  template:
    metadata:
      labels:
        app: bigbluebutton-web
    spec:
      containers:
      - name: bbb-web
        image: bigbluebutton/bigbluebutton:latest
        ports:
        - containerPort: 80
        env:
        - name: BBB_URL
          value: "https://meet.yourdomain.com"  # Your custom domain
        resources:
          requests:
            cpu: "1"
            memory: "2Gi"
          limits:
            cpu: "2"
            memory: "4Gi"
```

### Step 2: Configure Ingress

```yaml
# bigbluebutton-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: bigbluebutton-ingress
  namespace: healthcare-backend
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  rules:
  - host: meet.yourdomain.com  # Your custom domain
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: bigbluebutton-web
            port:
              number: 80
  tls:
  - hosts:
    - meet.yourdomain.com
    secretName: bbb-tls
```

### Step 3: DNS Configuration

```
meet.yourdomain.com  A  <your-k8s-ingress-ip>
```

### Step 4: Access Your Custom Domain

- **URL:** `https://meet.yourdomain.com`
- **API:** `https://meet.yourdomain.com/bigbluebutton/api`

---

## 3. Jitsi - Custom Domain Setup (Already Configured)

You already have Jitsi configured on your domain! Check your current setup:

```bash
# Check current Jitsi configuration
kubectl get configmap jitsi-config -n healthcare-backend -o yaml
```

Current domain: `meet.ishswami.in` (from your configmap)

### Update Jitsi Domain

If you want to change the domain:

```bash
# Update Jitsi domain
kubectl set env deployment/jitsi-web \
  JITSI_DOMAIN=video.yourdomain.com \
  -n healthcare-backend
```

---

## 4. SSL Certificate Setup

### Option 1: Let's Encrypt (Recommended)

```yaml
# cert-manager ClusterIssuer
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
```

### Option 2: Your Own SSL Certificate

```bash
# Create TLS secret with your certificate
kubectl create secret tls openvidu-tls \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem \
  -n healthcare-backend
```

---

## 5. Backend Integration (NestJS)

### OpenVidu Service with Custom Domain

```typescript
// openvidu-video.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config';
import axios from 'axios';

@Injectable()
export class OpenViduVideoService {
  private readonly apiUrl: string;
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    // Use your custom domain
    this.apiUrl = this.configService.getEnv('OPENVIDU_URL') || 'https://video.yourdomain.com';
    this.secret = this.configService.getEnv('OPENVIDU_SECRET');
  }

  async createSession(): Promise<{
    id: string;
    createdAt: number;
  }> {
    const response = await axios.post(
      `${this.apiUrl}/api/sessions`,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`OPENVIDUAPP:${this.secret}`).toString('base64')}`,
        },
      }
    );

    return response.data;
  }

  async generateToken(sessionId: string, role: 'PUBLISHER' | 'SUBSCRIBER'): Promise<string> {
    const response = await axios.post(
      `${this.apiUrl}/api/tokens`,
      {
        session: sessionId,
        role,
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`OPENVIDUAPP:${this.secret}`).toString('base64')}`,
        },
      }
    );

    return response.data.token;
  }
}
```

### Environment Variables

```env
# .env
OPENVIDU_URL=https://video.yourdomain.com
OPENVIDU_SECRET=your-secret-key
OPENVIDU_DOMAIN=video.yourdomain.com
```

---

## 6. Frontend Integration

### OpenVidu Client with Custom Domain

```typescript
// frontend: video-consultation.component.ts
import { OpenVidu } from 'openvidu-browser';

export class VideoConsultationComponent {
  private openvidu: OpenVidu;
  private session: any;

  constructor() {
    // Use your custom domain
    this.openvidu = new OpenVidu();
    this.openvidu.setAdvancedConfiguration({
      // Your custom domain
      serverUrl: 'https://video.yourdomain.com',
    });
  }

  async joinSession(sessionId: string, token: string) {
    this.session = this.openvidu.initSession();
    this.session.connect(token);
    
    const publisher = this.openvidu.initPublisher('publisher', {
      videoSource: undefined,
      audioSource: undefined,
    });
    
    this.session.publish(publisher);
  }
}
```

---

## 7. Domain Configuration Examples

### Multiple Subdomains

```
video.yourdomain.com    → OpenVidu
meet.yourdomain.com     → BigBlueButton
consult.yourdomain.com  → Jitsi (alternative)
```

### Single Domain with Paths

```
yourdomain.com/video    → OpenVidu
yourdomain.com/meet     → BigBlueButton
yourdomain.com/consult  → Jitsi
```

---

## 8. Verification Checklist

- [ ] DNS A/CNAME record configured
- [ ] SSL certificate installed (Let's Encrypt or custom)
- [ ] Ingress configured with correct host
- [ ] Service pointing to correct deployment
- [ ] Environment variables set (domain, URL)
- [ ] Backend API configured with custom domain
- [ ] Frontend configured with custom domain
- [ ] HTTPS working (no mixed content)
- [ ] WebSocket connections working (WSS)

---

## 9. Troubleshooting

### Domain Not Resolving

```bash
# Check DNS
dig video.yourdomain.com
nslookup video.yourdomain.com

# Check ingress
kubectl get ingress -n healthcare-backend
kubectl describe ingress openvidu-ingress -n healthcare-backend
```

### SSL Certificate Issues

```bash
# Check certificate
kubectl get certificate -n healthcare-backend
kubectl describe certificate openvidu-tls -n healthcare-backend

# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager
```

### Connection Issues

```bash
# Check service
kubectl get svc openvidu-server -n healthcare-backend
kubectl describe svc openvidu-server -n healthcare-backend

# Check pods
kubectl get pods -l app=openvidu-server -n healthcare-backend
kubectl logs -l app=openvidu-server -n healthcare-backend
```

---

## 10. Best Practices

1. **Use Subdomains** - Easier to manage (video.yourdomain.com)
2. **SSL Everywhere** - Always use HTTPS/WSS
3. **DNS TTL** - Set appropriate TTL for DNS records
4. **Monitoring** - Monitor domain health and SSL expiration
5. **Backup** - Keep SSL certificates backed up
6. **Documentation** - Document your domain configuration

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Author:** Healthcare Backend Team


