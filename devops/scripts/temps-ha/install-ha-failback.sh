#!/usr/bin/env bash
# Install the HA failback controller on the Temps control plane. Run as root from this directory.
set -euo pipefail
cd "$(dirname "$0")"
install -m 0755 ha-failback.sh /usr/local/bin/hcb-ha-failback
install -m 0644 hcb-ha-failback.service hcb-ha-failback.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hcb-ha-failback.timer
systemctl list-timers hcb-ha-failback.timer --no-pager
