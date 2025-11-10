#!/usr/bin/env bash
# Run API locally while using PostgreSQL and Redis from Kubernetes
# This script sets up port-forwarding and starts the app

set -uo pipefail

cd "$(dirname "$0")"

echo "🧪 Healthcare Backend - Local API with K8s Database"
echo "==================================================="
echo ""

# Set up Node.js path
export PATH="/mnt/c/Program Files/nodejs:$PATH"

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! node --version &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js or adjust PATH"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# Check pnpm
if ! pnpm --version &> /dev/null; then
    echo "❌ pnpm not found. Installing pnpm..."
    npm install -g pnpm
fi
echo "✅ pnpm: $(pnpm --version)"

# Check kubectl
if ! kubectl version --client &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl"
    exit 1
fi
echo "✅ kubectl found"

# Check if services exist in Kubernetes
echo ""
echo "📋 Checking Kubernetes services..."
if ! kubectl get svc -n healthcare-backend postgres &> /dev/null; then
    echo "❌ PostgreSQL service not found in healthcare-backend namespace"
    echo "   Please deploy to Kubernetes first: ./devops/kubernetes/scripts/deploy-direct.sh"
    exit 1
fi
echo "✅ PostgreSQL service found"

if ! kubectl get svc -n healthcare-backend redis &> /dev/null; then
    echo "❌ Redis service not found in healthcare-backend namespace"
    echo "   Please deploy to Kubernetes first: ./devops/kubernetes/scripts/deploy-direct.sh"
    exit 1
fi
echo "✅ Redis service found"

echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up port-forwards..."
    if [ -n "${POSTGRES_PF_PID:-}" ]; then
        kill $POSTGRES_PF_PID 2>/dev/null || true
    fi
    if [ -n "${REDIS_PF_PID:-}" ]; then
        kill $REDIS_PF_PID 2>/dev/null || true
    fi
    # Also kill any existing kubectl port-forward processes
    pkill -f "kubectl port-forward.*postgres" 2>/dev/null || true
    pkill -f "kubectl port-forward.*redis" 2>/dev/null || true
    echo "✅ Cleanup complete"
}

# Set up trap for cleanup on exit
trap cleanup EXIT INT TERM

# Kill any existing port-forwards on these ports
echo "🔍 Checking for existing port-forwards..."
pkill -f "kubectl port-forward.*postgres.*5432" 2>/dev/null && echo "   Killed existing PostgreSQL port-forward" || true
pkill -f "kubectl port-forward.*redis.*6379" 2>/dev/null && echo "   Killed existing Redis port-forward" || true
sleep 1

# Start port-forwarding for PostgreSQL
echo "🔌 Setting up port-forwarding..."
echo "   Forwarding PostgreSQL (localhost:5432 -> k8s postgres:5432)"
kubectl port-forward -n healthcare-backend svc/postgres 5432:5432 > /tmp/k8s-postgres-forward.log 2>&1 &
POSTGRES_PF_PID=$!

# Start port-forwarding for Redis
echo "   Forwarding Redis (localhost:6379 -> k8s redis:6379)"
kubectl port-forward -n healthcare-backend svc/redis 6379:6379 > /tmp/k8s-redis-forward.log 2>&1 &
REDIS_PF_PID=$!

echo "   Port-forward PIDs: PostgreSQL=$POSTGRES_PF_PID, Redis=$REDIS_PF_PID"
echo ""

# Wait a moment for port-forwarding to establish
echo "⏳ Waiting for port-forwarding to establish..."
sleep 3

# Verify port-forwarding is working
if ! nc -z localhost 5432 2>/dev/null && ! command -v nc &> /dev/null; then
    echo "⚠️  Cannot verify PostgreSQL port-forward (nc not available)"
elif ! nc -z localhost 5432 2>/dev/null; then
    echo "⚠️  PostgreSQL port-forward may not be working (port 5432 not accessible)"
else
    echo "✅ PostgreSQL port-forward is active"
fi

if ! nc -z localhost 6379 2>/dev/null && ! command -v nc &> /dev/null; then
    echo "⚠️  Cannot verify Redis port-forward (nc not available)"
elif ! nc -z localhost 6379 2>/dev/null; then
    echo "⚠️  Redis port-forward may not be working (port 6379 not accessible)"
else
    echo "✅ Redis port-forward is active"
fi

echo ""

# Set environment variables pointing to localhost (will be port-forwarded)
export NODE_ENV="development"
export PORT="8088"
export API_URL="http://localhost:8088"
export SWAGGER_URL="/docs"
export BULL_BOARD_URL="/queue-dashboard"
export SOCKET_URL="/socket.io"
export LOG_LEVEL="debug"
export ENABLE_DEBUG="true"
export CORS_ORIGIN="http://localhost:3000"

# Database configuration - pointing to localhost (port-forwarded)
# Get credentials from Kubernetes secrets
POSTGRES_PASSWORD=$(kubectl get secret healthcare-secrets -n healthcare-backend -o jsonpath='{.data.postgres-password}' 2>/dev/null | base64 -d 2>/dev/null || echo "postgres123")
export DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/userdb?schema=public"

# Redis configuration - pointing to localhost (port-forwarded)
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
REDIS_PASSWORD=$(kubectl get secret healthcare-secrets -n healthcare-backend -o jsonpath='{.data.redis-password}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [ -n "$REDIS_PASSWORD" ]; then
    export REDIS_PASSWORD="$REDIS_PASSWORD"
fi

# JWT Secret
export JWT_SECRET="local-dev-jwt-secret-$(date +%s)"

echo "📋 Environment configured:"
echo "   NODE_ENV: $NODE_ENV"
echo "   PORT: $PORT"
echo "   API_URL: $API_URL"
echo "   DATABASE_URL: postgresql://postgres:***@localhost:5432/userdb?schema=public"
echo "   REDIS_HOST: $REDIS_HOST"
echo "   REDIS_PORT: $REDIS_PORT"
echo ""

echo "🚀 Starting Healthcare Backend application..."
echo "   Watch for:"
echo "   ✅ No 'UndefinedDependencyException' errors"
echo "   ✅ No 'UndefinedModuleException' errors"
echo "   ✅ Application starts successfully on http://localhost:8088"
echo "   ✅ Swagger docs available at http://localhost:8088/docs"
echo ""
echo "   Port-forwards are running in background"
echo "   Press Ctrl+C to stop the app and cleanup port-forwards"
echo ""

# Start the app
pnpm start:dev

