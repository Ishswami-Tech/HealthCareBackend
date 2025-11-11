#!/bin/bash
# Monitor Healthcare Backend App Startup
# This script monitors all services and waits for the app to start successfully

echo "🔍 Healthcare Backend - App Startup Monitor"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if containers are running
echo "📊 Checking container status..."
docker compose -f devops/docker/docker-compose.dev.yml ps
echo ""

# Function to check API health
check_api_health() {
    if curl -f -s http://localhost:8088/health > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to check for errors in logs
check_for_errors() {
    local logs=$(docker compose -f devops/docker/docker-compose.dev.yml logs api --tail=50 2>&1)
    if echo "$logs" | grep -qi "error\|exception\|undefined\|failed"; then
        return 1
    else
        return 0
    fi
}

# Function to check if app started successfully
check_app_started() {
    local logs=$(docker compose -f devops/docker/docker-compose.dev.yml logs api --tail=100 2>&1)
    if echo "$logs" | grep -qi "Nest application successfully started\|Application is running on"; then
        return 0
    else
        return 1
    fi
}

echo "⏳ Waiting for application to start..."
echo "   (This may take 30-60 seconds for initial compilation)"
echo ""

MAX_WAIT=120  # Maximum wait time in seconds
ELAPSED=0
CHECK_INTERVAL=5

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Check for errors first
    if ! check_for_errors; then
        echo -e "${RED}❌ Errors detected in logs!${NC}"
        echo ""
        echo "Recent error logs:"
        docker compose -f devops/docker/docker-compose.dev.yml logs api --tail=30 | grep -i "error\|exception\|undefined" | tail -10
        echo ""
        echo "Full recent logs:"
        docker compose -f devops/docker/docker-compose.dev.yml logs api --tail=50
        exit 1
    fi
    
    # Check if app started
    if check_app_started; then
        echo -e "${GREEN}✅ Application started successfully!${NC}"
        echo ""
        
        # Check API health
        if check_api_health; then
            echo -e "${GREEN}✅ API health check passed!${NC}"
            echo ""
            echo "🌐 Access Points:"
            echo "   - API:              http://localhost:8088"
            echo "   - Swagger Docs:     http://localhost:8088/docs"
            echo "   - Health Check:     http://localhost:8088/health"
            echo "   - Queue Dashboard:  http://localhost:8088/queue-dashboard"
            echo ""
            
            # Show health check response
            echo "📋 Health Check Response:"
            curl -s http://localhost:8088/health | head -10
            echo ""
            
            exit 0
        else
            echo -e "${YELLOW}⚠️  App started but health check not responding yet...${NC}"
        fi
    fi
    
    echo -n "."
    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

echo ""
echo -e "${RED}❌ Timeout waiting for application to start${NC}"
echo ""
echo "Recent logs:"
docker compose -f devops/docker/docker-compose.dev.yml logs api --tail=100
exit 1

