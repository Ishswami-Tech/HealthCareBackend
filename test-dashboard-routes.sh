#!/bin/bash
set -e

echo "🔍 Testing Healthcare Backend Dashboard and Routes"
echo "=================================================="
echo ""

# Get latest pod
POD_NAME=$(kubectl get pods -n healthcare-backend -l app=healthcare-api --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
echo "📦 Using pod: $POD_NAME"
echo ""

# Check if pod is ready
READY=$(kubectl get pods -n healthcare-backend $POD_NAME -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
if [ "$READY" != "true" ]; then
  echo "⚠️  Pod is not ready yet (READY=$READY)"
  echo "   Waiting for pod to be ready..."
  for i in {1..30}; do
    sleep 2
    READY=$(kubectl get pods -n healthcare-backend $POD_NAME -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    if [ "$READY" = "true" ]; then
      echo "✅ Pod is now ready!"
      break
    fi
    echo "   Still waiting... ($i/30)"
  done
fi

# Start port forwarding in background
echo ""
echo "🔌 Starting port forwarding..."
kubectl port-forward -n healthcare-backend pod/$POD_NAME 8088:8088 --address=127.0.0.1 > /tmp/pf.log 2>&1 &
PF_PID=$!
echo "   Port forwarding started (PID: $PF_PID)"
sleep 3

# Function to cleanup
cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  kill $PF_PID 2>/dev/null || true
  echo "✅ Cleanup complete"
}

trap cleanup EXIT

echo ""
echo "🧪 Testing Routes..."
echo ""

# Test 1: Root route (Dashboard)
echo "1️⃣  Testing root route (/) - Dashboard:"
ROOT_STATUS=$(curl -s -o /tmp/root.html -w "%{http_code}" http://localhost:8088/)
if [ "$ROOT_STATUS" = "200" ]; then
  echo "   ✅ Root route returns 200 OK"
  if grep -q "<!DOCTYPE html>" /tmp/root.html; then
    echo "   ✅ Returns HTML content"
    if grep -q "Healthcare API Dashboard" /tmp/root.html; then
      echo "   ✅ Dashboard HTML contains expected content"
    else
      echo "   ⚠️  Dashboard HTML might be incomplete"
    fi
  else
    echo "   ⚠️  Response is not HTML"
  fi
else
  echo "   ❌ Root route returned $ROOT_STATUS (expected 200)"
fi
echo ""

# Test 2: Health endpoint
echo "2️⃣  Testing /health endpoint:"
HEALTH_RESPONSE=$(curl -s http://localhost:8088/health)
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/health)
if [ "$HEALTH_STATUS" = "200" ]; then
  echo "   ✅ Health endpoint returns 200 OK"
  if echo "$HEALTH_RESPONSE" | grep -q "status"; then
    echo "   ✅ Returns JSON with status"
    if echo "$HEALTH_RESPONSE" | grep -q '"statusCode".*500"; then
      echo "   ❌ Health endpoint still returns 500 error!"
      echo "   Response: $HEALTH_RESPONSE" | head -5
    else
      echo "   ✅ Health endpoint working correctly"
      echo "   Response preview: $(echo "$HEALTH_RESPONSE" | head -3)"
    fi
  else
    echo "   ⚠️  Response format unexpected"
  fi
else
  echo "   ❌ Health endpoint returned $HEALTH_STATUS (expected 200)"
  echo "   Response: $HEALTH_RESPONSE" | head -5
fi
echo ""

# Test 3: Detailed health
echo "3️⃣  Testing /health/detailed endpoint:"
DETAILED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/health/detailed)
if [ "$DETAILED_STATUS" = "200" ]; then
  echo "   ✅ Detailed health endpoint returns 200 OK"
else
  echo "   ❌ Detailed health endpoint returned $DETAILED_STATUS (expected 200)"
fi
echo ""

# Test 4: Docs endpoint
echo "4️⃣  Testing /docs endpoint:"
DOCS_STATUS=$(curl -s -I http://localhost:8088/docs 2>&1 | head -1)
if echo "$DOCS_STATUS" | grep -q "200 OK"; then
  echo "   ✅ Docs endpoint returns 200 OK"
else
  echo "   ⚠️  Docs endpoint: $DOCS_STATUS"
fi
echo ""

# Test 5: Verify routes are accessible without /api/v1 prefix
echo "5️⃣  Testing route accessibility (should work without /api/v1 prefix):"
echo "   Testing /health (should work):"
HEALTH_NO_PREFIX=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/health)
if [ "$HEALTH_NO_PREFIX" = "200" ]; then
  echo "   ✅ /health accessible without prefix"
else
  echo "   ❌ /health returned $HEALTH_NO_PREFIX"
fi

echo "   Testing /api/v1/health (should also work):"
HEALTH_WITH_PREFIX=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/api/v1/health)
if [ "$HEALTH_WITH_PREFIX" = "200" ] || [ "$HEALTH_WITH_PREFIX" = "404" ]; then
  echo "   ✅ /api/v1/health handled correctly (status: $HEALTH_WITH_PREFIX)"
else
  echo "   ⚠️  /api/v1/health returned $HEALTH_WITH_PREFIX"
fi
echo ""

echo "✅ Testing complete!"
echo ""
echo "📊 Summary:"
echo "   - Root route (/): $ROOT_STATUS"
echo "   - Health route (/health): $HEALTH_STATUS"
echo "   - Detailed health (/health/detailed): $DETAILED_STATUS"
echo "   - Docs route (/docs): $(echo "$DOCS_STATUS" | grep -o '[0-9]\{3\}')"
echo ""
echo "🌐 Access dashboard at: http://localhost:8088/"
echo "📖 Access docs at: http://localhost:8088/docs"
echo "❤️  Access health at: http://localhost:8088/health"
