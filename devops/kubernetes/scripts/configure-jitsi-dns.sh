#!/usr/bin/env bash
# Script to help configure DNS for Jitsi Meet

set -euo pipefail

echo "🌐 Jitsi Meet DNS Configuration Guide"
echo ""

# Get cluster IP or load balancer IP
echo "📋 Getting cluster information..."

# Try to get ingress controller external IP
INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

if [ -z "$INGRESS_IP" ]; then
    # Try alternative ingress controller names
    INGRESS_IP=$(kubectl get svc -A -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' 2>/dev/null | head -n1 || echo "")
fi

if [ -z "$INGRESS_IP" ]; then
    # Get node IPs
    NODE_IPS=$(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null || \
               kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "")
    
    if [ -n "$NODE_IPS" ]; then
        INGRESS_IP=$(echo "$NODE_IPS" | awk '{print $1}')
    fi
fi

echo ""
echo "📍 DNS Configuration Instructions:"
echo ""
echo "1. Add A record for meet.ishswami.in:"
if [ -n "$INGRESS_IP" ]; then
    echo "   Type: A"
    echo "   Name: meet"
    echo "   Value: $INGRESS_IP"
    echo "   TTL: 300 (or your preferred TTL)"
else
    echo "   Type: A"
    echo "   Name: meet"
    echo "   Value: <YOUR_CLUSTER_IP_OR_LOAD_BALANCER_IP>"
    echo "   TTL: 300 (or your preferred TTL)"
    echo ""
    echo "   To find your cluster IP, run:"
    echo "   kubectl get svc -A | grep LoadBalancer"
    echo "   kubectl get nodes -o wide"
fi

echo ""
echo "2. Verify DNS propagation:"
echo "   dig meet.ishswami.in"
echo "   nslookup meet.ishswami.in"
echo "   host meet.ishswami.in"
echo ""

echo "3. For Contabo VPS:"
echo "   - Log in to your DNS provider (e.g., Cloudflare, Contabo DNS)"
echo "   - Add A record: meet -> $INGRESS_IP"
echo "   - Wait for DNS propagation (usually 5-15 minutes)"
echo ""

echo "4. Test DNS after configuration:"
echo "   curl -I https://meet.ishswami.in"
echo ""

if [ -n "$INGRESS_IP" ]; then
    echo "✅ Detected cluster IP: $INGRESS_IP"
    echo "   Use this IP for your DNS A record"
else
    echo "⚠️  Could not automatically detect cluster IP"
    echo "   Please manually find your cluster's external IP"
fi
