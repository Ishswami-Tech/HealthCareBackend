# OpenVidu Pro Setup Guide

## Overview

OpenVidu Pro provides additional features over Community Edition (CE), including:
- **Dashboard UI** - Web-based monitoring and management interface
- **Inspector** - Advanced monitoring and session management
- **Cluster Management** - Horizontal scaling with Media Nodes
- **Advanced Analytics** - Detailed metrics and reporting
- **Enterprise Support** - Professional support and SLA

## Requirements for OpenVidu Pro

### 1. License & Account

**Required:**
- ✅ **OpenVidu Account** - Register at https://openvidu.io
- ✅ **License Key** - Obtain from your OpenVidu account
- ✅ **15-day Free Trial** - Available for testing

**Pricing:**
- Contact OpenVidu for current pricing
- Typically based on concurrent sessions or monthly active users
- Enterprise support available

### 2. Infrastructure Requirements

#### Minimum Setup (Single Node - Development)
- **1 Server** with:
  - 2+ CPU cores
  - 8GB+ RAM
  - Modern Linux distribution (Ubuntu 20.04+, CentOS 8+, etc.)
  - Docker & Docker Compose installed

#### Production Setup (Cluster)
- **Master Node** (1 server):
  - 2+ CPU cores
  - 8GB+ RAM
  - Domain name pointing to public IP
  - SSL certificate (Let's Encrypt or custom)
  
- **Media Nodes** (1+ servers):
  - 2+ CPU cores per node
  - 8GB+ RAM per node
  - High network bandwidth
  - Can scale horizontally

### 3. Network & Ports

#### Master Node Ports:
- **22 TCP** - SSH access
- **80 TCP** - Let's Encrypt SSL certificate generation
- **443 TCP** - OpenVidu Inspector/Dashboard access
- **3478 TCP/UDP** - STUN/TURN server
- **5044 TCP** - Metrics from Media Nodes
- **9200 TCP** - Elasticsearch (metrics/logs)
- **40000-65535 TCP/UDP** - TURN server media connections

#### Media Node Ports:
- **22 TCP** - SSH access
- **443 TCP/UDP** - STUN/TURN (if enabled)
- **40000-65535 TCP/UDP** - Kurento Media Server
- **8888 TCP** - KMS handler (restricted to Master)
- **3000 TCP** - REST API (restricted to Master)
- **4000 TCP** - Speech-to-Text (optional, restricted to Master)

### 4. Docker Image Changes

**Current (CE):**
```yaml
image: openvidu/openvidu-server-kms:latest
```

**Pro (Required):**
```yaml
image: openvidu/openvidu-server-pro:latest
# OR for cluster setup:
image: openvidu/openvidu-server-pro:2.29.0  # Specific version
```

### 5. Configuration Changes

#### Docker Compose Changes

**Current CE Configuration:**
```yaml
environment:
  - OPENVIDU_EDITION=ce
  - OPENVIDU_SECRET=${OPENVIDU_SECRET:-MY_SECRET}
```

**Pro Configuration:**
```yaml
environment:
  - OPENVIDU_EDITION=pro
  - OPENVIDU_SECRET=${OPENVIDU_SECRET:-MY_SECRET}
  - OPENVIDU_LICENSE=${OPENVIDU_LICENSE:-your-license-key-here}
  - OPENVIDU_DOMAIN=${OPENVIDU_DOMAIN:-video.yourdomain.com}
  - OPENVIDU_PUBLICURL=https://${OPENVIDU_DOMAIN}
  # Additional Pro-specific settings
  - OPENVIDU_PRO_CLUSTER_MODE=false  # true for cluster setup
  - OPENVIDU_PRO_ELASTICSEARCH=true
  - OPENVIDU_PRO_KIBANA=true
```

### 6. Environment Variables for Pro

Add to your `.env` file:
```bash
# OpenVidu Pro License
OPENVIDU_LICENSE=your-license-key-here

# OpenVidu Pro Domain (required for dashboard)
OPENVIDU_DOMAIN=video.yourdomain.com
OPENVIDU_URL=https://video.yourdomain.com

# Pro Edition
OPENVIDU_EDITION=pro

# Optional: Cluster mode
OPENVIDU_PRO_CLUSTER_MODE=false
OPENVIDU_PRO_ELASTERSEARCH=true
OPENVIDU_PRO_KIBANA=true
```

### 7. Features You Get with Pro

#### Dashboard UI
- **URL**: `https://your-domain/dashboard/`
- Real-time monitoring
- Session analytics
- Room management
- Participant tracking

#### Inspector
- **URL**: `https://your-domain/inspector/`
- Advanced session management
- Cluster management
- Geographic client location
- Detailed session history

#### Additional Features
- ✅ Horizontal scaling (Media Nodes)
- ✅ Advanced analytics
- ✅ Grafana integration
- ✅ Elasticsearch/Kibana for logs
- ✅ Enterprise support
- ✅ SLA guarantees

### 8. Migration Steps from CE to Pro

1. **Get License Key**
   ```bash
   # Register at https://openvidu.io
   # Get your license key from account dashboard
   ```

2. **Update Docker Compose**
   ```yaml
   # Change image
   image: openvidu/openvidu-server-pro:latest
   
   # Update environment
   - OPENVIDU_EDITION=pro
   - OPENVIDU_LICENSE=${OPENVIDU_LICENSE}
   ```

3. **Set Domain & SSL**
   ```bash
   # Set domain in .env
   OPENVIDU_DOMAIN=video.yourdomain.com
   OPENVIDU_URL=https://video.yourdomain.com
   
   # SSL will be auto-generated with Let's Encrypt
   # OR use your own certificates
   ```

4. **Restart Services**
   ```bash
   docker-compose -f devops/docker/docker-compose.dev.yml down
   docker-compose -f devops/docker/docker-compose.dev.yml up -d
   ```

5. **Access Dashboard**
   - Navigate to: `https://video.yourdomain.com/dashboard/`
   - Login with admin credentials

### 9. Cost Considerations

**OpenVidu Pro:**
- License fee (contact OpenVidu for pricing)
- Infrastructure costs (servers, bandwidth)
- Support costs (if enterprise support needed)

**Current CE Setup:**
- ✅ FREE (open-source)
- ✅ Only infrastructure costs
- ✅ No license fees
- ⚠️ No dashboard UI (API-only)

### 10. Recommendation

**For Development/Testing:**
- ✅ **Stick with CE** - Free, API works perfectly
- ✅ Use API endpoints for management
- ✅ Build custom dashboard if needed

**For Production (if needed):**
- Consider Pro if you need:
  - Built-in dashboard UI
  - Advanced analytics
  - Enterprise support
  - Cluster management
  - SLA guarantees

**Alternative:**
- Build custom dashboard using OpenVidu REST API
- Use your existing monitoring tools (Grafana, etc.)
- Save on Pro license costs

## Current Setup Status

✅ **You're using OpenVidu CE** - Fully functional for video conferencing
✅ **API is working** - All video features available
✅ **No errors** - System is healthy
⚠️ **No Dashboard UI** - Only available in Pro edition

## Access Points

**Current (CE - API Only):**
- API: `https://localhost:4443/api`
- Authentication: Basic Auth (OPENVIDUAPP / MY_SECRET)

**With Pro (Dashboard Available):**
- Dashboard: `https://video.yourdomain.com/dashboard/`
- Inspector: `https://video.yourdomain.com/inspector/`
- API: `https://video.yourdomain.com/api`

## Next Steps

If you want to upgrade to Pro:

1. **Register for OpenVidu account** → https://openvidu.io
2. **Get license key** from account dashboard
3. **Set up domain** (video.yourdomain.com)
4. **Update docker-compose.dev.yml** with Pro image and license
5. **Configure SSL** (Let's Encrypt or custom)
6. **Restart services**

**OR** continue with CE and use the REST API for all operations (recommended for cost savings).

