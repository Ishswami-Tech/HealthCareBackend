#!/usr/bin/env bash
# Install the mesh HA allow rules on a Temps node. Run as root from this directory.
# Optional: HA_EXTRA_SOURCES=<cidr,...> is persisted to /etc/default/hcb-mesh-ha-allow.
set -euo pipefail
cd "$(dirname "$0")"
install -m 0755 mesh-ha-allow.sh /usr/local/sbin/hcb-mesh-ha-allow
if [[ -n "${HA_EXTRA_SOURCES:-}" ]]; then
  echo "HA_EXTRA_SOURCES=$HA_EXTRA_SOURCES" >/etc/default/hcb-mesh-ha-allow
fi
install -m 0644 hcb-mesh-ha-allow.service hcb-mesh-ha-allow.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hcb-mesh-ha-allow.timer
systemctl start hcb-mesh-ha-allow.service
nft list chain inet temps_mesh forward | grep -E 'hcb-ha-|drop'
