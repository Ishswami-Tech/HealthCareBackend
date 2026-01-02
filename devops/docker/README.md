# Docker Deployment Guides

Complete guides for deploying, monitoring, and scaling the Healthcare Backend
using Docker Compose.

## 📚 Available Environments

- **Production** - Production deployment with pre-built images (see
  [Production Deployment](#-production-deployment))
- **Local-Prod** - Local production-like environment for testing (see
  [Local-Prod Environment](#-local-prod-environment))
- **Development** - Development environment with hot-reload (see
  `docker-compose.dev.yml`)

---

## 🚀 Quick Start

### Production

```bash
cd devops/docker
docker compose -f docker-compose.prod.yml up -d --build
```

### Local-Prod (Local Testing)

```bash
cd devops/docker
docker compose -f docker-compose.local-prod.yml --profile infrastructure --profile app up -d --build
```

### Docker Management UI (Portainer)

**Portainer** provides a comprehensive web-based UI for managing Docker (similar
to Vercel's dashboard). It shows:

- ✅ **Containers**: View, start, stop, restart, remove containers
- ✅ **Images**: Manage Docker images, view layers, pull/push
- ✅ **Networks**: View and manage Docker networks
- ✅ **Volumes**: Manage Docker volumes and data
- ✅ **Logs**: Real-time container logs with filtering
- ✅ **Stats**: CPU, memory, network I/O monitoring
- ✅ **Stacks**: Manage docker-compose stacks
- ✅ **Events**: Docker daemon events
- ✅ **Resource Usage**: Per-container resource monitoring

**Access Portainer:**

- **Development**: http://localhost:9000
- **Production**: http://your-server:9000 (or configure via Nginx reverse proxy)

**First-time Setup:**

1. Open Portainer in your browser
2. Create an admin account (first time only)
3. Select "Docker" environment
4. Start managing your containers!

**Note**: Portainer is included in the `infrastructure` profile, so it starts
automatically with infrastructure services.

#### 🎯 Disk Usage Optimization

Portainer is **optimized for minimal disk usage**:

- ✅ **Minimal Logging**: Only WARN and ERROR level logs (reduces log file size)
- ✅ **No Analytics**: Analytics disabled via `--no-analytics` flag
- ✅ **No Telemetry**: Telemetry disabled (no data collection)
- ✅ **Strict Resource Limits**: 256MB memory limit, 0.5 CPU limit
- ✅ **Reduced Health Checks**: Less frequent checks (30s interval instead of
  10s)
- ✅ **Small Data Volume**: Only stores user preferences and settings (not
  container data)

**Expected Disk Usage:**

- **Portainer Data Volume**: < 50MB (only stores user preferences, settings, and
  authentication data)
- **No Growing Data**: Portainer doesn't store container logs or snapshots by
  default
- **Minimal Logs**: WARN-level logging keeps container log files small
- **Total Footprint**: Typically < 100MB including image and data

**What Portainer Stores:**

- User accounts and authentication data
- User preferences (theme, language, etc.)
- Environment configurations
- **NOT stored**: Container logs, images, volumes (these are managed by Docker,
  not Portainer)

**Monitor Disk Usage:**

```bash
# Check Portainer volume size
docker system df -v | grep portainer

# Check Portainer container disk usage
docker exec healthcare-portainer du -sh /data

# Check all Docker disk usage
docker system df
```

**If Disk Usage Grows:**

1. Check Portainer logs: `docker logs healthcare-portainer --tail 100`
2. Check Docker system usage: `docker system df` (Portainer itself is small, but
   Docker images/containers might be large)
3. Clean unused Docker resources: `docker system prune -a --volumes` (⚠️ removes
   unused images, containers, volumes)
4. Reset Portainer data (if needed):
   `docker volume rm healthcare_portainer_data` (⚠️ removes all Portainer
   settings and users)

**Important Notes:**

- Portainer's own disk usage is minimal (< 100MB)
- Most disk usage comes from Docker images, containers, and volumes (not
  Portainer)
- Use `docker system prune` regularly to clean up unused Docker resources
- Portainer data volume only grows if you have many users or complex
  configurations

### Check Status

```bash
# Production
docker compose -f docker-compose.prod.yml ps

# Local-Prod
docker compose -f docker-compose.local-prod.yml ps
```

### View Logs

```bash
# Production - All services
docker compose -f docker-compose.prod.yml logs -f

# Production - Specific service
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker

# Local-Prod - All services
docker compose -f docker-compose.local-prod.yml logs -f

# Local-Prod - Specific service
docker compose -f docker-compose.local-prod.yml logs -f api
docker compose -f docker-compose.local-prod.yml logs -f worker
```

### Check Health

```bash
curl http://localhost:8088/health
```

### Stop Services

```bash
# Production
docker compose -f docker-compose.prod.yml down

# Local-Prod
docker compose -f docker-compose.local-prod.yml down
```

### Restart Services

```bash
# Production
docker compose -f docker-compose.prod.yml restart

# Local-Prod
docker compose -f docker-compose.local-prod.yml restart
```

---

## 🏭 Production Deployment

### 📊 Overview

This Docker Compose configuration is optimized for **8 vCPU, 24GB RAM** but can
run on **6 vCPU, 12GB RAM** initially. Docker will enforce resource limits
automatically.

**Target Capacity (8 vCPU/24GB RAM):**

- **Concurrent Users**: 700-900
- **Requests/Second**: 1,200-1,800 req/s
- **Requests/Day**: 104M-156M requests/day

**Initial Capacity (6 vCPU/12GB RAM):**

- **Concurrent Users**: 300-400
- **Requests/Second**: 500-800 req/s
- **Requests/Day**: 43M-69M requests/day

**Scale When**: Resources reach **80% utilization** for **15+ minutes**

### 📋 Prerequisites

1. **Docker Engine** (v20.10+) or **Docker Desktop** installed and running
2. **Docker Compose** (v2.0+) installed
3. **Production environment file** (`.env.production`) configured with all
   required secrets
4. **SSL Certificates** mounted at `/etc/letsencrypt` (for HTTPS)
5. **Server**: Minimum 6 vCPU, 12GB RAM (recommended: 8 vCPU, 24GB RAM)

### 🔐 Required Environment Variables

Before deploying, ensure `.env.production` contains all required variables. See
[GitHub Secrets Reference](../../docs/GITHUB_SECRETS_REFERENCE.md) for complete
list.

#### Critical (Must be changed from defaults):

- `JWT_SECRET` - Secure JWT signing secret (minimum 32 characters)
- `SESSION_SECRET` - Fastify session secret (minimum 32 characters)
- `COOKIE_SECRET` - Cookie signing secret (minimum 32 characters)
- `OPENVIDU_SECRET` - OpenVidu server secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret

#### Database:

- `DATABASE_URL` - PostgreSQL connection string
- `DIRECT_URL` - Direct PostgreSQL connection (for migrations)

#### External Services (if used):

- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_PRIVATE_KEY` - Firebase private key
- `FIREBASE_CLIENT_EMAIL` - Firebase client email
- `ZEPTOMAIL_SEND_MAIL_TOKEN` - ZeptoMail API token

### 🎯 Resource Allocation

#### Target Configuration (8 vCPU, 24GB RAM)

| Service        | CPU Limit | RAM Limit | CPU Reserve | RAM Reserve |
| -------------- | --------- | --------- | ----------- | ----------- |
| **API**        | 3.0       | 6GB       | 1.5         | 2GB         |
| **PostgreSQL** | 3.0       | 10GB      | 1.5         | 3GB         |
| **Dragonfly**  | 1.5       | 4GB       | 0.5         | 1GB         |
| **Worker**     | 1.0       | 2GB       | 0.5         | 512MB       |
| **OpenVidu**   | 2.0       | 4GB       | 1.0         | 2GB         |
| **Total**      | **10.5**  | **26GB**  | **5.0**     | **8.5GB**   |

**Note**: Total limits slightly exceed server capacity to allow Docker to manage
resource allocation efficiently. Docker will enforce actual limits based on
available resources.

#### Current Server (6 vCPU, 12GB RAM)

When running on 6 vCPU/12GB RAM:

- Docker enforces limits based on available resources
- Services will use what's available within their limits
- Performance will be reduced but functional
- Monitor and scale when resources reach 80% utilization

### 🔧 Configuration Details

#### API Service

**Resources:**

- CPU: 3.0 limit / 1.5 reserve
- RAM: 6GB limit / 2GB reserve

**Database Connections:**

- `connection_limit=60`
- `pool_size=30`
- `max_connections=60`

**Rate Limiting:**

- `SECURITY_RATE_LIMIT_MAX: 4000`
- `RATE_LIMIT_MAX: 600`
- `API_RATE_LIMIT: 1000`

**Node.js Memory:**

- `--max-old-space-size=6144` (6GB heap)

#### PostgreSQL Service

**Resources:**

- CPU: 3.0 limit / 1.5 reserve
- RAM: 10GB limit / 3GB reserve

**Configuration:**

- `max_connections=120`
- `shared_buffers=2GB`
- `effective_cache_size=12GB`
- `work_mem=16MB`
- `max_worker_processes=8`
- `max_parallel_workers=8`

#### Dragonfly Cache

**Resources:**

- CPU: 1.5 limit / 0.5 reserve
- RAM: 4GB limit / 1GB reserve

**Configuration:**

- `--maxmemory=4gb`
- `--proactor_threads=6`
- `net.core.somaxconn=2048`

**Note**: Redis has been removed. Dragonfly is the only cache provider.

#### Worker Service

**Resources:**

- CPU: 1.0 limit / 0.5 reserve
- RAM: 2GB limit / 512MB reserve

**Configuration:**

- `connection_limit=30`
- `pool_size=15`
- `BULL_WORKER_CONCURRENCY: 10`
- `BULL_MAX_JOBS_PER_WORKER: 100`

#### OpenVidu Service

**Resources:**

- CPU: 2.0 limit / 1.0 reserve
- RAM: 4GB limit / 2GB reserve

**Configuration:**

- Port: 4443 (HTTP internally, SSL handled by Nginx)
- WebSocket support for video streaming
- Depends on Coturn for TURN/STUN

### 🚀 Deployment Steps

#### Step 1: Prepare Environment

```bash
# Navigate to project root
cd /path/to/HealthCareBackend

# Ensure .env.production exists and is configured
# Values come from GitHub Secrets during CI/CD deployment
```

#### Step 2: Build and Start Services

```bash
# Navigate to docker directory
cd devops/docker

# Build and start services
docker compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps
```

#### Step 3: Verify Deployment

```bash
# Check all containers are running
docker compose -f docker-compose.prod.yml ps

# Check API logs
docker compose -f docker-compose.prod.yml logs -f api

# Check worker logs
docker compose -f docker-compose.prod.yml logs -f worker

# Test health endpoint
curl https://api.ishswami.in/health
```

### 📊 Services Overview

| Service        | Container Name           | Description              | Ports |
| -------------- | ------------------------ | ------------------------ | ----- |
| **API**        | `latest-api`             | Main API service         | 8088  |
| **Worker**     | `latest-worker`          | Background job processor | -     |
| **PostgreSQL** | `latest-postgres`        | Database                 | 5432  |
| **Dragonfly**  | `latest-dragonfly`       | Cache provider           | 6380  |
| **OpenVidu**   | `latest-openvidu-server` | Video conferencing       | 4443  |
| **Coturn**     | `latest-coturn`          | TURN/STUN server         | 3478  |
| **Portainer**  | `portainer`              | Docker Management UI     | 9000  |

#### Network Configuration

Services use a custom network (`app-network`) with fixed IP addresses:

- API: `172.18.0.5`
- PostgreSQL: `172.18.0.2`
- Dragonfly: `172.18.0.4`
- Worker: `172.18.0.6`
- OpenVidu: `172.18.0.7`
- Coturn: `172.18.0.8`
- Portainer: `172.18.0.9`

#### Volume Persistence

Data is persisted in Docker volumes:

- `latest_postgres_data` - PostgreSQL data
- `latest_dragonfly_data` - Dragonfly data
- `latest_openvidu_recordings` - OpenVidu recordings
- `./logs` - Application logs (host-mounted)

### 📈 Monitoring & Scaling

#### Monitoring Thresholds

- **<70%**: Healthy, no action needed
- **70-80%**: Monitor closely, plan for scaling
- **80-90%**: Scale immediately (upgrade server)
- **>90%**: Critical, emergency scaling required

#### Quick Monitoring Commands

```bash
# Real-time resource usage
docker stats

# Check container health
docker ps --format "table {{.Names}}\t{{.Status}}"

# Check API response time
curl -w "\nTime: %{time_total}s\n" -o /dev/null -s https://api.ishswami.in/health

# Check detailed health endpoint
curl -w "\nTime: %{time_total}s\n" -o /dev/null -s "https://api.ishswami.in/health?detailed=true"

# Check database connections
docker exec latest-postgres psql -U postgres -d userdb -c "SELECT count(*) FROM pg_stat_activity;"

# Check cache memory
docker exec latest-dragonfly redis-cli -p 6379 INFO memory | grep used_memory_human
```

#### Scaling Triggers

Scale when **ANY** of these conditions persist for **15+ minutes**:

1. **CPU Usage**: >80% consistently
2. **RAM Usage**: >80% consistently
3. **Response Time**: P95 >400ms consistently
4. **Database Connections**: >80% of limit (96/120)
5. **Error Rate**: >1% consistently
6. **Concurrent Users**: Approaching 400+ regularly

### 🔄 Vertical Scaling: 6 vCPU/12GB → 8 vCPU/24GB RAM

#### Pre-Scaling Checklist

- [ ] Monitoring shows sustained 80%+ utilization
- [ ] Database backups are current
- [ ] Application logs show no critical errors
- [ ] Cache hit rate is >85%
- [ ] No planned maintenance windows
- [ ] Team is available for monitoring post-upgrade

#### Scaling Procedure

**Step 1: Backup**

```bash
# Navigate to docker directory
cd devops/docker

# Backup database
docker exec latest-postgres pg_dump -U postgres userdb > backup_pre_scale_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
ls -lh backup_pre_scale_*.sql

# Backup volumes (optional but recommended)
docker run --rm \
  -v latest_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres_volume_backup_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

**Step 2: Document Current State**

```bash
# Save current resource usage
docker stats --no-stream > resource_usage_before_scale.txt

# Save current configuration
cp docker-compose.prod.yml docker-compose.prod.yml.backup
```

**Step 3: Stop Services**

```bash
# Stop all services
docker compose -f docker-compose.prod.yml down

# Verify all containers are stopped
docker ps -a | grep latest-

# Wait 30 seconds for cleanup
sleep 30
```

**Note**: Database data persists in volumes, so no data loss.

**Step 4: Upgrade Server Resources**

**Via Your Hosting Provider (Contabo):**

1. Login to Contabo Customer Panel
2. Go to VPS → Your Server → Upgrade
3. Select 8 vCPU, 24GB RAM
4. Confirm upgrade

**Wait for**: Server reboot and full initialization (usually 2-5 minutes)

**Step 5: Verify New Server Resources**

```bash
# SSH into server
ssh deploy@31.220.79.219

# Check CPU cores
nproc
# Expected: 8

# Check RAM
free -h
# Expected: ~24GB total
```

**Step 6: Restart Services**

```bash
# Navigate to docker directory
cd devops/docker

# Start services (Docker will use new resource limits)
docker compose -f docker-compose.prod.yml up -d

# Watch startup logs
docker compose -f docker-compose.prod.yml logs -f
```

**Wait for**: All services to be healthy (usually 1-2 minutes)

**Step 7: Verify Services**

```bash
# Check all containers are running
docker ps

# Check resource allocation
docker stats --no-stream

# Check health status
docker ps --format "table {{.Names}}\t{{.Status}}"

# Test API
curl https://api.ishswami.in/health

# Check database
docker exec latest-postgres psql -U postgres -d userdb -c "SELECT version();"
```

**Step 8: Monitor Post-Scaling**

**First 15 minutes** (Critical monitoring period):

```bash
# Continuous monitoring
watch -n 5 'docker stats --no-stream'

# Check for errors
docker logs latest-api --tail 50 | grep -i error
docker logs latest-postgres --tail 50 | grep -i error
```

**First hour**: Check every 10 minutes, verify response times, check error rates

**First 24 hours**: Check daily, review logs, verify performance metrics

#### Expected Improvements After Scaling

| Metric                  | Before (6/12) | After (8/24) | Improvement    |
| ----------------------- | ------------- | ------------ | -------------- |
| **Concurrent Users**    | 300-400       | 700-900      | **2.5x**       |
| **Requests/Second**     | 500-800       | 1,200-1,800  | **2.25x**      |
| **Response Time (p95)** | 200-300ms     | 150-200ms    | **25% faster** |
| **CPU Usage**           | 70-80%        | 50-70%       | **Lower**      |
| **RAM Usage**           | 75-85%        | 55-75%       | **Lower**      |

#### Rollback Procedure

If issues occur:

```bash
# Stop services
cd devops/docker
docker compose -f docker-compose.prod.yml down

# Downgrade server via hosting provider

# Restart services
docker compose -f docker-compose.prod.yml up -d

# Restore database if needed
docker exec -i latest-postgres psql -U postgres -d userdb < backup_pre_scale_*.sql
```

### 📊 Performance Expectations

#### On 6 vCPU/12GB RAM (Initial)

| Metric              | Value     |
| ------------------- | --------- |
| Concurrent Users    | 300-400   |
| Requests/Second     | 500-800   |
| CPU Usage           | 60-75%    |
| RAM Usage           | 65-80%    |
| Response Time (p95) | 200-300ms |

#### On 8 vCPU/24GB RAM (After Scaling)

| Metric              | Value       |
| ------------------- | ----------- |
| Concurrent Users    | 700-900     |
| Requests/Second     | 1,200-1,800 |
| CPU Usage           | 50-70%      |
| RAM Usage           | 55-75%      |
| Response Time (p95) | 150-200ms   |

---

## 🧪 Local-Prod Environment

### 📊 Overview

This local-prod Docker Compose configuration is **optimized for local testing**
and mirrors the production setup with:

- **Reduced resource limits** (suitable for local development machines)
- **Local builds** instead of pre-built images
- **Local-prod environment variables** (`.env.local-prod`)
- **Local volume mounts** for easier debugging
- **Same architecture** as production for accurate testing

**Key Differences from Production:**

| Aspect              | Production                | Local-Prod                |
| ------------------- | ------------------------- | ------------------------- |
| **Image Source**    | Pre-built from registry   | Local build               |
| **Resource Limits** | 8 vCPU/24GB RAM optimized | Reduced for local testing |
| **Environment**     | `.env.production`         | `.env.local-prod`         |
| **Cache Prefix**    | `healthcare:`             | `healthcare:local-prod:`  |
| **Rate Limits**     | Higher (production scale) | Lower (testing scale)     |
| **Network Name**    | `app-network`             | `local-prod_app_network`  |
| **Container Names** | `latest-*`                | `local-prod-*`            |

### 📋 Prerequisites

1. **Docker Engine** (v20.10+) or **Docker Desktop** installed and running
2. **Docker Compose** (v2.0+) installed
3. **Local-prod environment file** (`.env.local-prod`) configured
4. **Local machine** with at least 4GB RAM available for Docker

### 🔐 Required Environment Variables

Create `.env.local-prod` file in the project root with local-prod-specific
values:

```bash
# Copy from .env.production and adjust for local-prod
cp .env.production .env.local-prod

# Edit .env.local-prod with local-prod values
```

#### Critical Variables:

```env
# Application
NODE_ENV=local-prod
PORT=8088

# Database (uses local PostgreSQL container)
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb?connection_limit=40&pool_timeout=60

# Cache (uses local Dragonfly container)
DRAGONFLY_HOST=dragonfly
DRAGONFLY_PORT=6379
DRAGONFLY_KEY_PREFIX=healthcare:local-prod:

# JWT & Session Secrets (use local-prod-specific values)
JWT_SECRET=local-prod-jwt-secret-change-in-production-min-32-chars
SESSION_SECRET=local-prod-session-secret-change-in-production-min-32-chars-long
COOKIE_SECRET=local-prod-cookie-secret-change-in-production-min-32-chars

# URLs (local)
API_URL=http://localhost:8088
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000,http://localhost:8088

# Video (uses local OpenVidu container)
OPENVIDU_URL=http://openvidu-server:4443
OPENVIDU_SECRET=MY_SECRET
```

### 🎯 Resource Allocation (Local-Prod)

#### Local-Prod Configuration (Local Testing)

| Service        | CPU Limit | RAM Limit | CPU Reserve | RAM Reserve |
| -------------- | --------- | --------- | ----------- | ----------- |
| **API**        | 2.0       | 4GB       | 1.0         | 1GB         |
| **PostgreSQL** | 2.0       | 4GB       | 1.0         | 2GB         |
| **Dragonfly**  | 1.0       | 2GB       | 0.5         | 512MB       |
| **Worker**     | 0.5       | 1GB       | 0.25        | 256MB       |
| **OpenVidu**   | 1.5       | 2GB       | 0.5         | 1GB         |
| **Total**      | **7.0**   | **13GB**  | **3.25**    | **4.75GB**  |

**Note**: These limits are suitable for local development machines. Docker will
enforce limits based on available resources.

### 🚀 Deployment Steps

#### Step 1: Prepare Environment

```bash
# Navigate to project root
cd /path/to/HealthCareBackend

# Create .env.local-prod if it doesn't exist
# Copy from .env.production and adjust values
cp .env.production .env.local-prod

# Edit .env.local-prod with local-prod-specific values
nano .env.local-prod
```

#### Step 2: Create Data Directories

```bash
# Navigate to docker directory
cd devops/docker

# Create data directories for volumes
mkdir -p data/postgres
mkdir -p data/dragonfly
mkdir -p logs
```

#### Step 3: Build and Start Services

```bash
# Start infrastructure services first
docker compose -f docker-compose.local-prod.yml --profile infrastructure up -d

# Wait for infrastructure to be healthy (30-60 seconds)
docker compose -f docker-compose.local-prod.yml ps

# Start application services
docker compose -f docker-compose.local-prod.yml --profile app up -d --build

# Check status
docker compose -f docker-compose.local-prod.yml ps
```

#### Step 4: Verify Deployment

```bash
# Check all containers are running
docker compose -f docker-compose.local-prod.yml ps

# Check API logs
docker compose -f docker-compose.local-prod.yml logs -f api

# Check worker logs
docker compose -f docker-compose.local-prod.yml logs -f worker

# Test health endpoint
curl http://localhost:8088/health

# Test Swagger documentation
open http://localhost:8088/docs
```

### 📊 Services Overview

| Service        | Container Name               | Description              | Ports |
| -------------- | ---------------------------- | ------------------------ | ----- |
| **API**        | `local-prod-api`             | Main API service         | 8088  |
| **Worker**     | `local-prod-worker`          | Background job processor | -     |
| **PostgreSQL** | `local-prod-postgres`        | Database                 | 5432  |
| **Dragonfly**  | `local-prod-dragonfly`       | Cache provider           | 6380  |
| **OpenVidu**   | `local-prod-openvidu-server` | Video conferencing       | 4443  |
| **Coturn**     | `local-prod-coturn`          | TURN/STUN server         | 3478  |
| **Portainer**  | `local-prod-portainer`       | Docker Management UI     | 9000  |

#### Network Configuration

Services use a custom network (`local-prod_app_network`) with fixed IP
addresses:

- API: `172.18.0.5`
- PostgreSQL: `172.18.0.2`
- Dragonfly: `172.18.0.4`
- Worker: `172.18.0.6`
- OpenVidu: `172.18.0.7`
- Coturn: `172.18.0.8`
- Portainer: `172.18.0.9`

#### Volume Persistence

Data is persisted in local directories:

- `./data/postgres` - PostgreSQL data
- `./data/dragonfly` - Dragonfly data
- `./logs` - Application logs

### 📊 Performance Expectations

#### Local-Prod (Local Testing)

| Metric              | Value     |
| ------------------- | --------- |
| Concurrent Users    | 50-100    |
| Requests/Second     | 100-200   |
| CPU Usage           | 40-60%    |
| RAM Usage           | 50-70%    |
| Response Time (p95) | 150-250ms |

**Note**: Performance will vary based on your local machine resources.

### 🔒 Security Notes

Local-prod environment uses:

- **HTTP** instead of HTTPS (for local testing)
- **Insecure cookies** (`SESSION_SECURE_COOKIES=false`)
- **Lax same-site** (`SESSION_SAME_SITE=lax`)
- **Local-prod-specific secrets** (different from production)

**⚠️ Never use local-prod secrets in production!**

---

## 🔍 Health Checks

All services include health checks:

```bash
# Production - Check API health
curl http://localhost:8088/health

# Production - Check container health status
docker compose -f docker-compose.prod.yml ps

# Local-Prod - Check API health
curl http://localhost:8088/health

# Local-Prod - Check container health status
docker compose -f docker-compose.local-prod.yml ps

# Expected: All containers should show "healthy" status
```

### Automated Health Checks

For **automated health monitoring** of all infrastructure containers
(PostgreSQL, Dragonfly, OpenVidu, Coturn, Portainer), use the production
automation scripts:

```bash
# Navigate to scripts directory
cd devops/scripts/docker-infra

# Check all infrastructure containers
./health-check.sh

# Expected output:
# ✓ PostgreSQL - healthy
# ✓ Dragonfly - healthy
# ✓ OpenVidu - healthy
# ✓ Coturn - healthy
# ✓ Portainer - healthy
```

See [Docker Infrastructure Scripts](../scripts/docker-infra/README.md) for
complete automation guide.

---

## 📝 Logs

### View Logs

```bash
# Production - All services
docker compose -f docker-compose.prod.yml logs -f

# Production - Specific service
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f openvidu-server

# Local-Prod - All services
docker compose -f docker-compose.local-prod.yml logs -f

# Local-Prod - Specific service
docker compose -f docker-compose.local-prod.yml logs -f api
docker compose -f docker-compose.local-prod.yml logs -f worker
docker compose -f docker-compose.local-prod.yml logs -f postgres
docker compose -f docker-compose.local-prod.yml logs -f openvidu-server
```

### Log Files

Logs are persisted to `devops/docker/logs/` directory (mounted volume).

---

## 🔄 Updates and Maintenance

### Update Application

```bash
# Production
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Or restart specific service
docker compose -f docker-compose.prod.yml restart api

# Local-Prod - Rebuild Application
docker compose -f docker-compose.local-prod.yml build api worker
docker compose -f docker-compose.local-prod.yml up -d
```

### Database Migrations

Migrations run automatically on API container startup. To run manually:

```bash
# Production
docker exec -it latest-api sh
yarn prisma migrate deploy --schema=/app/src/libs/infrastructure/database/prisma/schema.prisma --config=/app/src/libs/infrastructure/database/prisma/prisma.config.js

# Local-Prod
docker exec -it local-prod-api sh
yarn prisma migrate deploy --schema=/app/src/libs/infrastructure/database/prisma/schema.prisma --config=/app/src/libs/infrastructure/database/prisma/prisma.config.js
```

### Backup Database

**Manual Backup:**

```bash
# Production
docker exec -it latest-postgres pg_dump -U postgres userdb > backup_$(date +%Y%m%d_%H%M%S).sql
docker exec -i latest-postgres psql -U postgres userdb < backup_20240101_120000.sql
```

**Automated Backups (Recommended for Production):**

For production deployments, use the automated backup system with local + S3
storage:

```bash
# Navigate to scripts directory
cd devops/scripts/docker-infra

# Create pre-deployment backup
./backup.sh pre-deployment

# Create success backup (after deployment)
./backup.sh success

# Setup automated backups (hourly, daily, weekly)
./backup.sh setup-cron

# Restore from backup
./restore.sh <backup-id>
```

**Backup Types:**

- **Hourly**: Every hour (24h retention, local only)
- **Daily**: 2 AM daily (7d retention, local + S3)
- **Weekly**: Sunday 3 AM (4w retention, local + S3)
- **Pre-Deployment**: Before deployments (3 backups, local + S3)
- **Success**: After successful deployments (5 backups, local + S3)

See [Docker Infrastructure Scripts](../scripts/docker-infra/README.md) for
complete backup documentation.

**Local-Prod - Database Reset (Local-Prod Only):**

```bash
docker compose -f docker-compose.local-prod.yml down
docker compose -f docker-compose.local-prod.yml down -v
rm -rf data/postgres data/dragonfly
mkdir -p data/postgres data/dragonfly
docker compose -f docker-compose.local-prod.yml --profile infrastructure --profile app up -d --build
```

---

## 🛑 Stop Services

```bash
# Production - Stop all services (keeps data)
docker compose -f docker-compose.prod.yml down

# Production - Stop and remove volumes (⚠️ deletes data)
docker compose -f docker-compose.prod.yml down -v

# Local-Prod - Stop all services (keeps data)
docker compose -f docker-compose.local-prod.yml down

# Local-Prod - Stop and remove volumes (⚠️ deletes data)
docker compose -f docker-compose.local-prod.yml down -v
```

---

## 🔒 Security Checklist

Before going live, ensure:

- [ ] All secrets are changed from default values
- [ ] `JWT_SECRET` is at least 32 characters
- [ ] `SESSION_SECRET` is at least 32 characters
- [ ] `COOKIE_SECRET` is at least 32 characters
- [ ] `OPENVIDU_SECRET` is secure
- [ ] `SESSION_SECURE_COOKIES=true` (production)
- [ ] `SESSION_SAME_SITE=strict` (production)
- [ ] SSL certificates are properly mounted
- [ ] Database credentials are secure
- [ ] CORS origins are restricted to production domains
- [ ] Rate limiting is enabled
- [ ] Audit logging is enabled

---

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Production
docker compose -f docker-compose.prod.yml logs api
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml restart api

# Local-Prod
docker compose -f docker-compose.local-prod.yml logs api
docker compose -f docker-compose.local-prod.yml ps
docker compose -f docker-compose.local-prod.yml restart api
```

### Build Fails (Local-Prod)

```bash
# Clean build (no cache)
docker compose -f docker-compose.local-prod.yml build --no-cache api worker

# Check Dockerfile
cat devops/docker/Dockerfile
```

### Database Connection Issues

```bash
# Production
docker compose -f docker-compose.prod.yml ps postgres
docker exec -it latest-api sh -c "psql $DATABASE_URL -c 'SELECT 1'"

# Local-Prod
docker compose -f docker-compose.local-prod.yml ps postgres
docker exec -it local-prod-api sh -c "psql $DATABASE_URL -c 'SELECT 1'"
```

### Cache Connection Issues

```bash
# Production
docker exec -it latest-dragonfly redis-cli -p 6379 ping
docker exec -it latest-api sh -c "redis-cli -h dragonfly -p 6379 ping"

# Local-Prod
docker exec -it local-prod-dragonfly redis-cli -p 6379 ping
docker exec -it local-prod-api sh -c "redis-cli -h dragonfly -p 6379 ping"
```

### Health Check Failing

```bash
# Production
docker exec -it latest-api wget -q --spider http://localhost:8088/health
docker compose -f docker-compose.prod.yml logs api | tail -50

# Local-Prod
docker exec -it local-prod-api wget -q --spider http://localhost:8088/health
docker compose -f docker-compose.local-prod.yml logs api | tail -50
```

### OpenVidu Issues

```bash
# Production
docker ps | grep openvidu
docker logs latest-openvidu-server
curl http://127.0.0.1:4443
docker ps | grep coturn
docker logs latest-coturn

# Local-Prod
docker ps | grep openvidu
docker logs local-prod-openvidu-server
curl http://127.0.0.1:4443
docker ps | grep coturn
docker logs local-prod-coturn
```

### Port Conflicts (Local-Prod)

If ports are already in use:

```bash
# Check what's using the port
# Windows: netstat -ano | findstr :8088
# Linux/Mac: lsof -i :8088

# Change port in docker-compose.local-prod.yml
# Update PORT environment variable
```

---

## 🗄️ Prisma Schema Management

### Overview

This project uses **committed generated files** with automated validation to
prevent merge conflicts and stale files. Prisma Client is generated during
development, committed to the repository, and validated at multiple stages.

### How It Works with Docker

**Build Stage:**

- Dockerfile runs `yarn prisma:generate` during build (line 31)
- Regenerates Prisma Client (overwrites committed files)
- Copies generated files to `dist/` for production

**Runtime Stage:**

- Entrypoint script runs `prisma generate` again (safety net)
- Copies JavaScript files from `node_modules/.prisma/client` to custom location
- Creates symlink for `@prisma/client`
- Application code checks multiple paths (`dist/`, `src/`, relative,
  `@prisma/client`)

**Result:**

- ✅ Committed files act as backup/fallback
- ✅ Docker always regenerates (ensures fresh files)
- ✅ Multiple path checks (works in all scenarios)
- ✅ No runtime dependencies needed (faster startup)

### Initial Setup

After cloning the repository:

```bash
# Install dependencies (generates Prisma Client automatically)
yarn install

# Setup Husky Git hooks (for pre-commit/post-merge validation)
yarn husky install

# Verify Prisma generated files are up-to-date
yarn prisma:validate-generated
```

### Git Hooks

The project uses Husky for automated Prisma Client management:

**Pre-commit Hook** (`.husky/pre-commit`):

- Detects schema changes
- Automatically regenerates Prisma Client
- Validates generated files
- Blocks commit if validation fails

**Post-merge Hook** (`.husky/post-merge`):

- Detects schema changes after merge
- Automatically regenerates Prisma Client
- Prevents merge conflicts

### Available Commands

```bash
# Generate Prisma Client (standard)
yarn prisma:generate

# Regenerate and validate
yarn prisma:regenerate

# Validate generated files only
yarn prisma:validate-generated
```

### Safety Mechanisms

1. **Pre-commit hook** - Prevents stale files from being committed
2. **Post-merge hook** - Prevents merge conflicts
3. **CI validation** - Catches any missed cases (fails build if stale)
4. **Build integration** - Always ensures fresh files during build
5. **Git attributes** - Merge strategy for generated files

### Troubleshooting

**Issue: Pre-commit hook not running**

```bash
# Reinstall Husky
yarn husky install

# Make hooks executable (Linux/Mac)
chmod +x .husky/pre-commit
chmod +x .husky/post-merge
```

**Issue: Prisma generated files are missing**

```bash
# Regenerate Prisma Client
yarn prisma:regenerate

# Verify files exist
ls -la src/libs/infrastructure/database/prisma/generated/client/
```

**Issue: CI fails with "Prisma generated files are stale"**

```bash
# Pull latest changes
git pull

# Regenerate
yarn prisma:regenerate

# Commit and push
git add . && git commit -m "Update Prisma generated files" && git push
```

### Docker Compatibility

✅ **Docker works perfectly** with this setup because:

- Dockerfile regenerates Prisma Client at build time
- Entrypoint script regenerates at runtime (safety net)
- Code checks multiple paths (works in all scenarios)
- Committed files are just backup, Docker always regenerates

**No changes needed** to Docker configuration. The system is fully compatible.

### Files Created/Modified

**New Files:**

- `scripts/validate-prisma-generated.js` - Validation script
- `.lintstagedrc.js` - Lint-staged configuration
- `.husky/pre-commit` - Pre-commit hook
- `.husky/post-merge` - Post-merge hook
- `docs/PRISMA_COMPLETE_GUIDE.md` - Complete Prisma guide (generation, Docker,
  troubleshooting)

**Modified Files:**

- `package.json` - Added Husky, lint-staged, and new scripts
- `.gitattributes` - Added merge strategy for generated files
- `.github/workflows/ci.yml` - Added Prisma validation step
- `scripts/build.js` - Added Prisma validation

### Benefits

- ✅ **No merge conflicts** on generated files
- ✅ **No stale files** in repository
- ✅ **Faster startup** (no runtime generation needed)
- ✅ **Multiple safety nets** (hooks, CI, build)
- ✅ **Automated workflow** (no manual steps)
- ✅ **Clear error messages** (easy troubleshooting)

For detailed information, see
[Prisma Complete Guide](../../docs/PRISMA_COMPLETE_GUIDE.md).

---

## 📚 Additional Resources

- [Docker Infrastructure Scripts](../scripts/docker-infra/README.md) -
  **Production deployment automation, backups, health checks, and monitoring**
- [Nginx Configuration](../nginx/README.md) - Reverse proxy and SSL setup
- [Server Setup Guide](../../docs/SERVER_SETUP_GUIDE.md) - Complete server setup
- [Deployment Guide](../../docs/DEPLOYMENT_GUIDE.md) - CI/CD deployment
- [GitHub Secrets Reference](../../docs/GITHUB_SECRETS_REFERENCE.md) -
  Environment variables
- [Prisma Complete Guide](../../docs/PRISMA_COMPLETE_GUIDE.md) - Complete Prisma
  guide (generation, Docker, troubleshooting)
- [Main README](../../README.md) - Project overview

---

## 🔧 Production Deployment Automation

For **production deployments** with automated backups, health checks, and
monitoring, see the comprehensive
[Docker Infrastructure Scripts](../scripts/docker-infra/README.md) guide.

### Key Features

- ✅ **Automated Backups**: Hourly, daily, weekly, pre-deployment, and success
  backups (local + S3)
- ✅ **Health Monitoring**: Automated health checks for all 5 infrastructure
  containers (PostgreSQL, Dragonfly, OpenVidu, Coturn, Portainer)
- ✅ **Deployment Safety**: Pre-deployment backups, automatic rollback on
  failure, deployment locks
- ✅ **Disaster Recovery**: Full server restoration from S3 backups
- ✅ **Performance Monitoring**: Automated monitoring and alerts for CPU,
  memory, disk, and response times
- ✅ **Incident Response**: Quick resolution scripts for common issues

### Quick Start with Automation Scripts

```bash
# Navigate to scripts directory
cd devops/scripts/docker-infra

# Check infrastructure health (all 5 containers)
./health-check.sh

# Create pre-deployment backup
./backup.sh pre-deployment

# Deploy with safety features (includes automatic backups and rollback)
./deploy.sh

# Setup automated backups (cron jobs)
./backup.sh setup-cron
```

### Infrastructure Containers Monitored

The automation scripts monitor all 5 infrastructure containers:

| Container           | Port | Health Check           | Status       |
| ------------------- | ---- | ---------------------- | ------------ |
| **postgres**        | 5432 | `pg_isready`           | ✅ Monitored |
| **dragonfly**       | 6379 | `redis-cli ping`       | ✅ Monitored |
| **openvidu-server** | 4443 | HTTP check             | ✅ Monitored |
| **coturn**          | 3478 | `turnutils_stunclient` | ✅ Monitored |
| **portainer**       | 9000 | HTTP check             | ✅ Monitored |

For complete documentation, see
[Docker Infrastructure Scripts README](../scripts/docker-infra/README.md).

---

## 🆘 Support

For issues:

1. Check container logs
2. Verify environment variables
3. Check network connectivity
4. Review health check status
5. Consult troubleshooting section above

---

## ✅ Quick Reference

### Production

**Deploy:**

```bash
cd devops/docker && docker compose -f docker-compose.prod.yml up -d --build
```

**Monitor:**

```bash
docker stats
```

**Scale When:**

- CPU or RAM >80% for 15+ minutes

**Upgrade To:**

- 8 vCPU, 24GB RAM

**Expected Capacity:**

- 700-900 concurrent users
- 1,200-1,800 req/s

### Local-Prod

**Deploy:**

```bash
cd devops/docker && docker compose -f docker-compose.local-prod.yml --profile infrastructure --profile app up -d --build
```

**Monitor:**

```bash
docker stats
```

**Logs:**

```bash
docker compose -f docker-compose.local-prod.yml logs -f api
```

**Health:**

```bash
curl http://localhost:8088/health
```

**Stop:**

```bash
docker compose -f docker-compose.local-prod.yml down
```

---

## 🎯 Summary

### Production

This configuration is optimized for **8 vCPU/24GB RAM** but runs on **6
vCPU/12GB RAM** initially. Monitor resources and scale vertically when
utilization reaches 80%. Dragonfly is the only cache provider (Redis removed).
OpenVidu is included for video conferencing.

**Ready for production deployment!**

### Local-Prod

This local-prod configuration mirrors production architecture with reduced
resource limits suitable for local testing. Use it to:

- ✅ Test production-like deployments locally
- ✅ Verify Docker builds work correctly
- ✅ Test database migrations
- ✅ Verify all services integrate properly
- ✅ Debug production-like issues locally

**Ready for local production testing!**
