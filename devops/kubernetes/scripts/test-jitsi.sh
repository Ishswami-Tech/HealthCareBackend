#!/usr/bin/env bash
# Script to test Jitsi Meet deployment

set -euo pipefail

JITSI_DOMAIN="${1:-meet.ishswami.in}"

echo "🧪 Testing Jitsi Meet Deployment"
echo "   Domain: $JITSI_DOMAIN"
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if connected to cluster
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Not connected to Kubernetes cluster"
    exit 1
fi

echo "1️⃣  Checking Jitsi Pods..."
PODS=$(kubectl get pods -n healthcare-backend -l app=jitsi --no-headers 2>/dev/null || echo "")

if [ -z "$PODS" ]; then
    echo "❌ No Jitsi pods found"
    exit 1
fi

echo "$PODS" | while read -r line; do
    POD_NAME=$(echo "$line" | awk '{print $1}')
    STATUS=$(echo "$line" | awk '{print $3}')
    READY=$(echo "$line" | awk '{print $2}')
    
    if [ "$STATUS" = "Running" ] && [[ "$READY" =~ ^[0-9]+/[0-9]+$ ]]; then
        echo "   ✅ $POD_NAME: $STATUS ($READY)"
    else
        echo "   ⚠️  $POD_NAME: $STATUS ($READY)"
    fi
done

echo ""
echo "2️⃣  Checking Jitsi Services..."
kubectl get svc -n healthcare-backend -l app=jitsi

echo ""
echo "3️⃣  Checking Ingress..."
INGRESS=$(kubectl get ingress healthcare-ingress -n healthcare-backend -o jsonpath='{.spec.rules[*].host}' 2>/dev/null || echo "")
if echo "$INGRESS" | grep -q "$JITSI_DOMAIN"; then
    echo "   ✅ Ingress configured for $JITSI_DOMAIN"
else
    echo "   ⚠️  Ingress may not be configured for $JITSI_DOMAIN"
fi

echo ""
echo "4️⃣  Testing Pod Health..."
echo "   Prosody:"
kubectl exec -n healthcare-backend deployment/jitsi-prosody -- prosodyctl status 2>/dev/null || echo "   ⚠️  Could not check Prosody status"

echo ""
echo "   JVB Health:"
JVB_POD=$(kubectl get pods -n healthcare-backend -l component=jvb -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$JVB_POD" ]; then
    kubectl exec -n healthcare-backend "$JVB_POD" -- curl -s http://localhost:8080/about/health 2>/dev/null | head -n 5 || echo "   ⚠️  Could not check JVB health"
else
    echo "   ⚠️  No JVB pod found"
fi

echo ""
echo "5️⃣  Testing Web Interface..."
if command -v curl &> /dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$JITSI_DOMAIN" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
        echo "   ✅ Web interface accessible (HTTP $HTTP_CODE)"
    else
        echo "   ⚠️  Web interface returned HTTP $HTTP_CODE"
        echo "   Check DNS configuration and ingress"
    fi
else
    echo "   ⚠️  curl not available, skipping web interface test"
fi

echo ""
echo "6️⃣  Checking RTP Port (UDP 30000)..."
JVB_SVC=$(kubectl get svc jitsi-jvb -n healthcare-backend -o jsonpath='{.spec.ports[?(@.name=="rtp-udp")].nodePort}' 2>/dev/null || echo "")
if [ "$JVB_SVC" = "30000" ]; then
    echo "   ✅ JVB NodePort configured: $JVB_SVC"
else
    echo "   ⚠️  JVB NodePort: $JVB_SVC (expected: 30000)"
fi

echo ""
echo "7️⃣  Recent Pod Logs (last 5 lines each):"
echo "   Prosody:"
kubectl logs -n healthcare-backend deployment/jitsi-prosody --tail=5 2>/dev/null | sed 's/^/      /' || echo "      No logs available"

echo ""
echo "   Web:"
kubectl logs -n healthcare-backend deployment/jitsi-web --tail=5 2>/dev/null | sed 's/^/      /' || echo "      No logs available"

echo ""
echo "   Jicofo:"
kubectl logs -n healthcare-backend deployment/jitsi-jicofo --tail=5 2>/dev/null | sed 's/^/      /' || echo "      No logs available"

echo ""
echo "   JVB:"
kubectl logs -n healthcare-backend deployment/jitsi-jvb --tail=5 2>/dev/null | sed 's/^/      /' || echo "      No logs available"

echo ""
echo "📋 Summary:"
echo "   - Pods: Check status above"
echo "   - Services: Check services above"
echo "   - Ingress: Check ingress configuration"
echo "   - DNS: Verify $JITSI_DOMAIN points to your cluster"
echo "   - Firewall: Ensure UDP port 30000 is open"
echo ""
echo "🔗 Test in browser:"
echo "   https://$JITSI_DOMAIN"
echo ""
echo "📚 For more details, see: devops/kubernetes/JITSI_SETUP.md"
