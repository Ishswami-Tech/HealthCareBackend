#!/bin/bash
# Quick Start Script for Docker Development Environment
# This script helps you start the Healthcare Backend in Docker
# Works best in WSL2 on Windows, but also works on Linux/Mac

set -e

echo "🏥 Healthcare Backend - Docker Development Setup"
echo "=================================================="
echo ""

# Detect if running in WSL
if [ -f /proc/version ] && grep -q "microsoft" /proc/version; then
    echo "✅ Running in WSL2 (Windows Subsystem for Linux)"
    echo "   This is the recommended environment for Docker on Windows"
    echo ""
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop on Windows and try again."
    echo ""
    echo "💡 Steps to fix:"
    echo "   1. Open Docker Desktop application on Windows"
    echo "   2. Wait for Docker Desktop to fully start (whale icon in system tray)"
    echo "   3. Ensure WSL2 integration is enabled:"
    echo "      Docker Desktop → Settings → Resources → WSL Integration"
    echo "      → Enable integration with your WSL distro (Ubuntu, etc.)"
    echo "   4. Click 'Apply & Restart' if you made changes"
    echo "   5. Run this script again"
    echo ""
    echo "   Note: Docker Desktop must be running on Windows for WSL2 to use Docker"
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Navigate to project root (assuming script is in devops/docker)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

echo "📁 Project root: $PROJECT_ROOT"
echo ""

# Check if docker-compose file exists
COMPOSE_FILE="devops/docker/docker-compose.dev.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ Docker compose file not found: $COMPOSE_FILE"
    exit 1
fi

echo "📋 Starting services..."
echo ""

# Stop any existing containers
echo "🛑 Stopping existing containers (if any)..."
docker-compose -f "$COMPOSE_FILE" down 2>/dev/null || true

# Build and start containers
echo "🔨 Building and starting containers..."
docker-compose -f "$COMPOSE_FILE" up -d --build

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check service status
echo ""
echo "📊 Service Status:"
docker-compose -f "$COMPOSE_FILE" ps

echo ""
echo "✅ Services started successfully!"
echo ""
echo "🌐 Access Points:"
echo "   - API:              http://localhost:8088"
echo "   - Swagger Docs:     http://localhost:8088/docs"
echo "   - Health Check:     http://localhost:8088/health"
echo "   - Queue Dashboard:  http://localhost:8088/queue-dashboard"
echo "   - Prisma Studio:    http://localhost:5555"
echo "   - PgAdmin:          http://localhost:5050 (admin@admin.com / admin)"
echo "   - Redis Commander:  http://localhost:8082 (admin / admin)"
echo ""
echo "📝 Useful Commands:"
echo "   - View logs:        docker-compose -f $COMPOSE_FILE logs -f api"
echo "   - Stop services:    docker-compose -f $COMPOSE_FILE down"
echo "   - Restart API:      docker-compose -f $COMPOSE_FILE restart api"
echo "   - Shell access:     docker exec -it healthcare-api sh"
echo ""
echo "🔍 Viewing API logs..."
echo "   (Press Ctrl+C to stop viewing logs, containers will continue running)"
echo ""
sleep 2

# Follow API logs
docker-compose -f "$COMPOSE_FILE" logs -f api

