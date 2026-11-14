#!/usr/bin/env bash
# Keep HA database/cache traffic allowed through the Temps WireGuard mesh lockdown.
#
# The Temps agent installs `table inet temps_mesh`, whose forward chain drops every
# new connection a container opens over temps-wg0. The HA Postgres keepers
# (monitor :6260, members :6261-6263) and Dragonfly replicas (:6512) all connect
# out from containers to 10.201.0.x, so without these rules a node that reboots
# can never rejoin as a standby. The agent rebuilds the table on every start, which
# wipes hand-added rules, so this runs from a systemd timer and re-inserts them
# whenever they are missing. It never removes or reorders the agent's own rules.
#
# Env overrides:
#   HA_PORTS   destination port range on the mesh (default 6000-6999)
#   HA_SOURCES comma-separated container subnets (default: auto-detected from
#              the temps-app-network and temps<N> overlay Docker networks)
#   HA_EXTRA_SOURCES comma-separated subnets added to the detected ones (e.g. the
#              control plane's Coolify network, until Coolify is removed)
set -euo pipefail

TABLE="inet temps_mesh"
CHAIN="forward"
MESH_IF="temps-wg0"
MESH_NET="10.201.0.0/16"
PORTS="${HA_PORTS:-6000-6999}"
EGRESS_TAG="hcb-ha-egress"
REPLY_TAG="hcb-ha-replies"

# The agent has not installed the lockdown yet; nothing to patch.
nft list chain $TABLE $CHAIN >/dev/null 2>&1 || exit 0

detect_sources() {
  docker network ls --format '{{.Name}}' 2>/dev/null \
    | grep -E '^(temps-app-network|temps[0-9]+)$' \
    | xargs -r docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null \
    | tr ' ' '\n' | grep -E '^[0-9.]+/[0-9]+$' | sort -u | paste -sd, -
}

SOURCES="${HA_SOURCES:-$(detect_sources)}"
if [[ -n "${HA_EXTRA_SOURCES:-}" ]]; then
  SOURCES="${SOURCES:+$SOURCES,}$HA_EXTRA_SOURCES"
fi
if [[ -z "$SOURCES" ]]; then
  echo "mesh-ha-allow: no container subnets found (is Docker up?)" >&2
  exit 1
fi

rules="$(nft -a list chain $TABLE $CHAIN)"

# Handle of the agent's catch-all drop for a direction ("iifname" or "oifname").
drop_handle() {
  grep -E "^\s*$1 \"$MESH_IF\" counter packets [0-9]+ bytes [0-9]+ drop # handle [0-9]+$" <<<"$rules" \
    | sed -E 's/.*# handle ([0-9]+)$/\1/' | tail -1
}

# ensure_rule TAG DIRECTION RULE [MUST_CONTAIN...]
# Re-inserts RULE before the agent's catch-all drop unless a copy tagged TAG that
# contains every MUST_CONTAIN string is already there.
ensure_rule() {
  local tag="$1" dir="$2" rule="$3" current handle needle ok=1
  shift 3
  current="$(grep -F "comment \"$tag\"" <<<"$rules" || true)"
  if [[ -n "$current" ]]; then
    for needle in "$@"; do grep -qF -- "$needle" <<<"$current" || ok=0; done
    [[ $ok == 1 ]] && return 0
    # Stale copy (sources changed): remove it before re-adding.
    sed -E 's/.*# handle ([0-9]+)$/\1/' <<<"$current" | xargs -r -n1 nft delete rule $TABLE $CHAIN handle
  fi
  handle="$(drop_handle "$dir")"
  if [[ -z "$handle" ]]; then
    echo "mesh-ha-allow: no $dir drop rule in $TABLE $CHAIN; lockdown layout changed, not patching" >&2
    exit 1
  fi
  nft insert rule $TABLE $CHAIN position "$handle" $rule comment "\"$tag\""
  echo "mesh-ha-allow: inserted $tag before handle $handle"
}

src_set="{ ${SOURCES//,/, } }"
ensure_rule "$REPLY_TAG" iifname \
  "iifname \"$MESH_IF\" ip saddr $MESH_NET tcp sport $PORTS ct state established,related counter accept" \
  "sport $PORTS"
# nft merges adjacent subnets in the set (172.20.0.0/24 + 172.20.1.0/24 lists as
# 172.20.0.0/23), so the subnets cannot be matched back literally: remember what
# was applied instead, or every run deletes and re-inserts the rule.
EGRESS_STATE="${EGRESS_STATE:-/run/hcb-mesh-ha-allow.egress-sources}"
if [[ -f "$EGRESS_STATE" && "$(cat "$EGRESS_STATE")" == "$SOURCES" ]]; then
  egress_needles=()
else
  egress_needles=(${SOURCES//,/ } "__force_rewrite__")
fi
ensure_rule "$EGRESS_TAG" oifname \
  "oifname \"$MESH_IF\" ip saddr $src_set ip daddr $MESH_NET tcp dport $PORTS counter accept" \
  "${egress_needles[@]}"
echo "$SOURCES" >"$EGRESS_STATE"

# Hairpin: a container reaching a Postgres/Dragonfly member published on THIS host's
# own mesh address goes through the host's INPUT chain (docker-proxy). Hosts whose
# iptables INPUT ends in REJECT/DROP (Oracle Cloud images) refuse it, so the app
# copies on such a node cannot use its database or cache once that node becomes
# primary. Allow exactly that: container subnets -> this host's mesh IP, HA ports.
HAIRPIN_TAG="hcb-ha-hairpin"
MESH_IP=$(ip -4 -o addr show dev "$MESH_IF" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
if [[ -n "$MESH_IP" ]] && command -v iptables >/dev/null; then
  input=$(iptables -S INPUT 2>/dev/null || true)
  if grep -qE -- '-P INPUT DROP|-j (REJECT|DROP)( |$)' <<<"$input"; then
    for src in ${SOURCES//,/ }; do
      if ! grep -qF -- "-s $src -d $MESH_IP/32 -p tcp -m tcp --dport ${PORTS/-/:} -m comment --comment $HAIRPIN_TAG" <<<"$input"; then
        iptables -I INPUT 1 -s "$src" -d "$MESH_IP/32" -p tcp --dport "${PORTS/-/:}" \
          -m comment --comment "$HAIRPIN_TAG" -j ACCEPT
        echo "mesh-ha-allow: iptables hairpin accept $src -> $MESH_IP:$PORTS"
      fi
    done
  fi
fi

# Cluster DNS: Temps runs a resolver for *.temps.local on each node's overlay bridge
# (172.20.<n>.1:53) and points every app container at it. On a host whose INPUT
# chain ends in REJECT/DROP (Oracle Cloud images) the container's query to its own
# host is refused, so every *.temps.local name (postgres-main-N..., primary...)
# fails there and lookups fall through to public DNS. Allow exactly that: container
# subnets -> this host's Temps resolver, port 53. Found 2026-11-14 on main-server.
DNS_TAG="hcb-cluster-dns"
if command -v iptables >/dev/null && command -v ss >/dev/null; then
  input=$(iptables -S INPUT 2>/dev/null || true)
  if grep -qE -- '-P INPUT DROP|-j (REJECT|DROP)( |$)' <<<"$input"; then
    for resolver in $(ss -lun 2>/dev/null | grep -oE '172\.20\.[0-9]+\.1:53' | cut -d: -f1 | sort -u); do
      for proto in udp tcp; do
        if ! grep -qF -- "-s 172.20.0.0/16 -d $resolver/32 -p $proto -m $proto --dport 53 -m comment --comment $DNS_TAG" <<<"$input"; then
          iptables -I INPUT 1 -s 172.20.0.0/16 -d "$resolver/32" -p "$proto" --dport 53 \
            -m comment --comment "$DNS_TAG" -j ACCEPT
          echo "mesh-ha-allow: iptables accept container DNS -> $resolver:53/$proto"
        fi
      done
    done
  fi
fi
