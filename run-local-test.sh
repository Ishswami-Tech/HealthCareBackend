#!/usr/bin/env bash
# Run local app test with proper environment setup

set -uo pipefail

cd "$(dirname "$0")"

# Set up Node.js path
export PATH="/mnt/c/Program Files/nodejs:$PATH"

# Check Node.js
if ! node --version &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js or adjust PATH"
    exit 1
fi

echo "✅ Node.js: $(node --version)"
echo ""

# Set environment variables
export NODE_ENV="development"
export PORT="8088"
export API_URL="http://localhost:8088"
export SWAGGER_URL="/docs"
export BULL_BOARD_URL="/queue-dashboard"
export SOCKET_URL="/socket.io"
export LOG_LEVEL="debug"
export ENABLE_DEBUG="true"
export CORS_ORIGIN="http://localhost:3000"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/userdb?schema=public"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export JWT_SECRET="local-dev-jwt-secret-test"

echo "🚀 Starting Healthcare Backend..."
echo "   Environment: development"
echo "   Port: 8088"
echo "   API URL: http://localhost:8088"
echo "   Swagger: http://localhost:8088/docs"
echo ""
echo "   Watch for errors below..."
echo "   Press Ctrl+C to stop"
echo ""

# Start the app
yarn start:dev



