#!/bin/bash

# Script to verify DEV_MODE is set and database optimization is applied
# This script is run after deployment to ensure everything is working correctly

set -e

echo "🔍 Verifying DEV_MODE configuration and database optimization..."

# Check if DEV_MODE is set in the container
echo "1. Checking DEV_MODE environment variable..."
if docker exec latest-api sh -c 'echo "DEV_MODE: $DEV_MODE"' | grep -q "DEV_MODE: true"; then
    echo "✅ DEV_MODE is set to true in the container"
else
    echo "❌ DEV_MODE is not set correctly in the container"
    exit 1
fi

# Check if DEV_MODE is in the .env file
echo "2. Checking DEV_MODE in .env file..."
if docker exec latest-api sh -c 'cat /app/.env | grep DEV_MODE' | grep -q "DEV_MODE=true"; then
    echo "✅ DEV_MODE is set in .env file"
else
    echo "❌ DEV_MODE is not set in .env file"
    exit 1
fi

# Check if database indexes exist
echo "3. Checking database indexes..."
INDEXES=$(docker exec latest-postgres psql -U postgres -d userdb -c "\d+ logs" | grep -E "(logs_timestamp_idx|logs_type_idx|logs_level_idx|logs_timestamp_type_level_idx|logs_recent_idx)" | wc -l)

if [ "$INDEXES" -ge 4 ]; then
    echo "✅ Database indexes are properly created ($INDEXES indexes found)"
else
    echo "❌ Database indexes are missing (found $INDEXES indexes, expected at least 4)"
    exit 1
fi

# Test the new endpoints
echo "4. Testing new endpoints..."
if curl -s http://localhost:8088/api-health | grep -q '"status"'; then
    echo "✅ /api-health endpoint is working"
else
    echo "❌ /api-health endpoint is not working"
    exit 1
fi

if curl -s http://localhost:8088/api | grep -q '"status"'; then
    echo "✅ /api endpoint is working"
else
    echo "❌ /api endpoint is not working"
    exit 1
fi

if curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/favicon.ico | grep -q "204"; then
    echo "✅ /favicon.ico endpoint is working"
else
    echo "❌ /favicon.ico endpoint is not working"
    exit 1
fi

# Test that rate limiting is relaxed in DEV_MODE
echo "5. Testing rate limiting in DEV_MODE..."
# Make multiple rapid requests to test rate limiting
for i in {1..20}; do
    curl -s http://localhost:8088/health > /dev/null &
done
wait

# Check if we can still make requests (should not be rate limited in DEV_MODE)
if curl -s http://localhost:8088/health | grep -q '"status"'; then
    echo "✅ Rate limiting is relaxed in DEV_MODE"
else
    echo "❌ Rate limiting is still active despite DEV_MODE"
    exit 1
fi

echo "🎉 All verifications passed! DEV_MODE is properly configured and database optimization is applied."
echo "📊 Summary:"
echo "   - DEV_MODE is set to true"
echo "   - Database indexes are created"
echo "   - New endpoints are working"
echo "   - Rate limiting is relaxed"
echo "   - Ready for development testing" 