# Docker Development Environment Guide

Complete guide for setting up, running, monitoring, and troubleshooting the Healthcare Backend Docker development environment.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Services Overview](#services-overview)
4. [Verification & Monitoring](#verification--monitoring)
5. [Access Points](#access-points)
6. [Troubleshooting](#troubleshooting)
7. [Useful Commands](#useful-commands)
8. [Cache System](#cache-system)
9. [Configuration](#configuration)

## Prerequisites

1. **Docker Desktop** must be installed and running
2. **WSL2** (recommended for Windows) or native Docker

### Windows Setup

1. Install **Docker Desktop** for Windows
2. Enable WSL2 integration:
   - Docker Desktop → Settings → Resources → WSL Integration
   - Enable integration with your WSL distro (Ubuntu, etc.)
   - Click "Apply & Restart"

## Quick Start

### Option 1: Using PowerShell Script (Windows)

```powershell
cd devops/docker
.\start-dev.ps1
```

### Option 2: Using Bash Script (WSL2/Linux/Mac)

```bash
cd devops/docker
chmod +x start-dev.sh
./start-dev.sh
```

### Option 3: Manual Start

```bash
# Navigate to project root
cd /path/to/HealthCareBackend

# Start services
docker compose -f devops/docker/docker-compose.dev.yml up -d --build

# Check status
docker compose -f devops/docker/docker-compose.dev.yml ps

# View logs
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
```

## Services Overview

When you run the startup script, the following containers are created:

| Container | Description | Ports | Health Check |
|-----------|-------------|-------|--------------|
| **healthcare-api** | Main API service | 8088, 5555 | `/health` (Terminus-based), Socket.IO `/health` namespace |
| **healthcare-postgres** | PostgreSQL database | 5432 | `pg_isready` |
| **healthcare-dragonfly** | Dragonfly cache (default) | 6380 | `redis-cli ping` |
| **healthcare-redis** | Redis cache (fallback) | 6379 | `redis-cli ping` |
| **healthcare-redis-ui** | Redis Commander UI | 8082 | HTTP |
| **healthcare-pgadmin** | PgAdmin UI | 5050 | HTTP |

### Service Details

- **healthcare-api**: NestJS application with hot-reload in development mode
- **healthcare-postgres**: PostgreSQL 14+ database
- **healthcare-dragonfly**: High-performance cache (26x faster than Redis) - **Default Provider**
- **healthcare-redis**: Redis cache for fallback scenarios
- **healthcare-redis-ui**: Web UI for managing Redis/Dragonfly
- **healthcare-pgadmin**: Web UI for managing PostgreSQL

## Verification & Monitoring

### Quick Verification Script

For WSL users, run the automated verification:

```bash
./devops/docker/verify-wsl.sh
```

### Manual Verification Steps

#### 1. Check Container Status

```bash
docker compose -f devops/docker/docker-compose.dev.yml ps
```

**Expected Output:**
- All containers: `Up` and `healthy`
- `healthcare-dragonfly`: `(healthy)`
- `healthcare-api`: `Up` (may show "Starting" during compilation)

#### 2. Verify Cache Provider Configuration

```bash
# Check API environment
docker exec -it healthcare-api env | grep CACHE_PROVIDER
```

**Expected Output:**
```
CACHE_PROVIDER=dragonfly
```

#### 3. Test Cache Connections

```bash
# Test Dragonfly connection
docker exec -it healthcare-dragonfly redis-cli -p 6379 ping
# Should return: PONG

# Test Redis connection (fallback)
docker exec -it healthcare-redis redis-cli ping
# Should return: PONG

# Test from API container
docker exec -it healthcare-api sh -c "redis-cli -h dragonfly -p 6379 ping"
# Should return: PONG
```

#### 4. Check API Logs for Cache Connection

```bash
# View API logs
docker compose -f devops/docker/docker-compose.dev.yml logs api | grep -i "dragonfly\|cache"
```

**Look for:**
- ✅ `Connecting to Dragonfly at dragonfly:6379`
- ✅ `✓ Dragonfly connected successfully`
- ✅ `Cache provider: dragonfly`
- ✅ `Nest application successfully started`
- ✅ `Application is running on: http://0.0.0.0:8088`

#### 5. Test API Health Endpoint

```bash
# Test health endpoint
curl http://localhost:8088/health

# Or open in browser
# http://localhost:8088/health
```

#### 6. Test Cache Endpoint

```bash
# Test cache info endpoint
curl http://localhost:8088/api/v1/cache

# Test with debug info
curl "http://localhost:8088/api/v1/cache?includeDebug=true"
```

**Expected Response:**
```json
{
  "health": {
    "status": "healthy",
    "ping": <number>
  },
  "metrics": {
    "keys": <number>,
    "hitRate": <number>,
    "memory": {...}
  },
  "stats": {
    "hits": <number>,
    "misses": <number>
  }
}
```

#### 7. Verify Cache Provider in Redis Commander

1. Open http://localhost:8082
2. Login: `admin` / `admin`
3. You should see both:
   - **local** (Redis) - Port 6379
   - **dragonfly** (Dragonfly) - Port 6379

### Monitoring Commands

#### Monitor All Containers

```bash
docker compose -f devops/docker/docker-compose.dev.yml ps
```

#### Monitor API Logs (Real-time)

**Bash:**
```bash
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
```

**PowerShell:**
```powershell
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
```

**Or use the monitoring scripts:**
```bash
# Bash
./devops/docker/monitor-logs.sh

# PowerShell
.\devops/docker\monitor-logs.ps1
```

#### Monitor Cache Connection

```bash
# Check Dragonfly connection
docker exec healthcare-dragonfly redis-cli -p 6379 ping

# Check Redis connection  
docker exec healthcare-redis redis-cli ping

# Check API cache configuration
docker exec healthcare-api env | grep -E "CACHE_PROVIDER|DRAGONFLY"
```

#### Monitor Cache Metrics

```bash
# Get cache info
curl http://localhost:8088/api/v1/cache

# Get cache info with debug
curl "http://localhost:8088/api/v1/cache?includeDebug=true"

# View real-time cache metrics
watch -n 2 'curl -s http://localhost:8088/api/v1/cache | jq .metrics'
```

#### Monitor All Services

```bash
docker compose -f devops/docker/docker-compose.dev.yml logs -f
```

### Success Indicators

#### ✅ API Logs Should Show:
- `✓ Dragonfly connected successfully`
- `Cache provider: dragonfly`
- `Nest application successfully started`
- `Application is running on: http://0.0.0.0:8088`

#### ✅ Container Status:
- All containers: `Up` and `healthy`
- `healthcare-dragonfly`: `(healthy)`
- `healthcare-api`: `Up` (no errors)

#### ✅ Cache Connection:
- Dragonfly ping: `PONG`
- API can connect to Dragonfly
- Cache operations work

### Error Indicators

#### ❌ Connection Errors:
- `Failed to connect to Dragonfly`
- `ECONNREFUSED`
- `Connection timeout`

#### ❌ Configuration Errors:
- `CACHE_PROVIDER not set`
- `DRAGONFLY_HOST not found`

#### ❌ Compilation Errors:
- TypeScript errors in logs
- Application won't start

## Access Points

Once all services are running:

| Service | URL | Credentials |
|---------|-----|-------------|
| **API** | http://localhost:8088 | - |
| **Swagger Docs** | http://localhost:8088/docs | - |
| **Health Check** | http://localhost:8088/health | - |
| **Queue Dashboard** | http://localhost:8088/queue-dashboard | - |
| **Cache Info** | http://localhost:8088/api/v1/cache | - |
| **Prisma Studio** | http://localhost:5555 | - |
| **PgAdmin** | http://localhost:5050 | admin@admin.com / admin |

**Session Management:**
- **Fastify Session**: Configured with CacheService/Dragonfly backend
- **Session Store**: Uses `FastifySessionStoreAdapter` with CacheService (provider-agnostic)
- **Session Timeout**: 24 hours (86400 seconds) - configurable via `SESSION_TIMEOUT`
- **Cookie Security**: Development uses `SESSION_SECURE_COOKIES=false`, production uses `true`
- **Session Secrets**: `SESSION_SECRET` and `COOKIE_SECRET` (minimum 32 characters each)
| **Redis Commander** | http://localhost:8082 | admin / admin |

## Troubleshooting

### Docker Not Running

1. Open **Docker Desktop** application
2. Wait for Docker to fully start (whale icon in system tray)
3. Ensure WSL2 integration is enabled:
   - Docker Desktop → Settings → Resources → WSL Integration
   - Enable integration with your WSL distro
   - Click "Apply & Restart"

### Containers Not Starting

```bash
# Check logs for errors
docker compose -f devops/docker/docker-compose.dev.yml logs

# Restart specific service
docker compose -f devops/docker/docker-compose.dev.yml restart api

# Rebuild and restart
docker compose -f devops/docker/docker-compose.dev.yml up -d --build --force-recreate
```

### Dragonfly Connection Issues

```bash
# Check Dragonfly container
docker ps | grep dragonfly

# Check Dragonfly logs
docker logs healthcare-dragonfly

# Test connection manually
docker exec -it healthcare-dragonfly redis-cli -p 6379 ping

# Restart Dragonfly
docker compose -f devops/docker/docker-compose.dev.yml restart dragonfly
```

### Port Conflicts

If ports are already in use, modify `docker-compose.dev.yml`:

- **8088**: Change `API_PORT` environment variable
- **5432**: Change PostgreSQL port mapping
- **6379/6380**: Change cache port mappings

### Cache Provider Not Switching

1. Check environment variable:
   ```bash
   docker exec -it healthcare-api env | grep CACHE_PROVIDER
   # Should show: CACHE_PROVIDER=dragonfly
   ```

2. Restart API container:
   ```bash
   docker compose -f devops/docker/docker-compose.dev.yml restart api
   ```

### API Not Starting

1. Check logs:
   ```bash
   docker compose -f devops/docker/docker-compose.dev.yml logs api
   ```

2. Restart API:
   ```bash
   docker compose -f devops/docker/docker-compose.dev.yml restart api
   ```

3. Rebuild if needed:
   ```bash
   docker compose -f devops/docker/docker-compose.dev.yml up -d --build api
   ```

### Health Check Failing

```bash
# Check health check command
docker exec -it healthcare-dragonfly redis-cli -p 6379 ping

# If fails, check if redis-cli is available
docker exec -it healthcare-dragonfly which redis-cli
```

## Useful Commands

### Container Management

```bash
# View all logs
docker compose -f devops/docker/docker-compose.dev.yml logs -f

# View specific service logs
docker compose -f devops/docker/docker-compose.dev.yml logs -f api
docker compose -f devops/docker/docker-compose.dev.yml logs -f dragonfly

# Stop all services
docker compose -f devops/docker/docker-compose.dev.yml down

# Stop and remove volumes (⚠️ deletes data)
docker compose -f devops/docker/docker-compose.dev.yml down -v

# Restart specific service
docker compose -f devops/docker/docker-compose.dev.yml restart api

# Shell access to API container
docker exec -it healthcare-api sh

# Shell access to Dragonfly container
docker exec -it healthcare-dragonfly sh

# Check container resource usage
docker stats
```

### Cache Operations

```bash
# Test cache set/get operations
curl -X POST http://localhost:8088/api/v1/cache/test-key \
  -H "Content-Type: application/json" \
  -d '{"value": "test-value", "ttl": 60}'

curl http://localhost:8088/api/v1/cache/test-key

# Run cache benchmark
curl -X POST "http://localhost:8088/api/v1/cache/benchmark?operations=1000&payloadSize=1024"
```

### Network Connectivity

```bash
# From API container, test connectivity
docker exec -it healthcare-api sh -c "ping -c 2 dragonfly"
docker exec -it healthcare-api sh -c "ping -c 2 redis"
```

### Environment Variables

```bash
# Check all cache-related environment variables
docker exec -it healthcare-api env | grep -E "CACHE|DRAGONFLY|REDIS"
```

**Expected Variables:**
- `CACHE_PROVIDER=dragonfly`
- `DRAGONFLY_ENABLED=true`
- `DRAGONFLY_HOST=dragonfly`
- `DRAGONFLY_PORT=6379`
- `REDIS_HOST=redis`
- `REDIS_PORT=6379`

## Cache System

### Cache Provider Configuration

The system uses **Dragonfly** as the default cache provider (26x faster than Redis). To switch providers:

1. **Change environment variable** in `docker-compose.dev.yml`:
   ```yaml
   CACHE_PROVIDER: redis  # or dragonfly
   ```

2. **Restart API container**:
   ```bash
   docker compose -f devops/docker/docker-compose.dev.yml restart api
   ```

### Cache Verification Checklist

Run through this checklist to verify the cache system:

1. ✅ All containers are running and healthy
2. ✅ `CACHE_PROVIDER=dragonfly` is set
3. ✅ API logs show successful Dragonfly connection
4. ✅ Cache operations work (set/get)
5. ✅ Cache metrics are available
6. ✅ Health endpoint returns healthy status
7. ✅ No connection errors in logs

### Cache Performance Verification

```bash
# Test cache performance
curl -X POST "http://localhost:8088/api/v1/cache/benchmark?operations=1000&payloadSize=1024"

# Monitor cache metrics
curl "http://localhost:8088/api/v1/cache?includeDebug=true" | jq .
```

## Configuration

### Environment Variables

Key environment variables can be configured in `docker-compose.dev.yml`:

**Cache Configuration:**
- `CACHE_PROVIDER`: `dragonfly` (default) or `redis`
- `DRAGONFLY_HOST`: `dragonfly` (container name)
- `DRAGONFLY_PORT`: `6379`
- `REDIS_HOST`: `redis` (container name)
- `REDIS_PORT`: `6379`

**Session Configuration (Fastify Session with CacheService/Dragonfly):**
- `SESSION_SECRET`: Session secret (minimum 32 characters) - used for Fastify session encryption
- `SESSION_TIMEOUT`: Session timeout in seconds (default: 86400 = 24 hours)
- `SESSION_SECURE_COOKIES`: `true` for production, `false` for development
- `SESSION_SAME_SITE`: Cookie SameSite policy (`strict`, `lax`, or `none`)
- `COOKIE_SECRET`: Cookie signing secret (minimum 32 characters) - used for cookie encryption

**Database Configuration:**
- `DATABASE_URL`: PostgreSQL connection string
- `NODE_ENV`: `development` or `production`

### Docker Compose File

The main configuration file is:
- `devops/docker/docker-compose.dev.yml`

Modify this file to:
- Change port mappings
- Adjust resource limits
- Modify environment variables
- Add/remove services

## Monitoring Scripts

The following scripts are available for monitoring:

- **`monitor-app.sh`**: Monitors app startup and health
- **`monitor-cache.sh`**: Monitors cache system and connections
- **`monitor-logs.sh`** / **`monitor-logs.ps1`**: Monitor API logs in real-time
- **`verify-wsl.sh`**: Comprehensive verification script for WSL users

## Next Steps

After successful startup:

1. ✅ Verify all containers are running
2. ✅ Check API logs for successful Dragonfly connection
3. ✅ Test health endpoint
4. ✅ Test cache operations
5. ✅ Monitor cache metrics
6. ✅ Start developing!

## Support

If you encounter issues:

1. Check container logs
2. Verify Docker Desktop is running
3. Ensure ports are not in use
4. Check network connectivity between containers
5. Review the troubleshooting section above

For detailed cache system documentation, see: `src/libs/infrastructure/cache/README.md`

