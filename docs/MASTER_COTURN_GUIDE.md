# 🌐 Master Coturn (STUN/TURN) & Video Guide

## Complete Reference for Coturn, OpenVidu, and Nginx Configuration

This document serves as the definitive guide for managing the Coturn (STUN/TURN)
and OpenVidu services for the Healthcare Backend. Both services are unified
under the dedicated subdomain: **`backend-service-v1-video.ishswami.in`**.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [DNS Configuration](#dns-configuration)
3. [Domain Security: Same Domain vs Subdomain](#domain-security-same-domain-vs-subdomain)
4. [Firewall & Security Setup](#firewall--security-setup)
5. [Docker Configuration](#docker-configuration)
6. [Nginx Configuration](#nginx-configuration)
7. [Verification & Troubleshooting](#verification--troubleshooting)
8. [Architecture & OpenVidu Analysis](#architecture--openvidu-analysis)
9. [Security Implementation Checklist](#security-implementation-checklist)

---

## Overview

### 🎯 Unified Subdomain Integration

By using a single subdomain for both OpenVidu (Media Server) and Coturn (Relay
Server), we simplify SSL management and DNS configuration while maintaining high
security.

- **OpenVidu (API/WS)**: Port `443` (HTTPS/WSS)
- **Coturn (STUN/TURN)**: Port `3478` (UDP/TCP)
- **Coturn (TURNS)**: Port `5349` (TLS/UDP/TCP)

### ⚠️ Security Concern

**Coturn is exposed directly on port 3478 (UDP/TCP) to the internet**, which is
necessary for WebRTC to work but creates a security risk.

**Why it's exposed:**

- WebRTC clients need direct access to TURN/STUN servers
- TURN/STUN uses UDP/TCP protocol (not HTTP), so Nginx can't proxy it
- Clients connect from various networks (NAT, firewalls, etc.)

**Security risks:**

- Port scanning and reconnaissance
- DDoS attacks (UDP amplification)
- Brute force attacks on credentials
- Resource exhaustion attacks
- Unauthorized relay usage

---

## DNS Configuration

### Option 1: A Record (Recommended)

**Point directly to your server IP:**

```
Type: A
Name: backend-service-v1-video (or turn)
Value: YOUR_SERVER_IP
TTL: 3600 (or default)
```

**Example:**

```
backend-service-v1-video.ishswami.in    A    31.220.79.219
turn.ishswami.in                        A    31.220.79.219
```

### Option 2: CNAME Record

**Point to your main API domain (if it resolves to same IP):**

```
Type: CNAME
Name: backend-service-v1-video (or turn)
Value: backend-service-v1.ishswami.in
TTL: 3600 (or default)
```

> [!IMPORTANT] **Do not proxy** the TURN/STUN traffic through Cloudflare (unless
> using Spectrum), as it uses UDP and non-HTTP protocols that standard
> Cloudflare proxying does not support. Set proxy status to **DNS Only** (Gray
> Cloud).

### Cloudflare DNS Setup

1. **Login to Cloudflare Dashboard**
2. **Select your domain** (`ishswami.in`)
3. **Go to DNS → Records**
4. **Add Record:**
   - Type: `A` or `CNAME`
   - Name: `backend-service-v1-video` (or `turn`)
   - IPv4 address: `YOUR_SERVER_IP` (for A record)
   - Target: `backend-service-v1.ishswami.in` (for CNAME)
   - Proxy status: **DNS only** (⚠️ Important: Don't proxy TURN traffic!)
   - TTL: `Auto` or `3600`
5. **Save**

### DNS Verification

```bash
# Using dig
dig backend-service-v1-video.ishswami.in +short
dig turn.ishswami.in +short

# Using nslookup
nslookup backend-service-v1-video.ishswami.in

# Using host
host backend-service-v1-video.ishswami.in

# Expected output: Should resolve to your server IP
```

### DNS Propagation

**Typical propagation time:**

- **A Record**: 5 minutes to 24 hours
- **CNAME Record**: 5 minutes to 24 hours

**Check propagation:**

```bash
# Check from multiple DNS servers
dig @8.8.8.8 backend-service-v1-video.ishswami.in
dig @1.1.1.1 backend-service-v1-video.ishswami.in
dig @208.67.222.222 backend-service-v1-video.ishswami.in
```

---

## Domain Security: Same Domain vs Subdomain

### 🏆 Recommendation: Use Subdomain for Production

**For Production: Use a Subdomain (`turn.ishswami.in` or
`backend-service-v1-video.ishswami.in`)** ✅  
**For Development: Same Domain is Acceptable** ⚠️

### Security Comparison

| Aspect                 | Same Domain                       | Subdomain                | Winner          |
| ---------------------- | --------------------------------- | ------------------------ | --------------- |
| **Security Isolation** | ⚠️ Shared domain exposure         | ✅ Separate domain       | **Subdomain**   |
| **Attack Surface**     | ⚠️ Larger (API + TURN visible)    | ✅ Smaller (TURN hidden) | **Subdomain**   |
| **Discovery Risk**     | ⚠️ Easier to discover TURN server | ✅ Harder to discover    | **Subdomain**   |
| **Compromise Impact**  | ⚠️ Both services at risk          | ✅ Isolated risk         | **Subdomain**   |
| **DDoS Protection**    | ⚠️ Shared protection              | ✅ Separate policies     | **Subdomain**   |
| **Configuration**      | ✅ Simpler                        | ⚠️ More complex          | **Same Domain** |
| **SSL Management**     | ✅ Single cert                    | ⚠️ Separate certs        | **Same Domain** |
| **DNS Management**     | ✅ Single record                  | ⚠️ Multiple records      | **Same Domain** |

### Subdomain Benefits

✅ **Better Security Isolation**

- Separate domain for TURN server
- Isolated security policies
- Independent monitoring

✅ **Harder to Discover**

- TURN server not obvious from API domain
- Reduces automated discovery attacks
- Requires specific knowledge to find

✅ **Reduced Attack Surface**

- Smaller footprint per domain
- Attackers must target specific subdomain
- Less information leakage

✅ **Separate Security Policies**

- Different firewall rules per domain
- Separate DDoS protection
- Independent rate limiting

✅ **Isolated Compromise**

- If one domain compromised, other safer
- Can isolate affected service
- Better incident response

### Current Configuration

**Recommended:** Use `backend-service-v1-video.ishswami.in` for unified video
infrastructure (OpenVidu + Coturn)

**Alternative:** Use `turn.ishswami.in` for dedicated Coturn subdomain (if
separating from OpenVidu)

---

## Firewall & Security Setup

### 1. UFW Rules (Basic)

```bash
# Standard STUN/TURN
sudo ufw allow 3478/udp comment 'Coturn TURN/STUN UDP'
sudo ufw allow 3478/tcp comment 'Coturn TURN/STUN TCP'

# Secure TURNS (TLS)
sudo ufw allow 5349/udp comment 'Coturn TURNS UDP'
sudo ufw allow 5349/tcp comment 'Coturn TURNS TCP'

# Media Relay Port Range
sudo ufw allow 49160:49200/udp comment 'Coturn media ports UDP'
sudo ufw allow 49160:49200/tcp comment 'Coturn media ports TCP'
```

### 2. iptables Rate Limiting (Advanced)

To prevent DDoS and brute-force discovery:

```bash
# Install iptables-persistent if not installed
if ! command -v netfilter-persistent &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y iptables-persistent
fi

# Rate limiting rules for UDP (3478)
sudo iptables -A INPUT -p udp --dport 3478 -m state --state NEW -m recent --set --name coturn-udp
sudo iptables -A INPUT -p udp --dport 3478 -m state --state NEW -m recent --update --seconds 60 --hitcount 10 --name coturn-udp -j DROP

# Rate limiting rules for TCP (3478)
sudo iptables -A INPUT -p tcp --dport 3478 -m state --state NEW -m recent --set --name coturn-tcp
sudo iptables -A INPUT -p tcp --dport 3478 -m state --state NEW -m recent --update --seconds 60 --hitcount 10 --name coturn-tcp -j DROP

# Rate limiting for media ports (49160-49200)
sudo iptables -A INPUT -p udp --dport 49160:49200 -m state --state NEW -m recent --set --name coturn-media-udp
sudo iptables -A INPUT -p udp --dport 49160:49200 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name coturn-media-udp -j DROP

sudo iptables -A INPUT -p tcp --dport 49160:49200 -m state --state NEW -m recent --set --name coturn-media-tcp
sudo iptables -A INPUT -p tcp --dport 49160:49200 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name coturn-media-tcp -j DROP

# Save iptables rules
sudo netfilter-persistent save
```

### 3. Fail2Ban Configuration

**Create filter (`/etc/fail2ban/filter.d/coturn.conf`):**

```ini
[Definition]
failregex = ^.*WARNING:.*client <HOST>.*authentication failed
            ^.*ERROR:.*client <HOST>.*authentication failed
            ^.*WARNING:.*client <HOST>.*relay request failed
ignoreregex =
```

**Add to `/etc/fail2ban/jail.local`:**

```ini
[coturn]
enabled = true
port = 3478,5349
protocol = udp,tcp
filter = coturn
logpath = /var/log/coturn.log
maxretry = 5
findtime = 300
bantime = 3600
action = %(action_)s
```

**Restart Fail2Ban:**

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status coturn
```

### 4. Monitoring Script

**Create monitoring script (`/usr/local/bin/monitor-coturn.sh`):**

```bash
#!/bin/bash
# Monitor Coturn for suspicious activity

LOG_FILE="/var/log/coturn.log"
THRESHOLD=100

if [ ! -f "$LOG_FILE" ]; then
    exit 0
fi

# Count failed authentication attempts in last 5 minutes
FAILED_AUTH=$(grep -i "authentication failed" "$LOG_FILE" 2>/dev/null | \
    awk -v date="$(date -d '5 minutes ago' '+%Y-%m-%d %H:%M')" '$0 > date' | wc -l)

if [ "$FAILED_AUTH" -gt "$THRESHOLD" ]; then
    echo "ALERT: $FAILED_AUTH failed authentication attempts in last 5 minutes"
    # Log to syslog
    logger -t coturn-monitor "ALERT: $FAILED_AUTH failed authentication attempts"
fi

# Check for suspicious IPs (too many connections)
if [ -f "$LOG_FILE" ]; then
    SUSPICIOUS=$(grep -i "client" "$LOG_FILE" 2>/dev/null | \
        awk '{print $NF}' | sort | uniq -c | sort -rn | head -1)

    if [ -n "$SUSPICIOUS" ]; then
        CONN_COUNT=$(echo "$SUSPICIOUS" | awk '{print $1}')
        IP=$(echo "$SUSPICIOUS" | awk '{print $2}')

        if [ "$CONN_COUNT" -gt 50 ] && [ -n "$IP" ]; then
            echo "ALERT: IP $IP has $CONN_COUNT connections (possible DDoS)"
            logger -t coturn-monitor "ALERT: IP $IP has $CONN_COUNT connections"
            # Auto-ban (optional - uncomment if desired)
            # sudo ufw deny from "$IP" comment "Coturn DDoS protection"
        fi
    fi
fi
```

**Make executable and add to crontab:**

```bash
sudo chmod +x /usr/local/bin/monitor-coturn.sh

# Add to crontab (run every 5 minutes)
(crontab -l 2>/dev/null | grep -v "monitor-coturn.sh"; echo "*/5 * * * * /usr/local/bin/monitor-coturn.sh") | crontab -
```

---

## Docker Configuration

### Enhanced Security Configuration

**File:** `devops/docker/docker-compose.prod.yml`

```yaml
  coturn:
  profiles: ["infrastructure"]
  image: coturn/coturn:latest
  container_name: coturn
  hostname: coturn
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "49160-49200:49160-49200/udp"
    - "49160-49200:49160-49200/tcp"
    environment:
    - TZ=UTC
    - COTURN_DOMAIN=${COTURN_DOMAIN:-backend-service-v1-video.ishswami.in}
      - COTURN_PASSWORD=${COTURN_PASSWORD}
  command:
    - -n
    - --log-file=stdout
    - --listening-ip=0.0.0.0
    - --listening-port=3478
    - --min-port=49160
    - --max-port=49200
    # Security options
    - --fingerprint                    # Enable STUN fingerprinting
    - --lt-cred-mech                   # Long-term credentials mechanism
    - --user=openvidu:${COTURN_PASSWORD}  # Use environment variable
    - --realm=${COTURN_DOMAIN}         # Use dedicated subdomain
    - --server-name=${COTURN_DOMAIN}   # Server name for identification
    - --no-cli                         # Disable CLI (security)
    - --no-tls                         # TLS disabled (if using Cloudflare, enable TLS)
    - --no-dtls                        # DTLS disabled
    # Additional security options
    - --max-bps=1000000                # Limit bandwidth per session (1 Mbps)
    - --max-sessions-per-user=10       # Limit sessions per user
    - --total-quota=1000000            # Total quota per user (1 GB)
    - --user-quota=1000000             # User quota (1 GB)
    - --no-multicast-peers             # Disable multicast peers
    - --verbose                        # Enable verbose logging for monitoring
  volumes:
    - coturn_logs:/var/log
    - /etc/letsencrypt:/etc/letsencrypt:ro  # For TLS certificates (if enabled)
  networks:
    app-network:
      ipv4_address: 172.18.0.8
      aliases:
        - coturn
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "turnutils_stunclient", "-p", "3478", "localhost"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 10s
  # Resource limits to prevent resource exhaustion
  deploy:
    resources:
      limits:
        cpus: "1.0"
        memory: 1G
      reservations:
        cpus: "0.5"
        memory: 512M

    volumes:
  coturn_logs:
```

### Set Strong Password

```bash
# Generate strong password (min 32 characters)
COTURN_PASSWORD=$(openssl rand -base64 32)

# Add to .env.production
echo "COTURN_PASSWORD=$COTURN_PASSWORD" >> .env.production
```

---

## Nginx Configuration

### Why Separate Nginx Config for OpenVidu?

**Short Answer:** ✅ **YES for OpenVidu**, ❌ **NO for Coturn**

### OpenVidu Server Requirements

| Requirement        | Backend API | OpenVidu               | Conflict?             |
| ------------------ | ----------- | ---------------------- | --------------------- |
| **Timeout**        | 60s         | 86400s (24 hours)      | ⚠️ **YES**            |
| **Buffering**      | Off         | Off                    | ✅ Same               |
| **WebSocket**      | Socket.IO   | Video streaming        | ⚠️ Different patterns |
| **Body Size**      | 100M        | 100M+                  | ✅ Same               |
| **Proxy Settings** | Standard    | Long-lived connections | ⚠️ **YES**            |

**Key Differences:**

1. **Timeouts:** OpenVidu needs `86400s` (24 hours) for long video sessions,
   while API needs `60s`
2. **Connection Pattern:** OpenVidu maintains persistent WebSocket connections
   for hours
3. **Resource Usage:** OpenVidu is bandwidth-intensive, API is request-intensive
4. **SSL Certificate:** Separate domain = separate certificate management

### Coturn Server

**Coturn doesn't need Nginx:**

1. **TURN/STUN Protocol:** Coturn uses TURN/STUN protocol (UDP/TCP), not HTTP
2. **Direct Connection:** WebRTC clients connect directly to Coturn on port 3478
3. **No HTTP:** Coturn doesn't serve HTTP traffic, so Nginx can't proxy it
4. **Port Exposure:** Already exposed directly in `docker-compose.prod.yml`

### Nginx Configuration for Video Domain

**File**: `devops/nginx/sites-available/backend-service-v1-video.ishswami.in`

**Create configuration:**

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name backend-service-v1-video.ishswami.in;

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all HTTP requests to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server for OpenVidu Video
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name backend-service-v1-video.ishswami.in;

    # SSL certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/backend-service-v1-video.ishswami.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/backend-service-v1-video.ishswami.in/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/backend-service-v1-video.ishswami.in.access.log;
    error_log /var/log/nginx/backend-service-v1-video.ishswami.in.error.log;

    # Client body size (for video uploads if needed)
    client_max_body_size 100M;

    # Timeouts (longer for video streaming)
    proxy_connect_timeout 60s;
    proxy_send_timeout 86400s;
    proxy_read_timeout 86400s;

    # Proxy to OpenVidu Docker container
    # OpenVidu runs on port 4443 (HTTP internally, SSL handled by Nginx)
    location / {
        proxy_pass http://127.0.0.1:4443;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # WebSocket support (required for OpenVidu video streaming)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Disable buffering for real-time video streaming
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # OpenVidu specific WebSocket endpoint
    location /openvidu {
        proxy_pass http://127.0.0.1:4443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }
}
```

### Setup Steps

```bash
# 1. Copy configuration file
sudo cp devops/nginx/sites-available/backend-service-v1-video.ishswami.in /etc/nginx/sites-available/

# 2. Enable site
sudo ln -s /etc/nginx/sites-available/backend-service-v1-video.ishswami.in /etc/nginx/sites-enabled/

# 3. Test configuration
sudo nginx -t

# 4. Obtain SSL certificate
sudo certbot --nginx -d backend-service-v1-video.ishswami.in

# 5. Reload Nginx
sudo systemctl reload nginx
```

### Environment Configuration

**Updated in `.env.production`:**

```bash
OPENVIDU_URL=https://backend-service-v1-video.ishswami.in
OPENVIDU_DOMAIN=backend-service-v1-video.ishswami.in
COTURN_DOMAIN=backend-service-v1-video.ishswami.in
COTURN_PASSWORD=your-strong-password-min-32-chars
```

---

## Verification & Troubleshooting

### 1. Test DNS Resolution

```bash
dig backend-service-v1-video.ishswami.in +short
nslookup backend-service-v1-video.ishswami.in
host backend-service-v1-video.ishswami.in
```

### 2. Verify Port Accessibility

```bash
# Test UDP port 3478
nc -u -v backend-service-v1-video.ishswami.in 3478

# Test TCP port 3478
nc -v backend-service-v1-video.ishswami.in 3478

# Using telnet
telnet backend-service-v1-video.ishswami.in 3478
```

### 3. Test TURN Server

```bash
# Install turnutils if not available
# Ubuntu/Debian:
sudo apt-get install coturn-utils

# Test STUN
turnutils_stunclient backend-service-v1-video.ishswami.in:3478

# Expected output: Should show successful STUN binding
```

### 4. Test from Docker Container

```bash
# Test from within Coturn container
docker exec coturn turnutils_stunclient backend-service-v1-video.ishswami.in:3478

# Test from API container
docker exec healthcare-backend-api-1 turnutils_stunclient backend-service-v1-video.ishswami.in:3478
```

### 5. Check Coturn Logs

```bash
docker logs coturn
# Look for: "TLS listening on: 0.0.0.0:5349" (if TLS enabled)
# Look for: "listening on: 0.0.0.0:3478"
```

### 6. Verify Nginx Configuration

```bash
# Test Nginx configuration
sudo nginx -t

# Check Nginx status
sudo systemctl status nginx

# Check Nginx logs
sudo tail -f /var/log/nginx/backend-service-v1-video.ishswami.in.error.log
sudo tail -f /var/log/nginx/backend-service-v1-video.ishswami.in.access.log

# Test HTTPS connection
curl -I https://backend-service-v1-video.ishswami.in
```

### Common Issues

#### DNS Not Resolving

**Problem:** `backend-service-v1-video.ishswami.in` doesn't resolve

**Solutions:**

1. **Check DNS record exists:**

   ```bash
   dig backend-service-v1-video.ishswami.in
   ```

2. **Verify record configuration:**
   - Check for typos in domain name
   - Verify IP address is correct
   - Check TTL hasn't expired

3. **Wait for propagation:**
   - DNS changes can take up to 24 hours
   - Use different DNS servers to test

4. **Clear DNS cache:**

   ```bash
   # Linux
   sudo systemd-resolve --flush-caches

   # macOS
   sudo dscacheutil -flushcache

   # Windows
   ipconfig /flushdns
   ```

#### Port Not Accessible

**Problem:** DNS resolves but port 3478 not accessible

**Solutions:**

1. **Check firewall:**

   ```bash
   sudo ufw status
   sudo iptables -L -n | grep 3478
   ```

2. **Verify Docker port mapping:**

   ```bash
   docker ps | grep coturn
   # Should show: 0.0.0.0:3478->3478/udp
   ```

3. **Check server firewall:**
   ```bash
   # Ensure ports are open
   sudo ufw allow 3478/udp
   sudo ufw allow 3478/tcp
   ```

#### TURN Server Not Responding

**Problem:** DNS resolves, port accessible, but TURN server not responding

**Solutions:**

1. **Check Coturn container:**

   ```bash
   docker logs coturn
   docker ps | grep coturn
   ```

2. **Verify Coturn configuration:**

   ```bash
   docker exec coturn cat /etc/turnserver.conf
   # Or check docker-compose.yml
   ```

3. **Test locally:**
   ```bash
   docker exec coturn turnutils_stunclient localhost:3478
   ```

#### SSL Certificate Issues

**Problem:** Certificate not found or invalid

**Solutions:**

1. **Request certificate:**

   ```bash
   sudo certbot --nginx -d backend-service-v1-video.ishswami.in
   ```

2. **Check certificate location:**

   ```bash
   ls -la /etc/letsencrypt/live/backend-service-v1-video.ishswami.in/
   ```

3. **Verify certificate paths in docker-compose.yml match certbot location**

#### Nginx Not Starting

**Problem:** Configuration error

**Solutions:**

1. **Test configuration:**

   ```bash
   sudo nginx -t
   ```

2. **Check error logs:**
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

#### WebSocket Not Working

**Problem:** WebSocket connections failing

**Solutions:**

1. Verify `Upgrade` and `Connection` headers are set in Nginx config
2. Check OpenVidu container is running on port 4443
3. Verify firewall allows port 443
4. Check Nginx logs for WebSocket upgrade errors

---

## Architecture & OpenVidu Analysis

### Infrastructure Map

```
┌─────────────────────────────────────────────────────────┐
│                    Client Devices                       │
│  (Web Browser, Mobile App, Desktop App)                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ HTTPS (443)
                 │ WebSocket
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              backend-service-v1-video.ishswami.in        │
│                    (Nginx Reverse Proxy)                │
│  ┌──────────────────────────────────────────────────┐  │
│  │  SSL Termination                                 │  │
│  │  - 86400s timeouts                               │  │
│  │  - WebSocket support                             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                 │
                 │ Internal Docker Network
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              OpenVidu Server (Internal)                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Connects to Coturn via: coturn:3478            │  │
│  │  (Internal Docker service name)                 │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                 │
                 │ Internal Docker Network
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              Coturn Container (Internal)                 │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Realm: backend-service-v1-video.ishswami.in    │  │
│  │  Server Name: backend-service-v1-video.ishswami.in│ │
│  │  Port: 3478 (UDP/TCP)                             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                 │
                 │ Direct UDP/TCP (3478)
                 │ (Cannot be proxied through Nginx)
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              backend-service-v1-video.ishswami.in        │
│              (External Subdomain)                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  TURN/STUN Server                                 │  │
│  │  - WebRTC Media Relay                             │  │
│  │  - NAT Traversal                                  │  │
│  │  - Direct Internet Access                         │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Why Separate Subdomain?

Use `backend-service-v1-video.ishswami.in` for OpenVidu instead of the main API
domain because:

1. **Timeouts**: OpenVidu needs 24-hour timeouts (`86400s`), while the API needs
   short timeouts (`60s`).
2. **Connection Pattern**: Video uses long-lived WebSockets; API uses
   short-lived REST/socket requests.
3. **Security**: Isolates video infrastructure (Coturn/OpenVidu) from the main
   API.
4. **Scaling**: Can scale video service independently
5. **SSL Management**: Separate certificate management
6. **OpenVidu Best Practices**: OpenVidu documentation recommends separate
   domain/subdomain

### Current Configuration Summary

✅ **Keep Separate Nginx Configs**

1. **`backend-service-v1.ishswami.in`** → API (port 8088)
   - Timeout: 60s
   - WebSocket: Socket.IO
   - Purpose: REST API + Socket.IO

2. **`backend-service-v1-video.ishswami.in`** → OpenVidu (port 4443)
   - Timeout: 86400s
   - WebSocket: Video streaming
   - Purpose: Video conferencing

3. **Coturn** → Direct exposure (port 3478)
   - No Nginx needed
   - Direct UDP/TCP access
   - Purpose: TURN/STUN for WebRTC

---

## Security Implementation Checklist

### ✅ Pre-Setup

- [ ] DNS record created (`backend-service-v1-video.ishswami.in`)
- [ ] DNS resolves correctly (`dig backend-service-v1-video.ishswami.in`)
- [ ] Proxy status set to **DNS Only** (Gray Cloud) in Cloudflare

### ✅ Firewall Configuration

- [ ] UFW rules configured (ports 3478, 5349, 49160-49200)
- [ ] iptables rate limiting configured
- [ ] Rate limiting rules saved (`netfilter-persistent save`)
- [ ] Firewall rules verified (`sudo ufw status`)

### ✅ Fail2Ban Configuration

- [ ] Coturn filter created (`/etc/fail2ban/filter.d/coturn.conf`)
- [ ] Coturn jail added to `/etc/fail2ban/jail.local`
- [ ] Fail2Ban restarted (`sudo systemctl restart fail2ban`)
- [ ] Fail2Ban status checked (`sudo fail2ban-client status coturn`)

### ✅ Docker Configuration

- [ ] Strong password set (`COTURN_PASSWORD` in `.env.production`)
- [ ] Docker Compose configuration reviewed
- [ ] Resource limits configured
- [ ] Security options enabled (fingerprint, lt-cred-mech, etc.)
- [ ] Coturn container restarted with new configuration

### ✅ Nginx Configuration

- [ ] Nginx config file created (`backend-service-v1-video.ishswami.in`)
- [ ] Site enabled in `/etc/nginx/sites-enabled/`
- [ ] SSL certificate obtained (`certbot --nginx`)
- [ ] Nginx configuration tested (`nginx -t`)
- [ ] Nginx reloaded (`systemctl reload nginx`)
- [ ] HTTPS connection works
      (`curl -I https://backend-service-v1-video.ishswami.in`)

### ✅ Monitoring

- [ ] Monitoring script created (`/usr/local/bin/monitor-coturn.sh`)
- [ ] Monitoring script executable (`chmod +x`)
- [ ] Cron job added (runs every 5 minutes)
- [ ] Log rotation configured

### ✅ Verification

- [ ] Port 3478 accessible (UDP and TCP)
- [ ] TURN server responds
      (`turnutils_stunclient backend-service-v1-video.ishswami.in:3478`)
- [ ] Coturn logs show correct domain (`docker logs coturn | grep realm`)
- [ ] OpenVidu accessible via HTTPS
- [ ] WebSocket connections working
- [ ] No errors in logs

---

## 📚 Related Documentation

- **Server Setup**: `docs/UBUNTU_24_SERVER_SETUP.md` - Complete server setup and
  security
- **Deployment Guide**: `docs/DEPLOYMENT_GUIDE.md` - CI/CD and deployment
- **Docker Configuration**: `devops/docker/docker-compose.prod.yml` - Docker
  Compose setup

---

## ⚠️ Important Notes

1. **TURN/STUN must be accessible** - WebRTC requires direct access to port 3478
2. **UDP is harder to protect** - Consider Cloudflare Spectrum (paid) for full
   DDoS protection
3. **Monitor regularly** - Check logs frequently for authentication failures
4. **Use strong password** - Minimum 32 characters, use
   `openssl rand -base64 32`
5. **Rate limiting is critical** - Prevents DDoS and brute force attacks
6. **Fail2Ban helps** - Automatically bans IPs with repeated failures
7. **Separate subdomain recommended** - Better security isolation for production

---

**Last Updated:** 2026-01-05 **Version:** 2.0 (Complete Consolidation)  
**Status:** ✅ All Coturn documentation consolidated into this guide
