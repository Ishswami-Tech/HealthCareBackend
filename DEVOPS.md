# 🚀 DevOps Guide - Healthcare Backend

Complete guide for deploying, managing, and maintaining the Healthcare Backend application.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Local Development](#local-development)
- [Docker Setup](#docker-setup)
- [Production Deployment](#production-deployment)
- [CI/CD Pipeline](#cicd-pipeline)
- [Application Logs](#application-logs)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.15.4
- **Docker** >= 24.0.0
- **Docker Compose** >= 2.20.0

### One-Command Setup

```bash
# Install dependencies and setup project
make setup

# Start all services
make start
```

**Access Points:**
- API: http://localhost:8088
- API Docs (Swagger): http://localhost:8088/docs
- Prisma Studio: http://localhost:5555
- PgAdmin: http://localhost:5050 (`admin@admin.com` / `admin`)
- Redis Commander: http://localhost:8082 (`admin` / `admin`)

---

## 💻 Local Development

### Using pnpm (Recommended)

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm prisma:generate

# Run database migrations
pnpm exec prisma db push

# Start development server
pnpm start:dev
```

### Using Make Commands

```bash
make install        # Install dependencies
make dev           # Start dev server
make build         # Build application
make test          # Run tests
make lint          # Run linter
make format        # Format code
```

### Using Docker Compose

```bash
# Start all services (API, Postgres, Redis, PgAdmin, Redis Commander)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

---

## 🐳 Docker Setup

### Development Environment

```bash
# Full development stack with hot-reload
cd devops/docker
docker-compose -f docker-compose.dev.yml up -d

# Or use make command
make deploy-dev
```

**Includes:**
- API with hot-reload
- PostgreSQL 16
- Redis 7
- PgAdmin 4
- Redis Commander
- Prisma Studio
- Background Worker

### Production Environment

```bash
# Production-optimized build
cd devops/docker
docker-compose -f docker-compose.prod.yml up -d

# Or use make command
make deploy-prod
```

**Features:**
- Multi-stage builds
- Optimized image sizes
- Resource limits
- Health checks
- Auto-restart policies
- Volume persistence

### Docker Commands

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f api

# Check health
make health

# Shell access
make shell-api      # API container
make shell-db       # PostgreSQL
make shell-redis    # Redis CLI

# Clean up
make clean          # Remove containers and volumes
```

---

## 🌐 Production Deployment

### Manual Deployment

1. **Prepare Environment**
   ```bash
   # Create .env.production
   cp .env.example .env.production

   # Update production values
   nano .env.production
   ```

2. **Build and Deploy**
   ```bash
   # Build Docker images
   docker-compose -f devops/docker/docker-compose.prod.yml build

   # Deploy
   docker-compose -f devops/docker/docker-compose.prod.yml up -d

   # Verify
   curl http://localhost:8088/health
   ```

3. **Run Migrations**
   ```bash
   docker exec latest-api pnpm exec prisma db push
   ```

### Automated Deployment (GitHub Actions)

The project includes automated CI/CD pipeline:

1. **Push to main branch** triggers deployment
2. **Pre-deployment checks** verify server connectivity
3. **Build and test** the application
4. **Deploy** to production
5. **Health checks** verify deployment
6. **Automatic rollback** on failure

**Workflow:** `.github/workflows/deploy.yml`

---

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow

```yaml
Trigger: Push to main or Pull Request
Steps:
  1. Pre-deployment checks
     - SSH connectivity
     - DNS verification
     - Resource availability

  2. Build & Test
     - Install dependencies (pnpm)
     - Run linter
     - Run tests
     - Build application

  3. Deploy
     - Backup current deployment
     - Build Docker images
     - Start containers
     - Run migrations

  4. Verification
     - Health checks
     - Smoke tests
     - Performance tests

  5. Rollback (if failure)
     - Restore previous version
     - Verify rollback success
```

### Required Secrets

Configure in GitHub Repository Settings → Secrets:

```
SSH_PRIVATE_KEY          # SSH key for server access
SERVER_USER              # SSH username
GOOGLE_CLIENT_ID         # OAuth credentials
GOOGLE_CLIENT_SECRET     # OAuth credentials
JWT_SECRET               # JWT signing key
```

---

## 📊 Application Logs

### Built-in Application Monitoring

- **Health Endpoint:** `GET /health`
- **Metrics Endpoint:** `GET /metrics`
- **Bull Board:** `http://localhost:8088/queue-dashboard`
- **Logging Dashboard:** `http://localhost:8088/logger`

### Service Status

```bash
# Container stats
docker stats

# Service status
make status

# Logs
make logs
make logs-api

# Health check
make health
```

### Database Commands

```bash
# PostgreSQL stats
docker exec healthcare-postgres psql -U postgres -d userdb -c "
  SELECT * FROM pg_stat_activity;
"

# Redis stats
docker exec healthcare-redis redis-cli INFO stats
```

### Log Locations

Logs are stored in:
- **Application logs:** `./logs/`
- **Docker logs:** `docker logs healthcare-api`
- **PostgreSQL logs:** Inside container
- **Nginx logs:** `/var/log/nginx/`

> **Note:** External monitoring tools (Prometheus, Grafana, Loki) can be added separately if needed for production environments.

---

## 💾 Backup & Recovery

### Database Backup

```bash
# Manual backup
make db-backup

# Scheduled backup (cron)
0 2 * * * cd /path/to/project && make db-backup
```

### Database Restore

```bash
# Restore from backup
make db-restore

# Manual restore
docker exec -i healthcare-postgres psql -U postgres userdb < backup.sql
```

### Volume Backup

```bash
# Backup Docker volumes
docker run --rm -v healthcare_postgres_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres_backup.tar.gz /data

# Restore Docker volumes
docker run --rm -v healthcare_postgres_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/postgres_backup.tar.gz -C /
```

### Application Backup

```bash
# Backup entire application
tar -czf healthcare_backup_$(date +%Y%m%d).tar.gz \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=logs \
  .
```

---

## 🐛 Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Find process using port 8088
lsof -i :8088  # macOS/Linux
netstat -ano | findstr :8088  # Windows

# Kill process
kill -9 <PID>
```

#### Docker Build Failures

```bash
# Clean Docker cache
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache
```

#### Database Connection Issues

```bash
# Check PostgreSQL status
docker exec healthcare-postgres pg_isready

# Check logs
docker logs healthcare-postgres

# Restart PostgreSQL
docker restart healthcare-postgres
```

#### Redis Connection Issues

```bash
# Check Redis status
docker exec healthcare-redis redis-cli PING

# Check logs
docker logs healthcare-redis

# Restart Redis
docker restart healthcare-redis
```

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

echo "Checking API..."
curl -f http://localhost:8088/health || echo "API DOWN"

echo "Checking PostgreSQL..."
docker exec healthcare-postgres pg_isready || echo "POSTGRES DOWN"

echo "Checking Redis..."
docker exec healthcare-redis redis-cli PING || echo "REDIS DOWN"
```

### Performance Issues

```bash
# Check container resources
docker stats

# Check disk space
df -h

# Check memory usage
free -h

# Optimize Docker
docker system prune -f
```

---

## 📝 Additional Resources

### Scripts

All deployment scripts are in `devops/scripts/`:

- **Backup:** `devops/scripts/backup/`
- **Deployment:** `devops/scripts/deployment/`
- **Monitoring:** `devops/scripts/monitoring/`
- **CI/CD:** `devops/scripts/ci/`

### Documentation

- [Production Optimization Guide](devops/docs/PRODUCTION_OPTIMIZATION_GUIDE.md)
- [SSL Certificate Setup](devops/nginx/SSL_CERTIFICATES.md)
- [Cloudflare Setup](devops/nginx/CLOUDFLARE_SETUP.md)

### Configuration Files

- **Docker:** `devops/docker/`
- **Nginx:** `devops/nginx/`
- **HAProxy:** `devops/docker/haproxy/`

---

## 🆘 Support

For issues and questions:

1. Check [Troubleshooting](#troubleshooting) section
2. Review logs: `make logs`
3. Check service health: `make health`
4. Open an issue on GitHub

---

## 📌 Quick Reference

```bash
# Development
make dev              # Start dev server
make start            # Start Docker services
make logs             # View logs

# Database
make prisma-studio    # Open Prisma Studio
make db-backup        # Backup database
make db-restore       # Restore database

# Deployment
make deploy-dev       # Deploy development
make deploy-prod      # Deploy production

# Maintenance
make clean            # Clean Docker resources
make health           # Check service health
make status           # Show service status

# Debugging
make shell-api        # Shell into API container
make shell-db         # PostgreSQL shell
make shell-redis      # Redis CLI
```

---

**Last Updated:** January 2025
**Package Manager:** pnpm 9.15.4
**Docker Compose:** v2.20.2+
