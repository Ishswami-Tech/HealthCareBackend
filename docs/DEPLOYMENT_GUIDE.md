# 🚀 Complete Deployment Guide - Docker CI/CD

Complete guide for setting up CI/CD with Docker and deploying to your production
server using Cloudflare.

---

## ⚡ Quick Start (15 Minutes)

### 1. Server Setup (5 minutes)

```bash
# SSH into your server
ssh user@your-server-ip

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
sudo apt install docker-compose-plugin -y
sudo usermod -aG docker $USER

# Install Yarn (if not already installed)
npm install -g yarn@1.22.22

# Create deployment directory
sudo mkdir -p /opt/healthcare-backend
sudo chown -R $USER:$USER /opt/healthcare-backend
```

### 2. GitHub Secrets (2 minutes)

Go to: **GitHub Repo → Settings → Secrets and variables → Actions**

Add these secrets:

| Secret Name          | Value                      | Example                                  |
| -------------------- | -------------------------- | ---------------------------------------- |
| `SSH_PRIVATE_KEY`    | Your SSH private key       | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SERVER_HOST`        | Server IP or domain        | `31.220.79.219` or `api.yourdomain.com`  |
| `SERVER_USER`        | SSH username               | `deploy` or `ubuntu`                     |
| `SERVER_DEPLOY_PATH` | Deployment path (optional) | `/opt/healthcare-backend`                |

**Generate SSH Key:**

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions_deploy -N ""
cat ~/.ssh/github_actions_deploy  # Copy this to GitHub secret
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@your-server-ip
```

### 3. Server Configuration (5 minutes)

```bash
# On your server
cd /opt/healthcare-backend

# Create .env.production file (see GitHub Secrets section below for all variables)
nano .env.production
```

### 4. Cloudflare DNS (2 minutes)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your domain
3. **DNS → Records → Add record**

| A | api | Your Server IP | ✅ Proxied | | A | @ | Your Server IP | ✅ Proxied
| | A | backend-service-v1-video | Your Server IP | ❌ DNS Only (for Video/TURN)
|

4. **SSL/TLS → Overview → Full (strict)**

### 5. Test Deployment

```bash
# Push to main branch
git add .
git commit -m "Initial deployment setup"
git push origin main

# Check GitHub Actions
# Go to: GitHub Repo → Actions tab
```

### 6. Verify Deployment

```bash
# SSH into server
ssh user@your-server-ip

# Check containers
docker ps

# Check logs
cd /opt/healthcare-backend
docker compose -f devops/docker/docker-compose.prod.yml logs -f

# Test API
curl https://api.yourdomain.com/health
```

---

## 📋 Prerequisites

Before starting, ensure you have:

1. **GitHub Repository** with your code
2. **Production Server** with:
   - Docker installed (v20.10+)
   - Docker Compose installed (v2.0+)
   - SSH access enabled
   - Minimum 6 vCPU, 12GB RAM (recommended: 8 vCPU, 24GB RAM)
3. **Cloudflare Account** for domain management
4. **Domain Name** configured in Cloudflare

---

## 🔄 CI/CD Pipeline Overview

This repository uses **GitHub Actions** for CI/CD with **Docker-only**
deployment. The pipeline automatically builds, tests, and deploys your
application to a production server when code is pushed to the `main` branch.

### Workflow Overview

**On Every Push/Pull Request:**

1. **Lint & Format Check** ✅
   - Runs ESLint
   - Checks code formatting with Prettier

2. **Security Scan** 🔒
   - Trivy vulnerability scanner
   - Dependency audit

3. **Build Application** 🏗️
   - TypeScript compilation
   - Prisma client generation
   - Build artifacts created

4. **Docker Build & Push** 🐳
   - Builds Docker image
   - Pushes to GitHub Container Registry (GHCR)
   - Tags: `latest`, `main-<sha>`, branch names

**On Push to `main` Branch Only:**

5. **Deploy to Production** 🚀
   - SSH into production server
   - Creates `.env.production` from GitHub Secrets
   - Pulls latest Docker image
   - Stops existing containers
   - Starts new containers with updated image
   - Verifies health endpoint

### Key Files

| File                                    | Purpose                                 |
| --------------------------------------- | --------------------------------------- |
| `.github/workflows/ci.yml`              | Main CI/CD workflow definition          |
| `devops/scripts/deploy.sh`              | Server-side deployment script           |
| `devops/docker/docker-compose.prod.yml` | Production Docker Compose configuration |
| `devops/docker/Dockerfile`              | Production Docker image definition      |

### Docker Images

- **Registry**: GitHub Container Registry (GHCR)
- **Format**: `ghcr.io/<username>/<repo>/healthcare-api`
- **Tags**:
  - `latest` (main branch)
  - `main-<commit-sha>` (specific commit)
  - Branch names (for PRs)

### Deployment Process

```
Push to main → CI Tests → Build Image → Push to GHCR → Deploy to Server
```

**Deployment Steps (on server):**

1. SSH connection established
2. `.env.production` created from GitHub Secrets
3. Deployment script execution:
   - Login to GHCR
   - Pull latest image
   - Stop existing containers
   - Start new containers
   - Health check verification

**Health Check:**

The deployment verifies the API is healthy by:

- Checking `/health` endpoint
- Retrying up to 30 times (5 second intervals)
- Failing deployment if health check fails

---

## 🔧 Step-by-Step Setup

### Step 1: Server Setup

#### 1.1 Install Docker on Your Server

SSH into your server and run:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Install Yarn (if not already installed)
npm install -g yarn@1.22.22

# Add your user to docker group (replace $USER with your username)
sudo usermod -aG docker $USER

# Log out and log back in for group changes to take effect
```

#### 1.2 Verify Docker Installation

```bash
docker --version
docker compose version
```

#### 1.3 Create Deployment Directory

```bash
# Create deployment directory
sudo mkdir -p /opt/healthcare-backend
sudo chown -R $USER:$USER /opt/healthcare-backend
cd /opt/healthcare-backend
```

---

### Step 2: Configure GitHub Secrets & Variables

Go to your GitHub repository → **Settings** → **Secrets and variables** →
**Actions**

**⚠️ IMPORTANT:** This guide includes a complete reference for all secrets and
variables. See
[Complete GitHub Secrets Reference](#complete-github-secrets-reference) below
for the full list.

#### 2.1 Server Access Secrets (Required First)

| Secret Name          | Value                     | Notes                                             |
| -------------------- | ------------------------- | ------------------------------------------------- |
| `SSH_PRIVATE_KEY`    | Your SSH private key      | From `cat ~/.ssh/github_actions_deploy` on server |
| `SERVER_HOST`        | `31.220.79.219`           | Your server IP                                    |
| `SERVER_USER`        | `deploy`                  | SSH username                                      |
| `SERVER_DEPLOY_PATH` | `/opt/healthcare-backend` | Deployment directory                              |

**How to Generate SSH Key Pair:**

```bash
# On your local machine or server
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy -N ""

# Copy public key to server
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@your-server-ip

# Or manually add to server:
cat ~/.ssh/github_actions_deploy.pub | ssh user@your-server-ip "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# Copy private key content for GitHub secret
cat ~/.ssh/github_actions_deploy
# Copy the entire output (including BEGIN and END lines) to GitHub secret SSH_PRIVATE_KEY
```

#### 2.2 Environment Variables (Add All Below)

**Application Configuration:**

| Secret Name    | Value                                    |
| -------------- | ---------------------------------------- |
| `NODE_ENV`     | `production`                             |
| `IS_DEV`       | `false`                                  |
| `PORT`         | `8088`                                   |
| `API_PREFIX`   | `/api/v1`                                |
| `HOST`         | `backend-service-v1.ishswami.in`         |
| `BIND_ADDRESS` | `0.0.0.0`                                |
| `BASE_URL`     | `https://backend-service-v1.ishswami.in` |
| `API_URL`      | `https://backend-service-v1.ishswami.in` |
| `FRONTEND_URL` | `https://www.viddhakarma.com`            |

**Database Configuration:**

| Secret Name                                 | Value                                                               |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                              | `postgresql://postgres:postgres@postgres:5432/userdb?schema=public` |
| `DIRECT_URL`                                | `postgresql://postgres:postgres@postgres:5432/userdb?schema=public` |
| `DATABASE_SQL_INJECTION_PREVENTION_ENABLED` | `true`                                                              |
| `DATABASE_ROW_LEVEL_SECURITY_ENABLED`       | `true`                                                              |
| `DATABASE_DATA_MASKING_ENABLED`             | `true`                                                              |
| `DATABASE_RATE_LIMITING_ENABLED`            | `true`                                                              |
| `DATABASE_READ_REPLICAS_ENABLED`            | `false`                                                             |
| `DATABASE_READ_REPLICAS_STRATEGY`           | `round-robin`                                                       |
| `DATABASE_READ_REPLICAS_URLS`               | (empty or your read replica URLs)                                   |

**Cache Configuration:**

| Secret Name            | Value                           |
| ---------------------- | ------------------------------- |
| `CACHE_ENABLED`        | `true`                          |
| `CACHE_PROVIDER`       | `dragonfly`                     |
| `DRAGONFLY_ENABLED`    | `true`                          |
| `DRAGONFLY_HOST`       | `dragonfly`                     |
| `DRAGONFLY_PORT`       | `6379`                          |
| `DRAGONFLY_KEY_PREFIX` | `healthcare:`                   |
| `DRAGONFLY_PASSWORD`   | (empty or your password if set) |

**Redis Configuration (Optional - Only if CACHE_PROVIDER=redis):**

Since `CACHE_PROVIDER=dragonfly`, Redis is not needed. Set
`REDIS_ENABLED=false`.

| Secret Name      | Value                    |
| ---------------- | ------------------------ |
| `REDIS_HOST`     | `redis`                  |
| `REDIS_PORT`     | `6379`                   |
| `REDIS_TTL`      | `7200`                   |
| `REDIS_PREFIX`   | `healthcare:`            |
| `REDIS_ENABLED`  | `false`                  |
| `REDIS_PASSWORD` | (empty or your password) |

**JWT Configuration (REQUIRED - Use Secure Secrets!):**

| Secret Name              | Value                                     |
| ------------------------ | ----------------------------------------- |
| `JWT_SECRET`             | `YOUR_SECURE_JWT_SECRET_MIN_32_CHARS`     |
| `JWT_EXPIRATION`         | `24h`                                     |
| `JWT_ACCESS_EXPIRES_IN`  | `24h`                                     |
| `JWT_REFRESH_EXPIRES_IN` | `7d`                                      |
| `JWT_REFRESH_SECRET`     | `YOUR_SECURE_REFRESH_SECRET_MIN_32_CHARS` |

**Prisma Configuration:**

| Secret Name          | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| `PRISMA_SCHEMA_PATH` | `/app/src/libs/infrastructure/database/prisma/schema.prisma` |

**Logging Configuration:**

| Secret Name         | Value  |
| ------------------- | ------ |
| `LOG_LEVEL`         | `info` |
| `ENABLE_AUDIT_LOGS` | `true` |

**Rate Limiting Configuration:**

| Secret Name                    | Value  |
| ------------------------------ | ------ |
| `RATE_LIMIT_ENABLED`           | `true` |
| `RATE_LIMIT_TTL`               | `60`   |
| `RATE_LIMIT_MAX`               | `100`  |
| `API_RATE_LIMIT`               | `500`  |
| `AUTH_RATE_LIMIT`              | `30`   |
| `HEAVY_RATE_LIMIT`             | `50`   |
| `USER_RATE_LIMIT`              | `200`  |
| `HEALTH_RATE_LIMIT`            | `1000` |
| `MAX_AUTH_ATTEMPTS`            | `10`   |
| `AUTH_ATTEMPT_WINDOW`          | `3600` |
| `MAX_CONCURRENT_SESSIONS`      | `20`   |
| `SESSION_INACTIVITY_THRESHOLD` | `1800` |

**Security Configuration:**

| Secret Name                     | Value   |
| ------------------------------- | ------- |
| `SECURITY_RATE_LIMIT`           | `true`  |
| `SECURITY_RATE_LIMIT_MAX`       | `500`   |
| `SECURITY_RATE_LIMIT_WINDOW_MS` | `30000` |
| `TRUST_PROXY`                   | `1`     |

**Email Configuration (ZeptoMail):**

| Secret Name                 | Value                            |
| --------------------------- | -------------------------------- |
| `EMAIL_PROVIDER`            | `zeptomail`                      |
| `ZEPTOMAIL_ENABLED`         | `true`                           |
| `ZEPTOMAIL_SEND_MAIL_TOKEN` | `YOUR_ZEPTOMAIL_SEND_MAIL_TOKEN` |
| `ZEPTOMAIL_FROM_EMAIL`      | `noreply@viddhakarma.com`        |
| `ZEPTOMAIL_FROM_NAME`       | `Healthcare App`                 |
| `ZEPTOMAIL_BOUNCE_ADDRESS`  | `bounces@viddhakarma.com`        |
| `ZEPTOMAIL_API_BASE_URL`    | `https://api.zeptomail.com/v1.1` |

**CORS Configuration:**

| Secret Name        | Value                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `CORS_ORIGIN`      | `https://www.viddhakarma.com,https://viddhakarma.com,https://backend-service-v1.ishswami.in,https://ishswami.in,https://www.ishswami.in` |
| `CORS_CREDENTIALS` | `true`                                                                                                                                   |
| `CORS_METHODS`     | `GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS`                                                                                                 |

**Service URLs:**

| Secret Name         | Value              |
| ------------------- | ------------------ |
| `SWAGGER_URL`       | `/docs`            |
| `BULL_BOARD_URL`    | `/queue-dashboard` |
| `SOCKET_URL`        | `/socket.io`       |
| `PRISMA_STUDIO_URL` | `/prisma`          |
| `PGADMIN_URL`       | `/pgadmin`         |

**WhatsApp Configuration (Optional):**

| Secret Name                         | Value                               |
| ----------------------------------- | ----------------------------------- |
| `WHATSAPP_ENABLED`                  | `false`                             |
| `WHATSAPP_API_URL`                  | `https://graph.facebook.com/v17.0`  |
| `WHATSAPP_API_KEY`                  | (empty or your API key)             |
| `WHATSAPP_PHONE_NUMBER_ID`          | (empty or your phone number ID)     |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`      | (empty or your business account ID) |
| `WHATSAPP_OTP_TEMPLATE_ID`          | `otp_verification`                  |
| `WHATSAPP_APPOINTMENT_TEMPLATE_ID`  | `appointment_reminder`              |
| `WHATSAPP_PRESCRIPTION_TEMPLATE_ID` | `prescription_notification`         |

**Video Configuration (OpenVidu):**

| Secret Name                 | Value                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| `VIDEO_ENABLED`             | `true`                                                              |
| `VIDEO_PROVIDER`            | `openvidu`                                                          |
| `OPENVIDU_URL`              | `https://video.ishswami.in`                                         |
| `OPENVIDU_SECRET`           | `YOUR_OPENVIDU_SECRET`                                              |
| `OPENVIDU_DOMAIN`           | `video.ishswami.in`                                                 |
| `OPENVIDU_WEBHOOK_ENABLED`  | `false`                                                             |
| `OPENVIDU_WEBHOOK_ENDPOINT` | `https://backend-service-v1.ishswami.in/api/v1/webhooks/openvidu`   |
| `OPENVIDU_WEBHOOK_EVENTS`   | `sessionCreated,sessionDestroyed,participantJoined,participantLeft` |

**Google OAuth Configuration:**

| Secret Name            | Value                                                   |
| ---------------------- | ------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | `YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `YOUR_GOOGLE_CLIENT_SECRET_HERE`                        |
| `GOOGLE_REDIRECT_URI`  | `https://your-api-domain.com/auth/google/callback`      |

**Session Configuration (REQUIRED - Use Secure Secrets!):**

| Secret Name              | Value                                     |
| ------------------------ | ----------------------------------------- |
| `SESSION_SECRET`         | `YOUR_SECURE_SESSION_SECRET_MIN_32_CHARS` |
| `SESSION_TIMEOUT`        | `86400`                                   |
| `SESSION_SECURE_COOKIES` | `true`                                    |
| `SESSION_SAME_SITE`      | `strict`                                  |
| `COOKIE_SECRET`          | `YOUR_SECURE_COOKIE_SECRET_MIN_32_CHARS`  |

**Firebase Configuration (REQUIRED for Push Notifications):**

| Secret Name             | Value                                 |
| ----------------------- | ------------------------------------- |
| `FIREBASE_PROJECT_ID`   | `YOUR_FIREBASE_PROJECT_ID`            |
| `FIREBASE_PRIVATE_KEY`  | `YOUR_FIREBASE_PRIVATE_KEY`           |
| `FIREBASE_CLIENT_EMAIL` | `YOUR_FIREBASE_CLIENT_EMAIL`          |
| `FIREBASE_DATABASE_URL` | (empty or your Firebase database URL) |
| `FIREBASE_VAPID_KEY`    | (empty or your Firebase VAPID key)    |

**Social Auth Configuration (Optional):**

| Secret Name             | Value                                                           |
| ----------------------- | --------------------------------------------------------------- |
| `FACEBOOK_APP_ID`       | (empty or your Facebook app ID)                                 |
| `FACEBOOK_APP_SECRET`   | (empty or your Facebook app secret)                             |
| `FACEBOOK_REDIRECT_URI` | `https://backend-service-v1.ishswami.in/auth/facebook/callback` |
| `APPLE_CLIENT_ID`       | (empty or your Apple client ID)                                 |
| `APPLE_CLIENT_SECRET`   | (empty or your Apple client secret)                             |
| `APPLE_REDIRECT_URI`    | `https://backend-service-v1.ishswami.in/auth/apple/callback`    |

**Contabo S3 Storage Configuration:**

| Secret Name                | Value                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ENABLED`               | `true`                                                                                                                                                                                                         |
| `S3_PROVIDER`              | `contabo`                                                                                                                                                                                                      |
| `S3_ENDPOINT`              | `https://eu2.contabostorage.com`                                                                                                                                                                               |
| `S3_REGION`                | `eu-central-1`                                                                                                                                                                                                 |
| `S3_BUCKET`                | `your-bucket-name`                                                                                                                                                                                             |
| `S3_ACCESS_KEY_ID`         | `your-contabo-access-key-id`                                                                                                                                                                                   |
| `S3_SECRET_ACCESS_KEY`     | `your-contabo-secret-access-key`                                                                                                                                                                               |
| `S3_FORCE_PATH_STYLE`      | `true`                                                                                                                                                                                                         |
| `S3_PUBLIC_URL_EXPIRATION` | `3600`                                                                                                                                                                                                         |
| `CDN_URL`                  | (empty or your CDN URL)                                                                                                                                                                                        |
|                            | **Note**: For Contabo provider, CDN URL is automatically generated from `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_BUCKET`. Only set this if using a different CDN provider (e.g., Cloudflare, AWS CloudFront) |

**Docker Configuration:**

| Secret Name      | Value         |
| ---------------- | ------------- |
| `DOCKER_ENV`     | `true`        |
| `DOCKER_NETWORK` | `app-network` |

**⚠️ Important Notes:**

1. **Replace Placeholders**: Replace all `YOUR_*` placeholders with your actual
   production values
2. **Secure Secrets**: Make sure `JWT_SECRET`, `SESSION_SECRET`, and
   `COOKIE_SECRET` are strong (minimum 32 characters)
3. **Empty Values**: For optional fields, you can either:
   - Leave them empty in GitHub Secrets (they won't be added to .env.production)
   - Or add them with empty value `""`
4. **Multi-line Values**: For values like `FIREBASE_PRIVATE_KEY` (which may be
   multi-line), paste the entire content including newlines

**Total Secrets to Add**: ~80+ secrets

---

### Step 3: Prepare Server for Deployment

#### 3.1 Clone Repository (Optional - if you want git on server)

```bash
cd /opt/healthcare-backend
git clone https://github.com/your-username/your-repo.git .
# Or use SSH: git clone git@github.com:your-username/your-repo.git .
```

#### 3.2 Create Environment File

**Note**: The `.env.production` file is automatically created on the server
during deployment from GitHub Secrets. However, you can create it manually if
needed:

```bash
cd /opt/healthcare-backend
nano .env.production
```

See `docs/PRODUCTION_ENV_TEMPLATE.txt` for the complete template.

#### 3.3 Set Up Logs Directory

```bash
mkdir -p /opt/healthcare-backend/devops/docker/logs
chmod 755 /opt/healthcare-backend/devops/docker/logs
```

---

### Step 4: Configure Cloudflare

#### 4.1 Add DNS Records in Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your domain
3. Go to **DNS** → **Records**
4. Add the following records:

| Type | Name                     | Content        | Proxy       | TTL                   |
| ---- | ------------------------ | -------------- | ----------- | --------------------- |
| A    | api                      | Your Server IP | ✅ Proxied  | Auto                  |
| A    | @                        | Your Server IP | ✅ Proxied  | Auto                  |
| A    | www                      | Your Server IP | ✅ Proxied  | Auto                  |
| A    | backend-service-v1-video | Your Server IP | ❌ DNS Only | Auto (for Video/TURN) |

**Note**: Replace "Your Server IP" with your actual server IP address (e.g.,
`31.220.79.219`).

#### 4.2 Configure SSL/TLS

1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode to **Full (strict)**
3. Go to **SSL/TLS** → **Edge Certificates**
4. Enable "Always Use HTTPS"
5. Set minimum TLS version to TLS 1.2

#### 4.3 Page Rules (Optional)

Create these page rules:

1. **URL pattern**: `*api.ishswami.in/*`
   - Settings: SSL = Full Strict, Cache Level = Bypass

2. **URL pattern**: `*api.ishswami.in/socket.io/*`
   - Settings: SSL = Full Strict, Disable Security (to allow WebSockets)

3. **URL pattern**: `*video.ishswami.in/*`
   - Settings: SSL = Full Strict, Cache Level = Bypass (for OpenVidu video
     streaming)

---

### Step 5: Configure Nginx (Reverse Proxy)

#### 5.1 Install Nginx and Certbot

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

#### 5.2 Configure API Server (api.ishswami.in)

```bash
# Copy configuration file to server
sudo cp devops/nginx/sites-available/api.ishswami.in /etc/nginx/sites-available/api.ishswami.in

# Enable the site
sudo ln -s /etc/nginx/sites-available/api.ishswami.in /etc/nginx/sites-enabled/api.ishswami.in

# Get SSL certificate
sudo certbot certonly --nginx -d api.ishswami.in

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

#### 5.3 Configure Video & TURN Server (backend-service-v1-video.ishswami.in)

**Overview:**

The Video (OpenVidu) and TURN (Coturn) services are unified under
`backend-service-v1-video.ishswami.in`. SSL is terminated by Nginx for HTTPS/WSS
(port 443), while Coturn handles its own TLS for TURNS (port 5349).

**Setup Steps:**

1. **Add DNS Record in Cloudflare** (already done in Step 4.1 - Ensure **DNS
   Only**)

2. **Get SSL Certificate:**

   ```bash
   sudo certbot certonly --nginx -d backend-service-v1-video.ishswami.in
   ```

3. **Copy Configuration File:**

   ```bash
   sudo cp devops/nginx/sites-available/backend-service-v1-video.ishswami.in /etc/nginx/sites-available/backend-service-v1-video.ishswami.in
   ```

4. **Enable the Site:**

   ```bash
   sudo ln -s /etc/nginx/sites-available/backend-service-v1-video.ishswami.in /etc/nginx/sites-enabled/backend-service-v1-video.ishswami.in
   ```

5. **Test and Reload Nginx:**

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

6. **Verify Services:**
   ```bash
   # Check if containers are running
   docker ps | grep -E "openvidu|coturn"
   ```

**Detailed Security & Setup:** For advanced firewall, rate limiting, and
troubleshooting, see the [Master Coturn Guide](MASTER_COTURN_GUIDE.md).

**Architecture:**

```
Internet → Cloudflare → Nginx (backend-service-v1-video.ishswami.in:443) → OpenVidu Container (127.0.0.1:4443)
Internet → (Direct) → Coturn Container (Port 3478/5349)
```

**Troubleshooting:**

```bash
# Check Nginx logs
sudo tail -f /var/log/nginx/backend-service-v1-video.ishswami.in.error.log
sudo tail -f /var/log/nginx/backend-service-v1-video.ishswami.in.access.log

# Check Coturn logs
docker logs coturn
```

---

### Step 6: First Manual Deployment

Before automating, test deployment manually:

#### 6.1 Pull Docker Image

```bash
cd /opt/healthcare-backend

# Login to GitHub Container Registry
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Pull the image (replace with your actual image)
docker pull ghcr.io/your-username/your-repo/healthcare-api:latest
```

#### 6.2 Start Services

```bash
cd /opt/healthcare-backend

# Start all services
docker compose -f devops/docker/docker-compose.prod.yml up -d

# Check logs
docker compose -f devops/docker/docker-compose.prod.yml logs -f

# Check status
docker compose -f devops/docker/docker-compose.prod.yml ps
```

#### 6.3 Verify Health

```bash
# Check API health
curl http://localhost:8088/health

# Check from outside (if firewall allows)
curl http://your-server-ip:8088/health

# Check via domain
curl https://backend-service-v1.ishswami.in/health
```

---

### Step 7: Enable Automated Deployment

#### 7.1 Verify GitHub Actions Workflow

The workflow file `.github/workflows/ci.yml` is already configured. It will:

1. ✅ Run linting and tests
2. ✅ Build Docker image
3. ✅ Push to GitHub Container Registry
4. ✅ Deploy to server (only on `main` branch)

#### 7.2 Test Deployment

1. Make a small change to your code
2. Commit and push to `main` branch:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```
3. Go to **Actions** tab in GitHub
4. Watch the workflow run
5. Check deployment logs

#### 7.3 Verify Deployment

```bash
# SSH into server
ssh user@your-server-ip

# Check running containers
docker ps

# Check logs
cd /opt/healthcare-backend
docker compose -f devops/docker/docker-compose.prod.yml logs --tail=50 api

# Test API
curl https://backend-service-v1.ishswami.in/health
```

---

## 📊 Monitoring & Maintenance

### View Logs

```bash
# All services
docker compose -f devops/docker/docker-compose.prod.yml logs -f

# Specific service
docker compose -f devops/docker/docker-compose.prod.yml logs -f api

# Last 100 lines
docker compose -f devops/docker/docker-compose.prod.yml logs --tail=100
```

### Restart Services

```bash
cd /opt/healthcare-backend

# Restart all
docker compose -f devops/docker/docker-compose.prod.yml restart

# Restart specific service
docker compose -f devops/docker/docker-compose.prod.yml restart api
```

### Update Services

```bash
cd /opt/healthcare-backend

# Pull latest images
docker compose -f devops/docker/docker-compose.prod.yml pull

# Recreate containers
docker compose -f devops/docker/docker-compose.prod.yml up -d
```

### Backup Database

```bash
# Create backup
docker exec latest-postgres pg_dump -U postgres userdb > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
cat backup_20240101_120000.sql | docker exec -i latest-postgres psql -U postgres userdb
```

---

## 🔒 Security Best Practices

### Firewall Configuration

```bash
# Install UFW
sudo apt install ufw -y

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow API port (if exposing directly)
sudo ufw allow 8088/tcp

# Enable firewall
sudo ufw enable
sudo ufw status
```

### Secure Environment File

```bash
# Set proper permissions
chmod 600 /opt/healthcare-backend/.env.production

# Don't commit secrets to git
echo ".env.production" >> .gitignore
```

### Regular Updates

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Docker images
docker compose -f devops/docker/docker-compose.prod.yml pull
```

---

## 🔧 Manual Deployment

If you need to deploy manually:

```bash
# SSH into server
ssh user@your-server-ip

# Navigate to deployment directory
cd /opt/healthcare-backend

# Login to GHCR
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Pull latest image
docker pull ghcr.io/your-username/your-repo/healthcare-api:latest

# Update services
docker compose -f devops/docker/docker-compose.prod.yml pull
docker compose -f devops/docker/docker-compose.prod.yml up -d

# Check status
docker compose -f devops/docker/docker-compose.prod.yml ps
```

---

## 🔄 Rollback Procedure

If deployment fails or you need to rollback:

```bash
# SSH into server
ssh user@your-server-ip
cd /opt/healthcare-backend

# Pull previous image
docker pull ghcr.io/your-username/your-repo/healthcare-api:main-<previous-sha>

# Tag as latest
docker tag ghcr.io/your-username/your-repo/healthcare-api:main-<previous-sha> \
  ghcr.io/your-username/your-repo/healthcare-api:latest

# Restart services
docker compose -f devops/docker/docker-compose.prod.yml up -d
```

---

## 🐛 Troubleshooting

### Deployment Fails

1. **Check GitHub Actions logs**
   - Go to: Repo → Actions → Latest workflow run

2. **Check server logs**

   ```bash
   ssh user@server
   cd /opt/healthcare-backend
   docker compose -f devops/docker/docker-compose.prod.yml logs
   ```

3. **Verify secrets**
   - Check all GitHub secrets are set correctly
   - Test SSH connection manually

### SSH Connection Failed

**Solution**:

- Verify SSH key is correctly added to GitHub secrets
- Test SSH connection manually: `ssh -i ~/.ssh/your_key user@server`
- Check server SSH configuration allows key authentication

### Docker Image Pull Fails

**Solution**:

- Verify GitHub token has `packages:read` permission
- Check image name matches in workflow and server
- Login manually:
  `echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin`

**Manual Login:**

```bash
# Login manually
echo "GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin

# Check image exists
docker pull ghcr.io/username/repo/healthcare-api:latest
```

### Services Won't Start

**Solution**:

- Check logs: `docker compose logs`
- Verify environment variables are set correctly
- Check port conflicts: `sudo netstat -tlnp | grep 8088`
- Verify database connection string

### API Not Accessible from Outside

**Solution**:

- Check firewall rules
- Verify Cloudflare DNS points to correct IP
- Check Nginx/Reverse proxy configuration
- Verify port 8088 is exposed in docker-compose

### Health Check Fails

**Solution**:

- Check API logs: `docker compose logs api`
- Verify health endpoint exists: `curl http://localhost:8088/health`
- Check service dependencies (database, cache)
- Increase health check timeout in workflow

```bash
# Check API logs
docker compose logs api

# Test health endpoint
curl http://localhost:8088/health

# Check service dependencies
docker compose ps
```

### OpenVidu Issues

```bash
# Check OpenVidu container
docker ps | grep openvidu

# Check OpenVidu logs
docker logs latest-openvidu-server

# Test OpenVidu directly
curl http://127.0.0.1:4443

# Check Nginx logs
sudo tail -f /var/log/nginx/video.ishswami.in.error.log
```

---

## 📝 Quick Reference Commands

```bash
# View running containers
docker ps

# View all containers
docker ps -a

# View logs
docker compose -f devops/docker/docker-compose.prod.yml logs -f

# Stop services
docker compose -f devops/docker/docker-compose.prod.yml down

# Start services
docker compose -f devops/docker/docker-compose.prod.yml up -d

# Restart services
docker compose -f devops/docker/docker-compose.prod.yml restart

# View resource usage
docker stats

# Clean up unused images
docker image prune -a

# View disk usage
docker system df
```

---

## ✅ Deployment Checklist

- [ ] Docker installed on server (`docker --version`)
- [ ] Docker Compose installed (`docker compose version`)
- [ ] SSH key pair generated and added to GitHub secrets
- [ ] Server host, user, and path added to GitHub secrets
- [ ] All environment variables added to GitHub secrets (~80+ secrets)
- [ ] DNS records added in Cloudflare (api, @, www, video)
- [ ] SSL/TLS configured in Cloudflare (Full strict)
- [ ] Nginx installed and configured
- [ ] SSL certificates obtained for api.ishswami.in and video.ishswami.in
- [ ] Firewall configured
- [ ] First manual deployment successful
- [ ] GitHub Actions workflow tested
- [ ] Monitoring set up

---

## ✅ Success Indicators

After successful deployment:

- ✅ All CI checks pass (green checkmarks)
- ✅ Docker image pushed to GHCR
- ✅ Deployment job completed
- ✅ Services running on server (`docker ps`)
- ✅ Health endpoint responds
  (`curl https://backend-service-v1.ishswami.in/health`)
- ✅ OpenVidu accessible (`curl https://video.ishswami.in`)

---

## 🎉 Success!

Your CI/CD pipeline is now set up! Every push to the `main` branch will:

1. ✅ Run tests and linting
2. ✅ Build Docker image
3. ✅ Push to GitHub Container Registry
4. ✅ Deploy to your production server
5. ✅ Verify deployment health

**Next Steps**:

- Set up monitoring (e.g., UptimeRobot, Pingdom)
- Configure log aggregation
- Set up database backups
- Configure alerts for failures

---

## 🔐 Complete GitHub Secrets Reference

### 🏗️ Architecture Overview

**Single Backend API, Multiple Clinic Frontends**

- **ONE backend API** (`backend-service-v1.ishswami.in`) serves ALL clinics
- **Only clinic-related data and configurations differ** between clinics
- All clinics share the same backend infrastructure (database, cache, services)
- Each clinic can have separate frontend URL and clinic-specific credentials
- Row-level security ensures automatic data isolation by clinic

This section includes both global secrets (shared by all clinics) and
clinic-specific secrets (unique per clinic).

---

### 🔑 Secrets vs Variables - Classification Guide

**🔐 Secrets (Encrypted - Sensitive Data)** - Should ONLY be in **Secrets**:

- `JWT_SECRET`, `JWT_REFRESH_SECRET` - JWT signing secrets
- `COOKIE_SECRET`, `SESSION_SECRET` - Encryption secrets
- `DATABASE_URL`, `DIRECT_URL` - Database connection strings (contain passwords)
- `DRAGONFLY_PASSWORD` - Cache password
- `FIREBASE_PRIVATE_KEY`, `FIREBASE_VAPID_KEY` - Firebase keys
- `OPENVIDU_SECRET` - OpenVidu secret
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - S3 credentials
- `ZEPTOMAIL_SEND_MAIL_TOKEN` - Email API token
- `WHATSAPP_API_KEY` - WhatsApp API key
- `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_SECRET`, `APPLE_CLIENT_SECRET` - OAuth
  secrets
- `SSH_PRIVATE_KEY` - SSH private key for deployment
- `SERVER_HOST`, `SERVER_USER` - Server access credentials
- All clinic-specific tokens/keys (e.g., `CLINIC_*_ZEPTOMAIL_SEND_MAIL_TOKEN`)

**📝 Variables (Plain Text - Non-Sensitive Configuration)** - Should ONLY be in
**Variables**:

- All URLs (`HOST`, `API_URL`, `BASE_URL`, `FRONTEND_URL`, `CORS_ORIGIN`)
- All paths (`API_PREFIX`, `SWAGGER_URL`, `SOCKET_URL`, `SERVER_DEPLOY_PATH`)
- All IDs (`GOOGLE_CLIENT_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`)
- All configuration flags (`CACHE_ENABLED`, `VIDEO_ENABLED`, etc.)
- All rate limits, timeouts, expiration values
- All feature flags and settings
- `SESSION_TIMEOUT` - Just a number, not sensitive

---

### 📋 Complete Secrets & Variables List

#### Global Configuration

**Application Configuration:**

- `NODE_ENV` - Environment (production) → **Variable**
- `IS_DEV` - Development flag (false) → **Variable**
- `PORT` - Application port (8088) → **Variable**
- `API_PREFIX` - API prefix (/api/v1) → **Variable**
- `HOST` - Host address (backend-service-v1.ishswami.in) → **Variable**
- `BIND_ADDRESS` - Bind address (0.0.0.0) → **Variable**
- `BASE_URL` - Base URL (https://backend-service-v1.ishswami.in) → **Variable**
- `API_URL` - API URL (https://backend-service-v1.ishswami.in) → **Variable**
- `FRONTEND_URL` - Default frontend URL (https://www.viddhakarma.com) →
  **Variable**

**Database Configuration:**

- `DATABASE_URL` - Main database connection string → **Secret** ⚠️
- `DIRECT_URL` - Direct database connection string → **Secret** ⚠️
- `DATABASE_SQL_INJECTION_PREVENTION_ENABLED` - SQL injection prevention (true)
  → **Variable**
- `DATABASE_ROW_LEVEL_SECURITY_ENABLED` - Row-level security (true) →
  **Variable**
- `DATABASE_DATA_MASKING_ENABLED` - Data masking (true) → **Variable**
- `DATABASE_RATE_LIMITING_ENABLED` - Rate limiting (true) → **Variable**
- `DATABASE_READ_REPLICAS_ENABLED` - Read replicas (false) → **Variable**
- `DATABASE_READ_REPLICAS_STRATEGY` - Replica strategy (round-robin) →
  **Variable**
- `DATABASE_READ_REPLICAS_URLS` - Replica URLs (comma-separated) → **Variable**

**Cache Configuration:**

- `CACHE_ENABLED` - Cache enabled (true) → **Variable**
- `CACHE_PROVIDER` - Cache provider (dragonfly) → **Variable**
- `DRAGONFLY_ENABLED` - Dragonfly enabled (true) → **Variable**
- `DRAGONFLY_HOST` - Dragonfly host (dragonfly) → **Variable**
- `DRAGONFLY_PORT` - Dragonfly port (6379) → **Variable**
- `DRAGONFLY_KEY_PREFIX` - Key prefix (healthcare:) → **Variable**
- `DRAGONFLY_PASSWORD` - Dragonfly password (optional) → **Secret** ⚠️

**JWT & Session Configuration:**

- `JWT_SECRET` - JWT secret key (min 32 chars) → **Secret** ⚠️
- `JWT_EXPIRATION` - JWT expiration (24h) → **Variable**
- `JWT_ACCESS_EXPIRES_IN` - Access token expiration (24h) → **Variable**
- `JWT_REFRESH_EXPIRES_IN` - Refresh token expiration (7d) → **Variable**
- `JWT_REFRESH_SECRET` - JWT refresh secret (min 32 chars) → **Secret** ⚠️
- `SESSION_SECRET` - Session secret (min 32 chars) → **Secret** ⚠️
- `SESSION_TIMEOUT` - Session timeout (86400) → **Variable**
- `SESSION_SECURE_COOKIES` - Secure cookies (true) → **Variable**
- `SESSION_SAME_SITE` - Same site policy (strict) → **Variable**
- `COOKIE_SECRET` - Cookie secret (min 32 chars) → **Secret** ⚠️

**CORS Configuration:**

- `CORS_ORIGIN` - Allowed origins (comma-separated, no spaces) → **Variable**
  - **IMPORTANT**: Must include ALL clinic frontend URLs
  - **Example**:
    `https://www.viddhakarma.com,https://viddhakarma.com,https://backend-service-v1.ishswami.in,https://ishswami.in,https://www.ishswami.in`
- `CORS_CREDENTIALS` - CORS credentials (true) → **Variable**
- `CORS_METHODS` - Allowed methods (GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS) →
  **Variable**

**Email Configuration (ZeptoMail):**

- `EMAIL_PROVIDER` - Email provider (zeptomail) → **Variable**
- `ZEPTOMAIL_ENABLED` - ZeptoMail enabled (true) → **Variable**
- `ZEPTOMAIL_SEND_MAIL_TOKEN` - ZeptoMail send mail token → **Secret** ⚠️
- `ZEPTOMAIL_FROM_EMAIL` - Default from email → **Variable**
- `ZEPTOMAIL_FROM_NAME` - Default from name → **Variable**
- `ZEPTOMAIL_BOUNCE_ADDRESS` - Bounce address → **Variable**
- `ZEPTOMAIL_API_BASE_URL` - API base URL (https://api.zeptomail.com/v1.1) →
  **Variable**

**WhatsApp Configuration:**

- `WHATSAPP_ENABLED` - WhatsApp enabled (false) → **Variable**
- `WHATSAPP_API_URL` - WhatsApp API URL (https://graph.facebook.com/v17.0) →
  **Variable**
- `WHATSAPP_API_KEY` - WhatsApp API key → **Secret** ⚠️
- `WHATSAPP_PHONE_NUMBER_ID` - Phone number ID → **Variable**
- `WHATSAPP_BUSINESS_ACCOUNT_ID` - Business account ID → **Variable**
- `WHATSAPP_OTP_TEMPLATE_ID` - OTP template ID → **Variable**
- `WHATSAPP_APPOINTMENT_TEMPLATE_ID` - Appointment template ID → **Variable**
- `WHATSAPP_PRESCRIPTION_TEMPLATE_ID` - Prescription template ID → **Variable**

**Video Configuration (OpenVidu):**

- `VIDEO_ENABLED` - Video enabled (true) → **Variable**
- `VIDEO_PROVIDER` - Video provider (openvidu) → **Variable**
- `OPENVIDU_URL` - OpenVidu URL (https://video.ishswami.in) → **Variable**
- `OPENVIDU_SECRET` - OpenVidu secret → **Secret** ⚠️
- `OPENVIDU_DOMAIN` - OpenVidu domain (video.ishswami.in) → **Variable**
- `OPENVIDU_WEBHOOK_ENABLED` - Webhook enabled (false) → **Variable**
- `OPENVIDU_WEBHOOK_ENDPOINT` - Webhook endpoint → **Variable**
- `OPENVIDU_WEBHOOK_EVENTS` - Webhook events (comma-separated) → **Variable**

**Firebase Configuration:**

- `FIREBASE_PROJECT_ID` - Firebase project ID → **Variable**
- `FIREBASE_PRIVATE_KEY` - Firebase private key (with newlines) → **Secret** ⚠️
- `FIREBASE_CLIENT_EMAIL` - Firebase client email → **Variable**
- `FIREBASE_DATABASE_URL` - Firebase database URL → **Variable**
- `FIREBASE_VAPID_KEY` - Firebase VAPID key → **Secret** ⚠️

**Social Auth Configuration:**

- `GOOGLE_CLIENT_ID` - Google OAuth client ID → **Variable** (public, visible in
  frontend)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret → **Secret** ⚠️
- `GOOGLE_REDIRECT_URI` - Google redirect URI → **Variable**
- `FACEBOOK_APP_ID` - Facebook app ID → **Variable**
- `FACEBOOK_APP_SECRET` - Facebook app secret → **Secret** ⚠️
- `APPLE_CLIENT_ID` - Apple client ID → **Variable**
- `APPLE_CLIENT_SECRET` - Apple client secret → **Secret** ⚠️

**S3 Storage Configuration:**

- `S3_ENABLED` - S3 enabled (true) → **Variable**
- `S3_PROVIDER` - S3 provider (contabo) → **Variable**
- `S3_ENDPOINT` - S3 endpoint (https://eu2.contabostorage.com) → **Variable**
- `S3_REGION` - S3 region (eu-central-1) → **Variable**
- `S3_BUCKET` - S3 bucket name → **Variable**
- `S3_ACCESS_KEY_ID` - S3 access key ID → **Secret** ⚠️
- `S3_SECRET_ACCESS_KEY` - S3 secret access key → **Secret** ⚠️
- `S3_FORCE_PATH_STYLE` - Force path style (true) → **Variable**
- `S3_PUBLIC_URL_EXPIRATION` - URL expiration (3600) → **Variable**
- `CDN_URL` - CDN URL (optional) → **Variable**

**Deployment Configuration (Repository Secrets):**

- `SSH_PRIVATE_KEY` - SSH private key for server access → **Secret** ⚠️
- `SERVER_HOST` - Production server host → **Secret** ⚠️
- `SERVER_USER` - Production server user → **Secret** ⚠️
- `SERVER_DEPLOY_PATH` - Deployment path (/opt/healthcare-backend) →
  **Variable**

**Service URLs (All Variables):**

- `SWAGGER_URL` - Swagger URL (/docs) → **Variable**
- `BULL_BOARD_URL` - Bull board URL (/queue-dashboard) → **Variable**
- `SOCKET_URL` - Socket URL (/socket.io) → **Variable**
- `PRISMA_STUDIO_URL` - Prisma Studio URL (/prisma) → **Variable**
- `PGADMIN_URL` - PgAdmin URL (/pgadmin) → **Variable**

**Other Configuration (All Variables):**

- `PRISMA_SCHEMA_PATH` - Prisma schema path → **Variable**
- `LOG_LEVEL` - Log level (info) → **Variable**
- `ENABLE_AUDIT_LOGS` - Audit logs enabled (true) → **Variable**
- All rate limit settings → **Variable**
- All timeout/expiration values → **Variable**
- `DOCKER_ENV` - Docker environment (true) → **Variable**
- `DOCKER_NETWORK` - Docker network (app-network) → **Variable**

---

### 🏥 Clinic-Specific Secrets

**Architecture Note:** These are clinic-specific configurations for a SINGLE
backend API. Only clinic-related data and credentials differ. All clinics share
the same backend infrastructure.

Each clinic can have separate configuration using the pattern:
`CLINIC_{SANITIZED_CLINIC_NAME}_{CONFIG_KEY}`

**Clinic Name Sanitization:**

- Spaces → Underscores (`_`)
- Special characters → Underscores (`_`)
- Converted to UPPERCASE
- Multiple underscores collapsed to single underscore
- Leading/trailing underscores removed

**Examples:**

- `"Vishwamurti Ayurvedelay"` → `VISHWAMURTI_AYURVEDELAY`
- `"Aadesh Ayurvedalay"` → `AADESH_AYURVEDALAY`

**Clinic-Specific Patterns (All Secrets):**

- `CLINIC_{NAME}_ZEPTOMAIL_SEND_MAIL_TOKEN` → **Secret** ⚠️
- `CLINIC_{NAME}_WHATSAPP_API_KEY` → **Secret** ⚠️
- `CLINIC_{NAME}_SMS_API_KEY`, `CLINIC_{NAME}_SMS_API_SECRET` → **Secret** ⚠️
- `CLINIC_{NAME}_FIREBASE_PRIVATE_KEY`, `CLINIC_{NAME}_FIREBASE_VAPID_KEY` →
  **Secret** ⚠️
- `CLINIC_{NAME}_FRONTEND_URL` → **Variable**
- `CLINIC_{NAME}_GOOGLE_CLIENT_ID` → **Variable**
- `CLINIC_{NAME}_GOOGLE_CLIENT_SECRET` → **Secret** ⚠️

**IMPORTANT:** All clinic frontend URLs must also be added to the `CORS_ORIGIN`
variable (comma-separated).

---

### ⚠️ GitHub Actions Configuration - Migration Guide

#### Current State vs Recommended State

**Items That Should Be Moved:**

1. **From Environment Secrets → Environment Variables:**
   - `GOOGLE_CLIENT_ID` - OAuth Client ID is public (visible in frontend JS)
   - `SESSION_TIMEOUT` - Just a number (`86400`), not sensitive
   - `SOCKET_URL` - Just a path (`/socket.io`), not sensitive

2. **From Repository Secrets → Environment Variables:**
   - `SERVER_DEPLOY_PATH` - Just a path (`/opt/healthcare-backend`), not
     sensitive

3. **Remove Duplicates:**
   - `GOOGLE_CLIENT_ID` - Remove from both Secrets locations, keep only in
     Variables

#### Migration Steps

1. **Add to Environment Variables:**
   - `GOOGLE_CLIENT_ID` = Your Google Client ID
   - `SESSION_TIMEOUT` = `86400`
   - `SOCKET_URL` = `/socket.io`
   - `SERVER_DEPLOY_PATH` = `/opt/healthcare-backend`

2. **Delete from Secrets:**
   - Environment Secrets: `GOOGLE_CLIENT_ID`, `SESSION_TIMEOUT`, `SOCKET_URL`
   - Repository Secrets: `GOOGLE_CLIENT_ID` (duplicate), `SERVER_DEPLOY_PATH`

3. **Update CI Workflow:** After moving, the CI workflow
   (`.github/workflows/ci.yml`) should use:
   ```yaml
   GOOGLE_CLIENT_ID=${{ vars.GOOGLE_CLIENT_ID }}
   SESSION_TIMEOUT=${{ vars.SESSION_TIMEOUT }}
   SOCKET_URL=${{ vars.SOCKET_URL }}
   SERVER_DEPLOY_PATH: ${{ vars.SERVER_DEPLOY_PATH }}
   ```

---

### ✅ CI/CD Fixes Applied

**Status:** ✅ All CI/CD files verified and fixed

**Fixes Applied:**

- ✅ `SOCKET_URL`: Changed from `secrets` → `vars` (non-sensitive path)
- ✅ `GOOGLE_CLIENT_ID`: Changed from `secrets` → `vars` (public OAuth ID)
- ✅ `SESSION_TIMEOUT`: Changed from `secrets` → `vars` (non-sensitive number)
- ✅ `WHATSAPP_API_KEY`: Changed from `vars` → `secrets` (sensitive API key)
- ✅ All clinic-specific tokens/keys: Changed from `vars` → `secrets`

**Verification:**

- ✅ CI workflow uses environment variables (no hardcoded URLs)
- ✅ All scripts use environment variables (no hardcoded URLs)
- ✅ Secrets vs Variables correctly classified
- ✅ All sensitive data uses `secrets`
- ✅ All non-sensitive config uses `vars`

---

### 📋 Adding New Clinics

#### Step 1: Sanitize Clinic Name

Convert clinic name to environment variable format:

- `"New Clinic Name"` → `NEW_CLINIC_NAME`

#### Step 2: Add Clinic-Specific Secrets

Add all required clinic-specific secrets to GitHub Secrets (see patterns above).

#### Step 3: Update CORS_ORIGIN

Add the clinic's frontend URL to the `CORS_ORIGIN` variable:

```
https://existing-clinic.com,https://new-clinic.com,https://www.viddhakarma.com
```

**Note:** All these frontends connect to the SAME backend API
(`backend-service-v1.ishswami.in`). Only clinic-specific data differs.

---

### 🔄 Priority Order

Configuration is resolved in the following priority order:

1. **Database Settings** (highest priority)
   - Stored in `Clinic.settings.communicationSettings` (JSONB field)
   - Configured via API endpoints
   - Encrypted at rest

2. **Clinic-Specific Environment Variables**
   - By sanitized clinic name: `CLINIC_{NAME}_{KEY}`
   - By app name: `CLINIC_{APP_NAME}_{KEY}`
   - By subdomain: `CLINIC_{SUBDOMAIN}_{KEY}`

3. **Global Environment Variables** (fallback)
   - Default values for all clinics
   - Used when clinic-specific config not found

---

## 📚 Related Documentation

- **Environment Variables**:
  [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) - Complete reference
  for all environment variables
- **Production Template**:
  [PRODUCTION_ENV_TEMPLATE.txt](./PRODUCTION_ENV_TEMPLATE.txt) - Template file
  for production environment variables
- **Server Setup Guide**:
  [UBUNTU_24_SERVER_SETUP.md](./UBUNTU_24_SERVER_SETUP.md) - Complete server
  setup and security
- **Docker Deployment**:
  [../devops/docker/README.md](../devops/docker/README.md) - Docker Compose
  setup
- **Nginx Configuration**:
  [../devops/nginx/README.md](../devops/nginx/README.md) - Reverse proxy and SSL
  setup
- **Scripts Documentation**:
  [../devops/scripts/README.md](../devops/scripts/README.md) - DevOps scripts

---

## 📞 Support

For issues or questions:

1. Check GitHub Actions logs
2. Review server logs
3. Verify configuration
4. Consult documentation
5. Review troubleshooting section above

---

**Last Updated**: 2026-01-05  
**Maintained By**: Healthcare Backend Team  
**Status**: ✅ All GitHub Actions and CI/CD documentation merged into this guide
