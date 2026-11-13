#!/usr/bin/env bash
# Install the node watchdog on a Temps worker node. Run as root from this directory.
set -euo pipefail
cd "$(dirname "$0")"
install -m 0755 node-watchdog.sh /usr/local/sbin/hcb-node-watchdog
install -m 0644 hcb-node-watchdog.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hcb-node-watchdog.service
sleep 2
systemctl --no-pager --lines=5 status hcb-node-watchdog.service | tail -6
