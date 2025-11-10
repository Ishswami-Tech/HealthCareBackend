#!/usr/bin/env bash
# Script to setup BuildKit as a systemd service for k3s/containerd builds

set -euo pipefail

echo "🔧 Setting up BuildKit systemd service..."
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ This script must be run with sudo"
    echo "   Usage: sudo ./setup-buildkit-service.sh"
    exit 1
fi

# Create systemd service file
SERVICE_FILE="/etc/systemd/system/buildkit.service"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=BuildKit daemon
After=network.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/buildkitd --addr unix:///run/buildkit/buildkitd.sock --root /var/lib/buildkit --group root
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Created systemd service file: $SERVICE_FILE"
echo ""

# Create directories
mkdir -p /run/buildkit /var/lib/buildkit
chmod 755 /run/buildkit /var/lib/buildkit

echo "✅ Created BuildKit directories"
echo ""

# Reload systemd
systemctl daemon-reload

echo "✅ Reloaded systemd daemon"
echo ""

# Enable and start service
systemctl enable buildkit
systemctl start buildkit

echo "✅ BuildKit service enabled and started"
echo ""

# Check status
sleep 2
if systemctl is-active --quiet buildkit; then
    echo "✅ BuildKit is running"
    echo ""
    echo "📊 Service status:"
    systemctl status buildkit --no-pager -l | head -15
    echo ""
    echo "✅ BuildKit setup complete!"
    echo ""
    echo "📝 To check BuildKit status:"
    echo "   sudo systemctl status buildkit"
    echo ""
    echo "📝 To view BuildKit logs:"
    echo "   sudo journalctl -u buildkit -f"
    echo ""
else
    echo "❌ BuildKit failed to start"
    echo ""
    echo "Check logs with:"
    echo "   sudo journalctl -u buildkit -n 50"
    exit 1
fi

