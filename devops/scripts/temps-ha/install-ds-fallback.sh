#!/usr/bin/env bash
# Install the contabo-ds fallback watcher on the Temps control plane. Run as root from this
# directory. A first install runs in dry-run mode (it only logs what it would do); go live by
# setting DRY_RUN=0 in /etc/default/temps-ds-fallback. Reinstalling keeps that setting.
set -euo pipefail
cd "$(dirname "$0")"
install -m 0755 ds-fallback.sh /usr/local/bin/temps-ds-fallback
[[ -f /etc/default/temps-ds-fallback ]] || echo "DRY_RUN=1" >/etc/default/temps-ds-fallback
install -m 0644 temps-ds-fallback.service temps-ds-fallback.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now temps-ds-fallback.timer
systemctl list-timers temps-ds-fallback.timer --no-pager
echo "mode: $(cat /etc/default/temps-ds-fallback)"
