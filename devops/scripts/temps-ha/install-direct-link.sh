#!/usr/bin/env bash
# Install the direct WireGuard shortcut on one side. Run as root from this directory.
#
#   1. On both nodes:  sudo bash install-direct-link.sh pubkey   -> prints this node's key
#   2. On both nodes:  sudo DL_LOCAL_IP=... DL_PEER_IP=... DL_PEER_PUBKEY=... \
#                        [DL_LISTEN_PORT=51830 | DL_PEER_ENDPOINT=host:51830] \
#                        bash install-direct-link.sh
set -euo pipefail
cd "$(dirname "$0")"
install -m 0755 direct-link.sh /usr/local/sbin/hcb-direct-link
if [[ ${1:-} == pubkey ]]; then
  exec /usr/local/sbin/hcb-direct-link pubkey
fi
: "${DL_LOCAL_IP:?}" "${DL_PEER_IP:?}" "${DL_PEER_PUBKEY:?}"
{
  echo "DL_LOCAL_IP=$DL_LOCAL_IP"
  echo "DL_PEER_IP=$DL_PEER_IP"
  echo "DL_PEER_PUBKEY=$DL_PEER_PUBKEY"
  [[ -n ${DL_LISTEN_PORT:-} ]] && echo "DL_LISTEN_PORT=$DL_LISTEN_PORT"
  [[ -n ${DL_PEER_ENDPOINT:-} ]] && echo "DL_PEER_ENDPOINT=$DL_PEER_ENDPOINT"
  true
} >/etc/default/hcb-direct-link
install -m 0644 hcb-direct-link.service hcb-direct-link.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start hcb-direct-link.service
systemctl enable --now hcb-direct-link.timer
/usr/local/sbin/hcb-direct-link status
