# Quick Start - Local App Testing

## Prerequisites
- Node.js installed (check with `node --version`)
- pnpm installed (check with `pnpm --version`)
- PostgreSQL running on `localhost:5432` (optional - app will show connection errors if not available)
- Redis running on `localhost:6379` (optional - app will show connection errors if not available)

## Quick Start

### Option 1: Using the test script (Recommended)
```bash
cd /mnt/d/project/Healthcare/HealthCareBackend
chmod +x run-local-test.sh
./run-local-test.sh
```

### Option 2: Manual startup
```bash
cd /mnt/d/project/Healthcare/HealthCareBackend

# Set environment variables
export NODE_ENV="development"
export PORT="8088"
export API_URL="http://localhost:8088"
export SWAGGER_URL="/docs"
export BULL_BOARD_URL="/queue-dashboard"
export SOCKET_URL="/socket.io"
export LOG_LEVEL="debug"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/userdb?schema=public"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export JWT_SECRET="local-dev-jwt-secret-test"

# Start the app
pnpm start:dev
```

## What to Watch For

✅ **Success Indicators:**
- No `UndefinedDependencyException` errors
- No `UndefinedModuleException` errors
- Application starts successfully
- Server listening on `http://localhost:8088`
- Swagger docs available at `http://localhost:8088/docs`

⚠️ **Expected Warnings (OK if services not running):**
- Database connection errors (if PostgreSQL not running)
- Redis connection errors (if Redis not running)
- These are expected and won't prevent the app from starting

## Access Points

- **API**: http://localhost:8088
- **Swagger Docs**: http://localhost:8088/docs
- **Health Check**: http://localhost:8088/health
- **Queue Dashboard**: http://localhost:8088/queue-dashboard

## Troubleshooting

1. **Node.js not found**: Install Node.js or adjust PATH in the script
2. **pnpm not found**: Run `npm install -g pnpm`
3. **Port 8088 already in use**: Change PORT environment variable
4. **Module errors**: Check that all dependencies are installed (`pnpm install`)



