#!/bin/bash
# Quick status check script for Docker services

echo "🔍 Checking Docker Services Status..."
echo "======================================"
echo ""

# Check container status
echo "📊 Container Status:"
docker compose -f devops/docker/docker-compose.dev.yml ps
echo ""

# Check API logs for errors
echo "🔍 Checking API logs for errors (last 50 lines)..."
echo "---------------------------------------------------"
docker compose -f devops/docker/docker-compose.dev.yml logs --tail=50 api | grep -i "error\|exception\|undefined\|listening\|started\|application" || echo "No recent errors or startup messages found"
echo ""

# Check if API is responding
echo "🌐 Testing API Health Endpoint..."
if curl -f -s http://localhost:8088/health > /dev/null 2>&1; then
    echo "✅ API is responding at http://localhost:8088/health"
    curl -s http://localhost:8088/health | head -5
else
    echo "❌ API is not responding yet"
fi
echo ""

# Show recent API logs
echo "📋 Recent API Logs (last 20 lines):"
echo "-----------------------------------"
docker compose -f devops/docker/docker-compose.dev.yml logs --tail=20 api

