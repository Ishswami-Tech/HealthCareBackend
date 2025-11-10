#!/usr/bin/env bash
# Check if app started successfully by looking for common error patterns

cd "$(dirname "$0")"

echo "Checking for common startup errors..."
echo ""

# Check if port 8088 is listening
if command -v netstat &> /dev/null; then
    if netstat -tuln 2>/dev/null | grep -q ":8088"; then
        echo "✅ Port 8088 is listening"
    else
        echo "⚠️  Port 8088 is not listening"
    fi
fi

echo ""
echo "To check app status manually:"
echo "1. Check if process is running: ps aux | grep node"
echo "2. Check if port is open: netstat -tuln | grep 8088"
echo "3. Try accessing: curl http://localhost:8088/health"
echo "4. Check Swagger: curl http://localhost:8088/docs"



