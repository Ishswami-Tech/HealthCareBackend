#!/usr/bin/env bash
# Direct WireGuard shortcut between two Temps nodes that are close to each other
# but far from the control plane.
#
# The Temps mesh (temps-wg0) is hub-and-spoke: every node only peers with the
# control plane, so traffic between two workers is relayed through it. For
# temps-worker (Pune) <-> oracle-main (Mumbai) that turns a ~9 ms path into
# ~280 ms (via Europe). This script adds a second WireGuard interface between
# just those two nodes and routes the peer's mesh IP (/32) over it, which is
# more specific than Temps' 10.201.0.0/16 route on temps-wg0. Everything else
# keeps using the Temps mesh, and Temps' own config is never edited.
#
# Safety:
#   * The /32 route only exists while a ping through the tunnel succeeds
#     (checked every 10 s); if the peer stops answering, the route is removed
#     and traffic falls back to the hub automatically.
#   * `table inet hcb_direct` mirrors the Temps mesh lockdown (temps_mesh) for
#     the new interface, so the peer can reach exactly what it could over
#     temps-wg0 and nothing more.
#   * Temps drops VXLAN (overlay network) that does not arrive on temps-wg0;
#     one tagged accept rule is inserted into `inet temps_network` for the
#     peer over this interface. The agent rebuilds that table on restart, so
#     this runs from a timer and re-inserts it.
#
# Config (/etc/default/hcb-direct-link):
#   DL_LOCAL_IP      this node's temps-wg0 IP          (required)
#   DL_PEER_IP       the peer's temps-wg0 IP           (required)
#   DL_PEER_PUBKEY   the peer's hcb-wg1 public key     (required)
#   DL_LISTEN_PORT   UDP port, on the node with a reachable public IP
#   DL_PEER_ENDPOINT host:port of the peer, on the node behind NAT
#   DL_PROBES        pings per check; any reply counts as healthy (3)
#
# Usage: direct-link.sh [up|down|pubkey|status]
set -euo pipefail

IFACE="${DL_IFACE:-hcb-wg1}"
KEY_DIR=/etc/hcb-direct-link
MTU="${DL_MTU:-1420}"
PROBES="${DL_PROBES:-3}"
KEEPALIVE=25
HA_PORTS="${HA_PORTS:-6000-6999}"
TABLE="inet hcb_direct"
VXLAN_TAG="hcb-direct-vxlan"
IPT_TAG="hcb-direct-link"
PROBE_TABLE=201
PROBE_PREF=10201

log() { echo "direct-link: $*"; }

pubkey() {
  install -d -m 0700 "$KEY_DIR"
  if [[ ! -s $KEY_DIR/private.key ]]; then
    (umask 077 && wg genkey >"$KEY_DIR/private.key")
  fi
  wg pubkey <"$KEY_DIR/private.key"
}

require_config() {
  : "${DL_LOCAL_IP:?DL_LOCAL_IP not set}" "${DL_PEER_IP:?DL_PEER_IP not set}"
  : "${DL_PEER_PUBKEY:?DL_PEER_PUBKEY not set}"
  [[ -s $KEY_DIR/private.key ]] || { log "no private key; run '$0 pubkey' first" >&2; exit 1; }
  command -v ping >/dev/null || { log "ping not installed (apt-get install iputils-ping)" >&2; exit 1; }
}

ensure_link() {
  if ! ip link show "$IFACE" >/dev/null 2>&1; then
    ip link add "$IFACE" type wireguard
    log "created $IFACE"
  fi
  local args=(private-key "$KEY_DIR/private.key")
  [[ -n ${DL_LISTEN_PORT:-} ]] && args+=(listen-port "$DL_LISTEN_PORT")
  local peer=(peer "$DL_PEER_PUBKEY" allowed-ips "$DL_PEER_IP/32" persistent-keepalive "$KEEPALIVE")
  [[ -n ${DL_PEER_ENDPOINT:-} ]] && peer+=(endpoint "$DL_PEER_ENDPOINT")
  wg set "$IFACE" "${args[@]}" "${peer[@]}"
  ip link set "$IFACE" mtu "$MTU" up
  ip -4 -o addr show dev "$IFACE" | grep -qF " $DL_LOCAL_IP/32 " \
    || ip addr add "$DL_LOCAL_IP/32" dev "$IFACE"
  # ICMP between the two mesh IPs always uses the tunnel (both the probe and the
  # peer's echo replies), so the health probe works even while the main route
  # has fallen back to temps-wg0. Without this the probe could never recover.
  ip route replace "$DL_PEER_IP/32" dev "$IFACE" src "$DL_LOCAL_IP" table "$PROBE_TABLE"
  ip rule show pref "$PROBE_PREF" | grep -q . \
    || ip rule add pref "$PROBE_PREF" to "$DL_PEER_IP/32" ipproto icmp lookup "$PROBE_TABLE"
}

# Route the peer's mesh IP over the direct link only while a round trip through
# it works. The probe is bound to IFACE, so it tests the tunnel itself whatever
# the route says, and needs both directions (one-way failures are caught too).
ensure_route() {
  local healthy=0
  if ping -c "$PROBES" -W 1 -i 0.3 -q -I "$IFACE" "$DL_PEER_IP" >/dev/null 2>&1; then
    healthy=1
  fi

  if (( healthy )); then
    if ! ip route show "$DL_PEER_IP/32" dev "$IFACE" | grep -q .; then
      ip route replace "$DL_PEER_IP/32" dev "$IFACE" src "$DL_LOCAL_IP"
      log "direct path up: $DL_PEER_IP via $IFACE"
    fi
  elif ip route show "$DL_PEER_IP/32" dev "$IFACE" | grep -q .; then
    ip route del "$DL_PEER_IP/32" dev "$IFACE"
    log "no reply from $DL_PEER_IP over $IFACE: falling back to temps-wg0"
  fi
}

detect_sources() {
  docker network ls --format '{{.Name}}' 2>/dev/null \
    | grep -E '^(temps-app-network|temps[0-9]+)$' \
    | xargs -r docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null \
    | tr ' ' '\n' | grep -E '^[0-9.]+/[0-9]+$' | sort -u | paste -sd, -
}

# Mirror of the Temps mesh lockdown (inet temps_mesh + hcb-mesh-ha-allow) for IFACE.
ensure_filter() {
  local sources src_set rules sum
  sources="${HA_SOURCES:-$(detect_sources)}"
  [[ -n ${HA_EXTRA_SOURCES:-} ]] && sources="${sources:+$sources,}$HA_EXTRA_SOURCES"
  if [[ -n $sources ]]; then
    src_set="{ ${sources//,/, } }"
  else
    src_set=""
  fi
  rules="table inet hcb_direct {
  chain input {
    type filter hook input priority -110; policy accept;
    iifname \"$IFACE\" ct state established,related accept
    iifname \"$IFACE\" ip saddr $DL_PEER_IP udp dport 4789 accept
    iifname \"$IFACE\" icmp type echo-request accept
    iifname \"$IFACE\" counter drop comment \"hcb-direct-__SUM__\"
  }
  chain forward {
    type filter hook forward priority -110; policy accept;
    oifname \"$IFACE\" ct state established,related accept
    iifname \"$IFACE\" ip saddr $DL_PEER_IP ct status dnat accept
    iifname \"$IFACE\" ip saddr $DL_PEER_IP tcp sport $HA_PORTS ct state established,related accept
    iifname \"$IFACE\" counter drop
${src_set:+    oifname \"$IFACE\" ip saddr $src_set ip daddr $DL_PEER_IP tcp dport $HA_PORTS accept
}    oifname \"$IFACE\" counter drop
  }
}"
  # Tag the ruleset with its hash so unchanged runs are no-ops (counters kept).
  sum=$(sha1sum <<<"$rules" | cut -c1-12)
  if nft list table $TABLE 2>/dev/null | grep -qF "hcb-direct-$sum"; then
    return 0
  fi
  rules="${rules//__SUM__/$sum}"
  nft -f - <<EOF
table inet hcb_direct
delete table inet hcb_direct
$rules
EOF
  log "applied $TABLE ($sum)"
}

# Temps drops VXLAN (VNI 42) unless it arrives on temps-wg0; accept it from the peer here.
ensure_vxlan() {
  local rules handle
  rules=$(nft -a list chain inet temps_network input 2>/dev/null) || return 0
  grep -qF "comment \"$VXLAN_TAG\"" <<<"$rules" && return 0
  handle=$(grep -E 'udp dport 4789 @th,96,24 0x2a .*drop # handle [0-9]+$' <<<"$rules" \
    | sed -E 's/.*# handle ([0-9]+)$/\1/' | head -1)
  if [[ -z $handle ]]; then
    grep -q 'dport 4789' <<<"$rules" \
      && log "temps_network VXLAN drop rule layout changed; not patching" >&2
    return 0
  fi
  nft insert rule inet temps_network input position "$handle" \
    iifname "\"$IFACE\"" ip daddr "$DL_LOCAL_IP" ip saddr "$DL_PEER_IP" udp dport 4789 accept \
    comment "\"$VXLAN_TAG\""
  log "inserted $VXLAN_TAG before handle $handle"
}

# Hosts whose iptables INPUT ends in REJECT/DROP (Oracle images) need explicit accepts.
ensure_iptables() {
  local input
  input=$(iptables -S INPUT 2>/dev/null) || return 0
  grep -qE -- '-P INPUT DROP|-j (REJECT|DROP)$|-j REJECT ' <<<"$input" || return 0
  if [[ -n ${DL_LISTEN_PORT:-} ]] && ! grep -qF -- "--dport $DL_LISTEN_PORT -m comment --comment $IPT_TAG" <<<"$input"; then
    iptables -I INPUT 1 -p udp --dport "$DL_LISTEN_PORT" -m comment --comment "$IPT_TAG" -j ACCEPT
    log "iptables: accept udp/$DL_LISTEN_PORT"
  fi
  # Filtering for IFACE is done by table inet hcb_direct (same as temps-wg0 has).
  if ! grep -qF -- "-i $IFACE -m comment --comment $IPT_TAG" <<<"$input"; then
    iptables -I INPUT 1 -i "$IFACE" -m comment --comment "$IPT_TAG" -j ACCEPT
    log "iptables: accept input on $IFACE"
  fi
}

down() {
  ip route del "${DL_PEER_IP:-0.0.0.0}/32" dev "$IFACE" 2>/dev/null || true
  ip rule del pref "$PROBE_PREF" 2>/dev/null || true
  ip route flush table "$PROBE_TABLE" 2>/dev/null || true
  ip link del "$IFACE" 2>/dev/null || true
  nft delete table $TABLE 2>/dev/null || true
  nft -a list chain inet temps_network input 2>/dev/null \
    | grep -F "comment \"$VXLAN_TAG\"" | sed -E 's/.*# handle ([0-9]+)$/\1/' \
    | xargs -r -n1 nft delete rule inet temps_network input handle
  while read -r rule; do
    # shellcheck disable=SC2086
    iptables ${rule/-A/-D}
  done < <(iptables -S INPUT 2>/dev/null | grep -F -- "--comment $IPT_TAG" || true)
  log "removed; all traffic uses temps-wg0 again"
}

status() {
  wg show "$IFACE" 2>/dev/null | sed -E 's/(peer|public key): .{8}.*/\1: <key>/' || echo "$IFACE: absent"
  echo "route: $(ip route get "${DL_PEER_IP:?}" | head -1)"
}

case "${1:-up}" in
  pubkey) pubkey ;;
  up) require_config; ensure_link; ensure_filter; ensure_vxlan; ensure_iptables; ensure_route ;;
  down) down ;;
  status) status ;;
  *) echo "usage: $0 [up|down|pubkey|status]" >&2; exit 2 ;;
esac
