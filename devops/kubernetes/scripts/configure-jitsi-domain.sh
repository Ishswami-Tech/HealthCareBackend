#!/usr/bin/env bash
# Script to configure Jitsi domain dynamically

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../base" && pwd)"
CONFIGMAP_FILE="$BASE_DIR/jitsi-configmap.yaml"

echo "🌐 Configuring Jitsi Domain"
echo ""

# Get domain from user or use default
if [ -z "${1:-}" ]; then
    read -p "Enter your base domain (e.g., ishswami.in): " BASE_DOMAIN
    read -p "Enter Jitsi subdomain (default: meet): " SUBDOMAIN
    SUBDOMAIN="${SUBDOMAIN:-meet}"
else
    BASE_DOMAIN="${1}"
    SUBDOMAIN="${2:-meet}"
fi

if [ -z "$BASE_DOMAIN" ]; then
    echo "❌ Base domain is required"
    exit 1
fi

JITSI_DOMAIN="$SUBDOMAIN.$BASE_DOMAIN"

echo "   Configuring domain: $JITSI_DOMAIN"
echo "   Base domain: $BASE_DOMAIN"
echo "   Subdomain: $SUBDOMAIN"
echo ""

# Update ConfigMap
if [ ! -f "$CONFIGMAP_FILE" ]; then
    echo "❌ ConfigMap file not found: $CONFIGMAP_FILE"
    exit 1
fi

# Create backup
cp "$CONFIGMAP_FILE" "$CONFIGMAP_FILE.bak"

# Update domain values
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|JITSI_BASE_DOMAIN: \".*\"|JITSI_BASE_DOMAIN: \"$BASE_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|JITSI_SUBDOMAIN: \".*\"|JITSI_SUBDOMAIN: \"$SUBDOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|JITSI_DOMAIN: \".*\"|JITSI_DOMAIN: \"$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_DOMAIN: \".*\"|XMPP_DOMAIN: \"$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_AUTH_DOMAIN: \".*\"|XMPP_AUTH_DOMAIN: \"auth.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_GUEST_DOMAIN: \".*\"|XMPP_GUEST_DOMAIN: \"guest.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_MUC_DOMAIN: \".*\"|XMPP_MUC_DOMAIN: \"muc.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_INTERNAL_MUC_DOMAIN: \".*\"|XMPP_INTERNAL_MUC_DOMAIN: \"internal-muc.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_RECORDER_DOMAIN: \".*\"|XMPP_RECORDER_DOMAIN: \"recorder.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|GUEST_DOMAIN: \".*\"|GUEST_DOMAIN: \"guest.$BASE_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|PUBLIC_URL: \".*\"|PUBLIC_URL: \"https://$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|JITSI_BASE_URL: \".*\"|JITSI_BASE_URL: \"https://$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|JITSI_WS_URL: \".*\"|JITSI_WS_URL: \"wss://$JITSI_DOMAIN/xmpp-websocket\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|XMPP_BOSH_URL_BASE: \".*\"|XMPP_BOSH_URL_BASE: \"https://$JITSI_DOMAIN/http-bind\"|g" "$CONFIGMAP_FILE"
    sed -i '' "s|JWT_ASAP_KEYSERVER: \".*\"|JWT_ASAP_KEYSERVER: \"https://$JITSI_DOMAIN/asap\"|g" "$CONFIGMAP_FILE"
else
    # Linux
    sed -i "s|JITSI_BASE_DOMAIN: \".*\"|JITSI_BASE_DOMAIN: \"$BASE_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|JITSI_SUBDOMAIN: \".*\"|JITSI_SUBDOMAIN: \"$SUBDOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|JITSI_DOMAIN: \".*\"|JITSI_DOMAIN: \"$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_DOMAIN: \".*\"|XMPP_DOMAIN: \"$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_AUTH_DOMAIN: \".*\"|XMPP_AUTH_DOMAIN: \"auth.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_GUEST_DOMAIN: \".*\"|XMPP_GUEST_DOMAIN: \"guest.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_MUC_DOMAIN: \".*\"|XMPP_MUC_DOMAIN: \"muc.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_INTERNAL_MUC_DOMAIN: \".*\"|XMPP_INTERNAL_MUC_DOMAIN: \"internal-muc.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_RECORDER_DOMAIN: \".*\"|XMPP_RECORDER_DOMAIN: \"recorder.$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|GUEST_DOMAIN: \".*\"|GUEST_DOMAIN: \"guest.$BASE_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|PUBLIC_URL: \".*\"|PUBLIC_URL: \"https://$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|JITSI_BASE_URL: \".*\"|JITSI_BASE_URL: \"https://$JITSI_DOMAIN\"|g" "$CONFIGMAP_FILE"
    sed -i "s|JITSI_WS_URL: \".*\"|JITSI_WS_URL: \"wss://$JITSI_DOMAIN/xmpp-websocket\"|g" "$CONFIGMAP_FILE"
    sed -i "s|XMPP_BOSH_URL_BASE: \".*\"|XMPP_BOSH_URL_BASE: \"https://$JITSI_DOMAIN/http-bind\"|g" "$CONFIGMAP_FILE"
    sed -i "s|JWT_ASAP_KEYSERVER: \".*\"|JWT_ASAP_KEYSERVER: \"https://$JITSI_DOMAIN/asap\"|g" "$CONFIGMAP_FILE"
fi

# Update main ConfigMap
MAIN_CONFIGMAP="$BASE_DIR/configmap.yaml"
if [ -f "$MAIN_CONFIGMAP" ]; then
    echo "   Updating main ConfigMap..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|JITSI_DOMAIN: \".*\"|JITSI_DOMAIN: \"$JITSI_DOMAIN\"|g" "$MAIN_CONFIGMAP"
        sed -i '' "s|JITSI_BASE_URL: \".*\"|JITSI_BASE_URL: \"https://$JITSI_DOMAIN\"|g" "$MAIN_CONFIGMAP"
        sed -i '' "s|JITSI_WS_URL: \".*\"|JITSI_WS_URL: \"wss://$JITSI_DOMAIN/xmpp-websocket\"|g" "$MAIN_CONFIGMAP"
    else
        sed -i "s|JITSI_DOMAIN: \".*\"|JITSI_DOMAIN: \"$JITSI_DOMAIN\"|g" "$MAIN_CONFIGMAP"
        sed -i "s|JITSI_BASE_URL: \".*\"|JITSI_BASE_URL: \"https://$JITSI_DOMAIN\"|g" "$MAIN_CONFIGMAP"
        sed -i "s|JITSI_WS_URL: \".*\"|JITSI_WS_URL: \"wss://$JITSI_DOMAIN/xmpp-websocket\"|g" "$MAIN_CONFIGMAP"
    fi
fi

# Update ingress
INGRESS_FILE="$BASE_DIR/ingress.yaml"
if [ -f "$INGRESS_FILE" ]; then
    echo "   Updating ingress..."
    # This is more complex, so we'll use a Python script or manual update
    echo "   ⚠️  Please manually update ingress.yaml to use: $JITSI_DOMAIN"
fi

echo ""
echo "✅ Domain configuration updated!"
echo ""
echo "📋 Updated values:"
echo "   JITSI_DOMAIN: $JITSI_DOMAIN"
echo "   JITSI_BASE_URL: https://$JITSI_DOMAIN"
echo "   JITSI_WS_URL: wss://$JITSI_DOMAIN/xmpp-websocket"
echo ""
echo "📝 Next steps:"
echo "   1. Review the updated ConfigMap: $CONFIGMAP_FILE"
echo "   2. Update ingress.yaml to use: $JITSI_DOMAIN"
echo "   3. Apply ConfigMap: kubectl apply -f $CONFIGMAP_FILE"
echo "   4. Restart Jitsi pods: kubectl rollout restart deployment -n healthcare-backend -l app=jitsi"
