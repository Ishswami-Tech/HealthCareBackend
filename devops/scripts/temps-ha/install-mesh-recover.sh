#!/usr/bin/env bash
# Install the boot fix for containers published on the Temps mesh address, on
# any Temps node (workers and the control plane). Run as root from this
# directory. Changes nothing that is running: the sysctl applies at once, the
# recovery unit only runs at the next boot.
set -euo pipefail
cd "$(dirname "$0")"
install -m 0644 90-temps-mesh-bind.conf /etc/sysctl.d/90-temps-mesh-bind.conf
sysctl -q -p /etc/sysctl.d/90-temps-mesh-bind.conf
install -m 0755 mesh-recover.sh /usr/local/sbin/hcb-mesh-recover
install -m 0644 hcb-mesh-recover.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable hcb-mesh-recover.service
echo "net.ipv4.ip_nonlocal_bind=$(sysctl -n net.ipv4.ip_nonlocal_bind), hcb-mesh-recover $(systemctl is-enabled hcb-mesh-recover.service)"
