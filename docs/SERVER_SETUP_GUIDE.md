# 🚀 Contabo VPS Server Setup Guide

Complete step-by-step guide for setting up your Contabo VPS server for Healthcare Backend deployment.

## 📋 Server Information

- **IP Address**: 31.220.79.219
- **IPv6**: 2a02:c207:2299:5997::1/64
- **OS**: Linux (Ubuntu)
- **Specs**: 6 CPU cores, 12 GB RAM, 200 GB SSD
- **Default User**: root
- **Domain**: api.ishswami.in (via Cloudflare)

---

## 🔐 Step 1: Initial Server Access & Security

### 1.1 Connect to Your Server

```bash
# Connect via SSH
ssh root@31.220.79.219

# If you have an SSH key, use:
ssh -i ~/.ssh/your_key root@31.220.79.219
```

### 1.2 Update System

```bash
# Update package list
apt update && apt upgrade -y

# Install essential tools
apt install -y curl wget git ufw fail2ban htop nano
```

### 1.3 Create Non-Root User (Security Best Practice)

```bash
# Create a new user
adduser deploy
# Enter password when prompted (use a strong password)

# Add user to sudo group
usermod -aG sudo deploy

# Add user to docker group (we'll install Docker next)
usermod -aG docker deploy

# Switch to new user
su - deploy
```

### 1.4 Setup SSH Key Authentication (Recommended)

**On your local machine:**

```bash
# Generate SSH key if you don't have one
ssh-keygen -t ed25519 -C "contabo-server" -f ~/.ssh/contabo_server

# Copy public key to server
ssh-copy-id -i ~/.ssh/contabo_server.pub deploy@31.220.79.219

# Or manually:
cat ~/.ssh/contabo_server.pub | ssh deploy@31.220.79.219 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**On server (as deploy user):**

```bash
# Set proper permissions
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 1.5 Configure Firewall (UFW)

```bash
# Allow SSH (important - do this first!)
ufw allow 22/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow your application port (if needed for direct access)
ufw allow 8088/tcp

# Enable firewall
ufw enable

# Check status
ufw status
```

### 1.6 Setup Fail2Ban (Protection against brute force)

```bash
# Fail2Ban is already installed, configure it
systemctl enable fail2ban
systemctl start fail2ban

# Check status
systemctl status fail2ban
```

---

## 🐳 Step 2: Install Docker & Docker Compose

### 2.1 Install Docker

```bash
# Install Docker using official script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Verify installation
docker --version
```

### 2.2 Install Docker Compose

```bash
# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify installation
docker compose version
```

### 2.3 Configure Docker (Optional - for better performance)

```bash
# Create Docker daemon config
sudo nano /etc/docker/daemon.json
```

Add this content:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
```

```bash
# Restart Docker
sudo systemctl restart docker
```

---

## 🌐 Step 3: Install & Configure Nginx

### 3.1 Install Nginx

```bash
sudo apt install nginx -y

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Check status
sudo systemctl status nginx
```

### 3.2 Configure Nginx for api.ishswami.in

```bash
# Create Nginx configuration file
sudo nano /etc/nginx/sites-available/api.ishswami.in
```

Add this configuration:

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name api.ishswami.in;

    # For Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.ishswami.in;

    # SSL certificates (we'll get these with Certbot)
    ssl_certificate /etc/letsencrypt/live/api.ishswami.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.ishswami.in/privkey.pem;

    # SSL Configuration (Best Practices)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/api.ishswami.in.access.log;
    error_log /var/log/nginx/api.ishswami.in.error.log;

    # Client body size (for file uploads)
    client_max_body_size 100M;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # Proxy to Docker container
    location / {
        proxy_pass http://localhost:8088;
        proxy_http_version 1.1;
        
        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # WebSocket support (for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Health check endpoint (bypass proxy for faster response)
    location /health {
        proxy_pass http://localhost:8088/health;
        access_log off;
    }
}
```

### 3.3 Enable Site

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/api.ishswami.in /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

---

## 🔒 Step 4: Setup SSL Certificate with Let's Encrypt

### 4.1 Install Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
```

### 4.2 Get SSL Certificate

```bash
# Make sure DNS is pointing to your server first!
# In Cloudflare, set A record: api.ishswami.in -> 31.220.79.219

# Get certificate
sudo certbot --nginx -d api.ishswami.in

# Follow the prompts:
# - Enter your email
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (choose 2 for redirect)
```

### 4.3 Setup Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot automatically sets up a cron job, but verify:
sudo systemctl status certbot.timer
```

---

## ☁️ Step 5: Configure Cloudflare

### 5.1 DNS Configuration

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your domain `ishswami.in`
3. Go to **DNS** → **Records**
4. Add/Update these records:

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | api | 31.220.79.219 | ✅ Proxied | Auto |

### 5.2 SSL/TLS Configuration

1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode to **Full (strict)**
3. This ensures Cloudflare → Server uses HTTPS

### 5.3 Additional Cloudflare Settings

**SSL/TLS → Edge Certificates:**
- Always Use HTTPS: ✅ ON
- Minimum TLS Version: 1.2

**Speed → Optimization:**
- Auto Minify: Enable for JS, CSS, HTML
- Brotli: ✅ ON

**Network:**
- HTTP/2: ✅ ON
- HTTP/3 (with QUIC): ✅ ON (optional)

**Security:**
- Security Level: Medium
- Challenge Passage: 30 minutes
- Browser Integrity Check: ✅ ON

---

## 📁 Step 6: Setup Deployment Directory

### 6.1 Create Directory Structure

```bash
# Create deployment directory
sudo mkdir -p /opt/healthcare-backend
sudo chown -R deploy:deploy /opt/healthcare-backend
cd /opt/healthcare-backend

# Create logs directory
mkdir -p devops/docker/logs
```

### 6.2 Clone Repository (Optional - if using git on server)

```bash
# Clone your repository
git clone https://github.com/your-username/your-repo.git .

# Or if using SSH:
git clone git@github.com:your-username/your-repo.git .
```

### 6.3 Create .env.production File

```bash
# The .env.production will be created automatically by GitHub Actions
# But you can create a template for reference:
nano .env.production
```

**Note**: The actual `.env.production` will be created by the deployment script from GitHub Secrets.

---

## 🔧 Step 7: Configure GitHub Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**

Add these secrets (use values from your `.env.production` template):

### Required Secrets:

1. **Server Access:**
   - `SSH_PRIVATE_KEY` - Your SSH private key
   - `SERVER_HOST` - `31.220.79.219`
   - `SERVER_USER` - `deploy`
   - `SERVER_DEPLOY_PATH` - `/opt/healthcare-backend`

2. **Application Configuration:**
   - `DATABASE_URL` - Your PostgreSQL connection string
   - `JWT_SECRET` - Secure JWT secret (min 32 chars)
   - `SESSION_SECRET` - Secure session secret (min 32 chars)
   - `COOKIE_SECRET` - Secure cookie secret (min 32 chars)

3. **All other environment variables** from your `.env.production` file

---

## 🚀 Step 8: Test Deployment

### 8.1 Manual Test (Before CI/CD)

```bash
# Login to GitHub Container Registry
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Pull image
docker pull ghcr.io/your-username/your-repo/healthcare-api:latest

# Test docker-compose
cd /opt/healthcare-backend
docker compose -f devops/docker/docker-compose.prod.yml up -d

# Check logs
docker compose -f devops/docker/docker-compose.prod.yml logs -f
```

### 8.2 Verify Everything Works

```bash
# Check Docker containers
docker ps

# Check Nginx
sudo systemctl status nginx

# Test API locally
curl http://localhost:8088/health

# Test through Nginx
curl https://api.ishswami.in/health
```

---

## 📊 Step 9: Monitoring & Maintenance

### 9.1 Setup Log Rotation

```bash
# Docker logs are already configured, but setup Nginx log rotation
sudo nano /etc/logrotate.d/nginx-api
```

Add:

```
/var/log/nginx/api.ishswami.in.*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

### 9.2 Setup System Monitoring

```bash
# Install monitoring tools
sudo apt install -y htop iotop nethogs

# Check system resources
htop
```

### 9.3 Setup Automatic Updates (Optional but Recommended)

```bash
# Install unattended-upgrades
sudo apt install unattended-upgrades -y

# Configure
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 🔐 Step 10: Security Hardening

### 10.1 Disable Root Login (After setting up SSH keys)

```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config
```

Find and change:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

```bash
# Restart SSH
sudo systemctl restart sshd

# Test connection before closing session!
```

### 10.2 Setup Automatic Security Updates

```bash
# Already done in step 9.3, but verify:
sudo systemctl status unattended-upgrades
```

### 10.3 Regular Backups

```bash
# Create backup script
sudo nano /usr/local/bin/backup-healthcare.sh
```

Add:

```bash
#!/bin/bash
BACKUP_DIR="/backups/healthcare"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker exec latest-postgres pg_dump -U postgres userdb > $BACKUP_DIR/db_$DATE.sql

# Backup .env.production
cp /opt/healthcare-backend/.env.production $BACKUP_DIR/env_$DATE.production

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -delete
```

```bash
# Make executable
sudo chmod +x /usr/local/bin/backup-healthcare.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-healthcare.sh
```

---

## ✅ Verification Checklist

- [ ] Server accessible via SSH
- [ ] Non-root user created with sudo access
- [ ] Firewall (UFW) configured and enabled
- [ ] Docker installed and running
- [ ] Docker Compose installed
- [ ] Nginx installed and configured
- [ ] SSL certificate obtained (Let's Encrypt)
- [ ] Cloudflare DNS configured
- [ ] Cloudflare SSL/TLS set to Full (strict)
- [ ] Deployment directory created
- [ ] GitHub Secrets configured
- [ ] Test deployment successful
- [ ] API accessible via https://api.ishswami.in/health
- [ ] Log rotation configured
- [ ] Backups configured

---

## 🐛 Troubleshooting

### Issue: Can't connect via SSH

**Solution:**
- Check firewall: `sudo ufw status`
- Verify SSH is running: `sudo systemctl status ssh`
- Check if port 22 is open: `sudo netstat -tulpn | grep 22`

### Issue: Nginx 502 Bad Gateway

**Solution:**
- Check if Docker containers are running: `docker ps`
- Check application logs: `docker compose logs api`
- Verify port 8088 is accessible: `curl http://localhost:8088/health`
- Check Nginx error logs: `sudo tail -f /var/log/nginx/api.ishswami.in.error.log`

### Issue: SSL Certificate Not Working

**Solution:**
- Verify DNS is pointing correctly: `dig api.ishswami.in`
- Check certificate: `sudo certbot certificates`
- Renew certificate: `sudo certbot renew`

### Issue: Docker Containers Won't Start

**Solution:**
- Check logs: `docker compose logs`
- Verify .env.production exists: `ls -la /opt/healthcare-backend/.env.production`
- Check disk space: `df -h`
- Check Docker: `sudo systemctl status docker`

---

## 📞 Quick Commands Reference

```bash
# Check system resources
htop
df -h
free -h

# Docker commands
docker ps
docker compose -f devops/docker/docker-compose.prod.yml logs -f
docker compose -f devops/docker/docker-compose.prod.yml restart

# Nginx commands
sudo nginx -t
sudo systemctl reload nginx
sudo tail -f /var/log/nginx/api.ishswami.in.access.log

# SSL certificate
sudo certbot certificates
sudo certbot renew

# Firewall
sudo ufw status
sudo ufw allow 8088/tcp
```

---

## 🎉 Next Steps

1. **Push to main branch** - Your CI/CD will automatically deploy!
2. **Monitor deployment** - Check GitHub Actions tab
3. **Verify deployment** - Visit https://api.ishswami.in/health
4. **Setup monitoring** - Consider adding UptimeRobot or similar
5. **Regular maintenance** - Keep system updated

---

**Your server is now ready for production deployment! 🚀**

