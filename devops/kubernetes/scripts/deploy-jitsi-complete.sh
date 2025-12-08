#!/usr/bin/env bash
# Complete Jitsi Meet deployment script
# This script automates all deployment steps

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Complete Jitsi Meet Deployment"
echo "=================================="
echo ""

# Step 1: Generate secrets
echo "Step 1/5: Generating Jitsi secrets..."
"$SCRIPT_DIR/generate-jitsi-secrets.sh"
echo ""

# Step 2: Deploy Jitsi
echo "Step 2/5: Deploying Jitsi services..."
"$SCRIPT_DIR/deploy-jitsi.sh"
echo ""

# Step 3: DNS Configuration
echo "Step 3/5: DNS Configuration..."
"$SCRIPT_DIR/configure-jitsi-dns.sh"
echo ""

# Step 4: Firewall Configuration
echo "Step 4/5: Firewall Configuration..."
"$SCRIPT_DIR/configure-jitsi-firewall.sh"
echo ""

# Step 5: Test deployment
echo "Step 5/5: Testing deployment..."
sleep 10  # Wait a bit for services to stabilize
"$SCRIPT_DIR/test-jitsi.sh"
echo ""

echo "✅ Deployment process completed!"
echo ""
echo "📋 Manual Steps Required:"
echo "   1. Configure DNS: Add A record for meet.ishswami.in (see DNS guide above)"
echo "   2. Open Firewall: Allow UDP port 30000 (see firewall guide above)"
echo "   3. Wait for DNS propagation (5-15 minutes)"
echo "   4. Test: Visit https://meet.ishswami.in"
echo ""
echo "🔍 To check status anytime:"
echo "   ./devops/kubernetes/scripts/test-jitsi.sh"
