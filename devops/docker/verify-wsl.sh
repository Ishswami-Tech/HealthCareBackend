#!/bin/bash
# Cache System Verification Script for WSL
# Run this in WSL to verify cache system is working

echo "🔍 Verifying Cache System..."
echo "=============================="
echo ""

# Check container status
echo "📊 Container Status:"
docker compose -f devops/docker/docker-compose.dev.yml ps
echo ""

# Check Dragonfly connection
echo "🐉 Testing Dragonfly Connection:"
if docker exec healthcare-dragonfly redis-cli -p 6379 ping 2>/dev/null | grep -q PONG; then
    echo "✅ Dragonfly is responding (PONG)"
else
    echo "❌ Dragonfly is not responding"
fi
echo ""

# Check Redis connection
echo "🔴 Testing Redis Connection:"
if docker exec healthcare-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "✅ Redis is responding (PONG)"
else
    echo "❌ Redis is not responding"
fi
echo ""

# Check API environment variables
echo "⚙️  API Cache Configuration:"
docker exec healthcare-api sh -c 'env | grep -E "CACHE_PROVIDER|DRAGONFLY|REDIS" | sort'
echo ""

# Check API logs for cache connection
echo "📝 Recent Cache-Related API Logs:"
docker compose -f devops/docker/docker-compose.dev.yml logs api --tail 100 | grep -i "dragonfly\|cache\|provider" | tail -10 || echo "No cache-related logs found yet"
echo ""

# Test API health endpoint
echo "🏥 Testing API Health:"
if curl -s http://localhost:8088/health > /dev/null 2>&1; then
    echo "✅ API is responding"
    curl -s http://localhost:8088/health | head -5
else
    echo "⏳ API is still starting up..."
fi
echo ""

# Test cache endpoint
echo "💾 Testing Cache Endpoint:"
if curl -s http://localhost:8088/api/v1/cache > /dev/null 2>&1; then
    echo "✅ Cache endpoint is responding"
    curl -s http://localhost:8088/api/v1/cache | head -10
else
    echo "⏳ Cache endpoint not ready yet (API may still be starting)"
fi
echo ""

echo "✅ Verification Complete!"
echo ""
echo "📋 Summary:"
echo "  - All containers should be 'Up' and 'healthy'"
echo "  - CACHE_PROVIDER should be 'dragonfly'"
echo "  - Dragonfly should respond with PONG"
echo "  - API should be accessible at http://localhost:8088"
echo ""

