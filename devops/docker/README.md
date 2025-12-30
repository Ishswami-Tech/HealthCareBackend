# Docker Production Deployment Guide

Complete guide for deploying, monitoring, and scaling the Healthcare Backend using Docker Compose.

## 🚀 Quick Start

### Start All Services
```bash
cd devops/docker
docker compose -f docker-compose.prod.yml up -d --build
```

### Check Status
```bash
docker compose -f docker-compose.prod.yml ps
```

### View Logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
```

### Check Health
```bash
curl http://localhost:8088/health
```

### Stop Services
```bash
docker compose -f docker-compose.prod.yml down
```

### Restart Services
```bash
docker compose -f docker-compose.prod.yml restart
```

---

## 📊 Overview

This Docker Compose configuration is optimized for **8 vCPU, 24GB RAM** but can run on **6 vCPU, 12GB RAM** initially. Docker will enforce resource limits automatically.

**Target Capacity (8 vCPU/24GB RAM):**
- **Concurrent Users**: 700-900
- **Requests/Second**: 1,200-1,800 req/s
- **Requests/Day**: 104M-156M requests/day

**Initial Capacity (6 vCPU/12GB RAM):**
- **Concurrent Users**: 300-400
- **Requests/Second**: 500-800 req/s
- **Requests/Day**: 43M-69M requests/day

**Scale When**: Resources reach **80% utilization** for **15+ minutes**

---

## 📋 Prerequisites

1. **Docker Engine** (v20.10+) or **Docker Desktop** installed and running
2. **Docker Compose** (v2.0+) installed
3. **Production environment file** (`.env.production`) configured with all required secrets
4. **SSL Certificates** mounted at `/etc/letsencrypt` (for HTTPS)
5. **Server**: Minimum 6 vCPU, 12GB RAM (recommended: 8 vCPU, 24GB RAM)

---

## 🔐 Required Environment Variables

Before deploying, ensure `.env.production` contains all required variables. See [GitHub Secrets Reference](../../docs/GITHUB_SECRETS_REFERENCE.md) for complete list.

### Critical (Must be changed from defaults):
- `JWT_SECRET` - Secure JWT signing secret (minimum 32 characters)
- `SESSION_SECRET` - Fastify session secret (minimum 32 characters)
- `COOKIE_SECRET` - Cookie signing secret (minimum 32 characters)
- `OPENVIDU_SECRET` - OpenVidu server secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret

### Database:
- `DATABASE_URL` - PostgreSQL connection string
- `DIRECT_URL` - Direct PostgreSQL connection (for migrations)

### External Services (if used):
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_PRIVATE_KEY` - Firebase private key
- `FIREBASE_CLIENT_EMAIL` - Firebase client email
- `ZEPTOMAIL_SEND_MAIL_TOKEN` - ZeptoMail API token

---

## 🎯 Resource Allocation

### Target Configuration (8 vCPU, 24GB RAM)

| Service | CPU Limit | RAM Limit | CPU Reserve | RAM Reserve |
|---------|-----------|-----------|-------------|-------------|
| **API** | 3.0 | 6GB | 1.5 | 2GB |
| **PostgreSQL** | 3.0 | 10GB | 1.5 | 3GB |
| **Dragonfly** | 1.5 | 4GB | 0.5 | 1GB |
| **Worker** | 1.0 | 2GB | 0.5 | 512MB |
| **OpenVidu** | 2.0 | 4GB | 1.0 | 2GB |
| **Total** | **10.5** | **26GB** | **5.0** | **8.5GB** |

**Note**: Total limits slightly exceed server capacity to allow Docker to manage resource allocation efficiently. Docker will enforce actual limits based on available resources.

### Current Server (6 vCPU, 12GB RAM)

When running on 6 vCPU/12GB RAM:
- Docker enforces limits based on available resources
- Services will use what's available within their limits
- Performance will be reduced but functional
- Monitor and scale when resources reach 80% utilization

---

## 🔧 Configuration Details

### API Service

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

### PostgreSQL Service

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

### Dragonfly Cache

**Resources:**
- CPU: 1.5 limit / 0.5 reserve
- RAM: 4GB limit / 1GB reserve

**Configuration:**
- `--maxmemory=4gb`
- `--proactor_threads=6`
- `net.core.somaxconn=2048`

**Note**: Redis has been removed. Dragonfly is the only cache provider.

### Worker Service

**Resources:**
- CPU: 1.0 limit / 0.5 reserve
- RAM: 2GB limit / 512MB reserve

**Configuration:**
- `connection_limit=30`
- `pool_size=15`
- `BULL_WORKER_CONCURRENCY: 10`
- `BULL_MAX_JOBS_PER_WORKER: 100`

### OpenVidu Service

**Resources:**
- CPU: 2.0 limit / 1.0 reserve
- RAM: 4GB limit / 2GB reserve

**Configuration:**
- Port: 4443 (HTTP internally, SSL handled by Nginx)
- WebSocket support for video streaming
- Depends on Coturn for TURN/STUN

---

## 🚀 Deployment Steps

### Step 1: Prepare Environment

```bash
# Navigate to project root
cd /path/to/HealthCareBackend

# Ensure .env.production exists and is configured
# Values come from GitHub Secrets during CI/CD deployment
```

### Step 2: Build and Start Services

```bash
# Navigate to docker directory
cd devops/docker

# Build and start services
docker compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps
```

### Step 3: Verify Deployment

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

---

## 📊 Services Overview

| Service | Container Name | Description | Ports |
|---------|---------------|-------------|-------|
| **API** | `latest-api` | Main API service | 8088 |
| **Worker** | `latest-worker` | Background job processor | - |
| **PostgreSQL** | `latest-postgres` | Database | 5432 |
| **Dragonfly** | `latest-dragonfly` | Cache provider | 6380 |
| **OpenVidu** | `latest-openvidu-server` | Video conferencing | 4443 |
| **Coturn** | `latest-coturn` | TURN/STUN server | 3478 |

### Network Configuration

Services use a custom network (`app-network`) with fixed IP addresses:
- API: `172.18.0.5`
- PostgreSQL: `172.18.0.2`
- Dragonfly: `172.18.0.4`
- Worker: `172.18.0.6`
- OpenVidu: `172.18.0.7`
- Coturn: `172.18.0.8`

### Volume Persistence

Data is persisted in Docker volumes:
- `latest_postgres_data` - PostgreSQL data
- `latest_dragonfly_data` - Dragonfly data
- `latest_openvidu_recordings` - OpenVidu recordings
- `./logs` - Application logs (host-mounted)

---

## 📈 Monitoring & Scaling

### Monitoring Thresholds

- **<70%**: Healthy, no action needed
- **70-80%**: Monitor closely, plan for scaling
- **80-90%**: Scale immediately (upgrade server)
- **>90%**: Critical, emergency scaling required

### Quick Monitoring Commands

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

### Scaling Triggers

Scale when **ANY** of these conditions persist for **15+ minutes**:

1. **CPU Usage**: >80% consistently
2. **RAM Usage**: >80% consistently
3. **Response Time**: P95 >400ms consistently
4. **Database Connections**: >80% of limit (96/120)
5. **Error Rate**: >1% consistently
6. **Concurrent Users**: Approaching 400+ regularly

---

## 🔄 Vertical Scaling: 6 vCPU/12GB → 8 vCPU/24GB RAM

### Pre-Scaling Checklist

- [ ] Monitoring shows sustained 80%+ utilization
- [ ] Database backups are current
- [ ] Application logs show no critical errors
- [ ] Cache hit rate is >85%
- [ ] No planned maintenance windows
- [ ] Team is available for monitoring post-upgrade

### Scaling Procedure

#### Step 1: Backup

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

#### Step 2: Document Current State

```bash
# Save current resource usage
docker stats --no-stream > resource_usage_before_scale.txt

# Save current configuration
cp docker-compose.prod.yml docker-compose.prod.yml.backup
```

#### Step 3: Stop Services

```bash
# Stop all services
docker compose -f docker-compose.prod.yml down

# Verify all containers are stopped
docker ps -a | grep latest-

# Wait 30 seconds for cleanup
sleep 30
```

**Note**: Database data persists in volumes, so no data loss.

#### Step 4: Upgrade Server Resources

**Via Your Hosting Provider (Contabo):**

1. Login to Contabo Customer Panel
2. Go to VPS → Your Server → Upgrade
3. Select 8 vCPU, 24GB RAM
4. Confirm upgrade

**Wait for**: Server reboot and full initialization (usually 2-5 minutes)

#### Step 5: Verify New Server Resources

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

#### Step 6: Restart Services

```bash
# Navigate to docker directory
cd devops/docker

# Start services (Docker will use new resource limits)
docker compose -f docker-compose.prod.yml up -d

# Watch startup logs
docker compose -f docker-compose.prod.yml logs -f
```

**Wait for**: All services to be healthy (usually 1-2 minutes)

#### Step 7: Verify Services

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

#### Step 8: Monitor Post-Scaling

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

### Expected Improvements After Scaling

| Metric | Before (6/12) | After (8/24) | Improvement |
|--------|---------------|--------------|-------------|
| **Concurrent Users** | 300-400 | 700-900 | **2.5x** |
| **Requests/Second** | 500-800 | 1,200-1,800 | **2.25x** |
| **Response Time (p95)** | 200-300ms | 150-200ms | **25% faster** |
| **CPU Usage** | 70-80% | 50-70% | **Lower** |
| **RAM Usage** | 75-85% | 55-75% | **Lower** |

### Rollback Procedure

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

---

## 🔍 Health Checks

All services include health checks:

```bash
# Check API health
curl http://localhost:8088/health

# Check container health status
docker compose -f docker-compose.prod.yml ps

# Expected: All containers should show "healthy" status
```

---

## 📝 Logs

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f openvidu-server
```

### Log Files

Logs are persisted to `devops/docker/logs/` directory (mounted volume).

---

## 🔄 Updates and Maintenance

### Update Application

```bash
# Pull latest code (or use CI/CD)
git pull

# Rebuild and restart
docker compose -f docker-compose.prod.yml up -d --build

# Or restart specific service
docker compose -f docker-compose.prod.yml restart api
```

### Database Migrations

Migrations run automatically on API container startup. To run manually:

```bash
# Enter API container
docker exec -it latest-api sh

# Run migrations
yarn prisma migrate deploy --schema=/app/src/libs/infrastructure/database/prisma/schema.prisma
```

### Backup Database

```bash
# Create backup
docker exec -it latest-postgres pg_dump -U postgres userdb > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
docker exec -i latest-postgres psql -U postgres userdb < backup_20240101_120000.sql
```

---

## 🛑 Stop Services

```bash
# Stop all services (keeps data)
docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (⚠️ deletes data)
docker compose -f docker-compose.prod.yml down -v
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
# Check logs
docker compose -f docker-compose.prod.yml logs api

# Check container status
docker compose -f docker-compose.prod.yml ps

# Restart service
docker compose -f docker-compose.prod.yml restart api
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker compose -f docker-compose.prod.yml ps postgres

# Test connection from API container
docker exec -it latest-api sh -c "psql $DATABASE_URL -c 'SELECT 1'"
```

### Cache Connection Issues

```bash
# Test Dragonfly connection
docker exec -it latest-dragonfly redis-cli -p 6379 ping

# Check from API container
docker exec -it latest-api sh -c "redis-cli -h dragonfly -p 6379 ping"
```

### Health Check Failing

```bash
# Check health endpoint manually
docker exec -it latest-api wget -q --spider http://localhost:8088/health

# Check API logs for errors
docker compose -f docker-compose.prod.yml logs api | tail -50
```

### OpenVidu Issues

```bash
# Check OpenVidu container
docker ps | grep openvidu

# Check OpenVidu logs
docker logs latest-openvidu-server

# Test OpenVidu directly
curl http://127.0.0.1:4443

# Check Coturn (TURN server)
docker ps | grep coturn
docker logs latest-coturn
```

---

## 📊 Performance Expectations

### On 6 vCPU/12GB RAM (Initial)

| Metric | Value |
|--------|-------|
| Concurrent Users | 300-400 |
| Requests/Second | 500-800 |
| CPU Usage | 60-75% |
| RAM Usage | 65-80% |
| Response Time (p95) | 200-300ms |

### On 8 vCPU/24GB RAM (After Scaling)

| Metric | Value |
|--------|-------|
| Concurrent Users | 700-900 |
| Requests/Second | 1,200-1,800 |
| CPU Usage | 50-70% |
| RAM Usage | 55-75% |
| Response Time (p95) | 150-200ms |

---

## 📚 Additional Resources

- [Nginx Configuration](../nginx/README.md) - Reverse proxy and SSL setup
- [Server Setup Guide](../../docs/SERVER_SETUP_GUIDE.md) - Complete server setup
- [Deployment Guide](../../docs/DEPLOYMENT_GUIDE.md) - CI/CD deployment
- [GitHub Secrets Reference](../../docs/GITHUB_SECRETS_REFERENCE.md) - Environment variables
- [Main README](../../README.md) - Project overview

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

---

## 🎯 Summary

This configuration is optimized for **8 vCPU/24GB RAM** but runs on **6 vCPU/12GB RAM** initially. Monitor resources and scale vertically when utilization reaches 80%. Dragonfly is the only cache provider (Redis removed). OpenVidu is included for video conferencing.

**Ready for production deployment!**
