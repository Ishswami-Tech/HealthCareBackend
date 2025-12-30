# Nginx Configuration for Healthcare Backend

Complete guide for Nginx configuration, SSL certificates, and Cloudflare setup for the Healthcare Backend API, Frontend, and OpenVidu video service.

## 📁 Directory Structure

```
devops/nginx/
├── sites-available/          # Nginx site configurations (server-specific)
│   ├── api.ishswami.in       # API server configuration
│   └── video.ishswami.in     # OpenVidu video server configuration
└── README.md                 # This file
```

## 🌐 Domains Configuration

### Production Domains

1. **api.ishswami.in** - Backend API
   - Proxies to: `http://localhost:8088` (Docker container)
   - SSL: Let's Encrypt certificate
   - Location: `/etc/nginx/sites-available/api.ishswami.in`

2. **video.ishswami.in** - OpenVidu Video Service
   - Proxies to: `http://127.0.0.1:4443` (OpenVidu Docker container)
   - SSL: Let's Encrypt certificate
   - Location: `/etc/nginx/sites-available/video.ishswami.in`

3. **ishswami.in** - Frontend (if applicable)
   - Serves static files or proxies to frontend
   - SSL: Let's Encrypt certificate

## 🚀 Server Setup

### 1. Copy Configuration Files

```bash
# Copy API configuration
sudo cp devops/nginx/sites-available/api.ishswami.in /etc/nginx/sites-available/api.ishswami.in

# Copy OpenVidu configuration
sudo cp devops/nginx/sites-available/video.ishswami.in /etc/nginx/sites-available/video.ishswami.in
```

### 2. Enable Sites

```bash
# Enable API site
sudo ln -s /etc/nginx/sites-available/api.ishswami.in /etc/nginx/sites-enabled/api.ishswami.in

# Enable OpenVidu site
sudo ln -s /etc/nginx/sites-available/video.ishswami.in /etc/nginx/sites-enabled/video.ishswami.in
```

### 3. Get SSL Certificates

```bash
# Get certificate for API
sudo certbot certonly --nginx -d api.ishswami.in

# Get certificate for OpenVidu
sudo certbot certonly --nginx -d video.ishswami.in
```

### 4. Test and Reload

```bash
# Test configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

## 🔧 Configuration Details

### API Server (api.ishswami.in)

- **Port**: 443 (HTTPS), 80 (HTTP redirect)
- **Backend**: Docker container on `localhost:8088`
- **Features**:
  - SSL termination
  - WebSocket support (Socket.IO)
  - Security headers
  - Health check endpoint

### OpenVidu Server (video.ishswami.in)

- **Port**: 443 (HTTPS), 80 (HTTP redirect)
- **Backend**: OpenVidu Docker container on `127.0.0.1:4443`
- **Features**:
  - SSL termination
  - WebSocket support (video streaming)
  - Extended timeouts (86400s for long sessions)
  - Disabled buffering for real-time streaming

## ☁️ Cloudflare Setup

### 1. DNS Configuration

Add the following A records in Cloudflare:

| Domain | Type | Target | Proxy Status |
|--------|------|--------|--------------|
| api.ishswami.in | A | 31.220.79.219 | Proxied (Orange Cloud) |
| video.ishswami.in | A | 31.220.79.219 | Proxied (Orange Cloud) |
| ishswami.in | A | 31.220.79.219 | Proxied (Orange Cloud) |

**Important**: Set Cloudflare SSL/TLS mode to **Full (Strict)** for end-to-end encryption.

### 2. SSL/TLS Configuration

1. Login to your Cloudflare dashboard
2. Go to the SSL/TLS section
3. Set encryption mode to **Full (strict)** (not Flexible)

### 3. SSL/TLS Certificate Settings

1. Go to the Edge Certificates tab
2. Enable "Always Use HTTPS"
3. Set minimum TLS version to TLS 1.2
4. Enable "Automatic HTTPS Rewrites"

### 4. Page Rules (Optional)

Create these page rules:

1. **URL pattern**: `*api.ishswami.in/*`
   - Settings: SSL = Full Strict, Cache Level = Bypass

2. **URL pattern**: `*api.ishswami.in/socket.io/*`
   - Settings: SSL = Full Strict, Disable Security (to allow WebSockets)

3. **URL pattern**: `*video.ishswami.in/*`
   - Settings: SSL = Full Strict, Cache Level = Bypass (for OpenVidu video streaming)

### 5. Firewall Settings

1. Go to the Firewall section
2. Allow traffic to API ports (8088, 4443 for OpenVidu) if required
3. Note: Ports 50000-50050 (UDP/TCP) are used by OpenVidu for media streaming

### 6. Testing

1. Clear your browser cache or use incognito mode
2. Visit https://api.ishswami.in - Should show API health status
3. Visit https://video.ishswami.in - Should show OpenVidu dashboard or connection page
4. Confirm SSL is valid for both domains (green lock icon)
5. Test WebSocket connections for both API and OpenVidu

## 🔐 SSL Certificate Management

### Certificate Setup

The system uses Let's Encrypt certificates for securing HTTPS connections. The certificates are:
- **API**: `/etc/letsencrypt/live/api.ishswami.in/`
- **Video (OpenVidu)**: `/etc/letsencrypt/live/video.ishswami.in/`
- Managed by Certbot
- Valid for 90 days
- Automatically renewed

### Auto-Renewal Process

Certificates are automatically renewed through:

1. **Daily Cron Job**: A cron job runs every day at 3:00 AM to check and renew certificates approaching expiration:
   ```
   0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'
   ```

2. **Deployment Check**: During each deployment, the system:
   - Checks if certificates exist
   - Verifies the expiration date
   - Attempts renewal if less than 30 days remain
   - Reloads Nginx after successful renewal

3. **Initial Setup**: If certificates don't exist when deploying, the system:
   - Installs Certbot if needed
   - Generates new certificates for `api.ishswami.in` and `video.ishswami.in`
   - Sets up the auto-renewal cron job

### Fallback Mechanism

If Let's Encrypt certificate generation fails, the system creates self-signed certificates as a fallback:
- Located at `/etc/ssl/certs/nginx/nginx-selfsigned.crt` and `/etc/ssl/certs/nginx/nginx-selfsigned.key`
- Valid for 365 days
- Nginx configuration is automatically updated to use these certificates

### Manual Renewal

To manually renew certificates:
```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Certificate Status Check

To check certificate status:
```bash
sudo certbot certificates
```

### Getting New Certificates

To get a certificate for a new domain:
```bash
sudo certbot certonly --nginx -d domain.ishswami.in
```

Example for video.ishswami.in:
```bash
sudo certbot certonly --nginx -d video.ishswami.in
```

## 🐛 Troubleshooting

### Check Nginx Status

```bash
sudo systemctl status nginx
```

### Test Configuration

```bash
sudo nginx -t
```

### View Logs

```bash
# API logs
sudo tail -f /var/log/nginx/api.ishswami.in.error.log
sudo tail -f /var/log/nginx/api.ishswami.in.access.log

# OpenVidu logs
sudo tail -f /var/log/nginx/video.ishswami.in.error.log
sudo tail -f /var/log/nginx/video.ishswami.in.access.log
```

### Check SSL Certificates

```bash
sudo certbot certificates
```

### Verify Docker Containers

```bash
# Check API container
docker ps | grep api

# Check OpenVidu container
docker ps | grep openvidu

# Test API directly
curl http://localhost:8088/health

# Test OpenVidu directly
curl http://127.0.0.1:4443
```

### Check Ports

```bash
# Check if ports are listening
sudo netstat -tlnp | grep 8088  # API
sudo netstat -tlnp | grep 4443  # OpenVidu
```

### Cloudflare Troubleshooting

1. Check your server's SSL certificates: `sudo certbot certificates`
2. Check Nginx configuration: `sudo nginx -t`
3. Review Nginx logs:
   - API: `sudo tail -f /var/log/nginx/api.ishswami.in.error.log`
   - OpenVidu: `sudo tail -f /var/log/nginx/video.ishswami.in.error.log`
4. Check Docker container logs:
   - API: `docker logs latest-api`
   - OpenVidu: `docker logs latest-openvidu-server`
5. Verify DNS propagation: `dig api.ishswami.in` and `dig video.ishswami.in`

## 📝 Important Notes

- **Server IP**: 31.220.79.219 (Contabo VPS)
- **Nginx Config Location**: `/etc/nginx/sites-available/` and `/etc/nginx/sites-enabled/`
- **SSL Certificates**: Managed by Certbot, stored in `/etc/letsencrypt/live/`
- **Auto-renewal**: Certbot cron job runs daily at 3:00 AM
- **Cloudflare**: All domains should be proxied (orange cloud) for DDoS protection
- **DNS**: Ensure DNS for `api.ishswami.in`, `ishswami.in`, and `video.ishswami.in` points to your server IP (31.220.79.219)
- **SSL Mode**: Use Cloudflare in Full (Strict) mode for end-to-end TLS

## 🔄 Updating Configuration

After making changes to configuration files:

1. Test the configuration: `sudo nginx -t`
2. If test passes, reload: `sudo systemctl reload nginx`
3. Check logs for any errors: `sudo tail -f /var/log/nginx/error.log`

## 📚 Related Documentation

- [Server Setup Guide](../../docs/SERVER_SETUP_GUIDE.md)
- [Deployment Guide](../../docs/DEPLOYMENT_GUIDE.md)
