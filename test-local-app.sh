#!/usr/bin/env bash
# Test local app startup
# Prerequisites: PostgreSQL and Redis should be running (Docker Desktop or local)

set -uo pipefail

cd "$(dirname "$0")"

echo "🧪 Healthcare Backend - Local App Test"
echo "======================================"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm not found. Installing pnpm..."
    npm install -g pnpm
fi
echo "✅ pnpm: $(pnpm --version)"

# Check PostgreSQL (optional - will show connection errors if not available)
if command -v pg_isready &> /dev/null; then
    if pg_isready -h localhost -p 5432 -U postgres &> /dev/null; then
        echo "✅ PostgreSQL is accessible"
    else
        echo "⚠️  PostgreSQL not accessible (will show connection errors)"
    fi
else
    echo "⚠️  pg_isready not available (skipping PostgreSQL check)"
fi

# Check Redis (optional - will show connection errors if not available)
if command -v redis-cli &> /dev/null; then
    if redis-cli -h localhost -p 6379 ping &> /dev/null; then
        echo "✅ Redis is accessible"
    else
        echo "⚠️  Redis not accessible (will show connection errors)"
    fi
else
    echo "⚠️  redis-cli not available (skipping Redis check)"
fi

echo ""
echo "📋 Setting environment variables for local development..."
echo ""

# Set environment variables for local development
export NODE_ENV="development"
export PORT="8088"
export API_URL="http://localhost:8088"
export SWAGGER_URL="/docs"
export BULL_BOARD_URL="/queue-dashboard"
export SOCKET_URL="/socket.io"
export LOG_LEVEL="debug"
export ENABLE_DEBUG="true"
export CORS_ORIGIN="http://localhost:3000"

# Database configuration (adjust if needed)
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/userdb?schema=public}"

# Redis configuration (adjust if needed)
export REDIS_HOST="${REDIS_HOST:-localhost}"
export REDIS_PORT="${REDIS_PORT:-6379}"

# JWT Secret (use a default for local dev)
export JWT_SECRET="${JWT_SECRET:-local-dev-jwt-secret-$(date +%s)}"

echo "   NODE_ENV: $NODE_ENV"
echo "   PORT: $PORT"
echo "   API_URL: $API_URL"
echo "   DATABASE_URL: $DATABASE_URL"
echo "   REDIS_HOST: $REDIS_HOST"
echo "   REDIS_PORT: $REDIS_PORT"
echo ""

echo "🚀 Starting application..."
echo "   Watch for:"
echo "   ✅ No 'UndefinedDependencyException' errors"
echo "   ✅ No 'UndefinedModuleException' errors"
echo "   ✅ Application starts successfully on http://localhost:8088"
echo "   ✅ Swagger docs available at http://localhost:8088/docs"
echo "   ⚠️  Database/Redis connection errors are OK if services not running"
echo ""

# Start the app
pnpm start:dev

