#!/usr/bin/env bash
# Recreate this node's redis-dragonfly-cache so it starts through start.sh
# (replica of whatever master the Sentinels name) instead of a fixed
# --replicaof. Image, flags, ports, volume and logging are copied from the
# running container; only the entrypoint changes and --replicaof is dropped.
#
#   DIR=~/hcb-dragonfly SENTINEL_PASSWORD_FILE=... ./install.sh
#
# DOCKER="sudo -n docker" where the user is not in the docker group.
# Refuses on the current master: run `SENTINEL FAILOVER dragonfly` first so
# the copy being recreated is a replica, then this costs no write gap.
#
# A copy created before the announce flags existed (the control plane's) has
# no --replica_announce_ip/--announce_port: pass them as ANNOUNCE_IP and
# ANNOUNCE_PORT (its mesh address and published port). REPLICA_PRIORITY adds
# --replica_priority when the copy has none; 0 means Sentinel never promotes it.
# Flags the container already has always win over these.
set -euo pipefail
cd "$(dirname "$0")"
C=redis-dragonfly-cache
DOCKER="${DOCKER:-docker}"
DIR="${DIR:-$HOME/hcb-dragonfly}"
: "${SENTINEL_PASSWORD_FILE:?path to a file holding the Sentinel password}"

mapfile -t cmd < <($DOCKER inspect "$C" --format '{{range .Config.Cmd}}{{println .}}{{end}}' | sed '/^$/d')
image=$($DOCKER inspect "$C" --format '{{.Config.Image}}')
network=$($DOCKER inspect "$C" --format '{{.HostConfig.NetworkMode}}')
volume=$($DOCKER inspect "$C" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
mapfile -t ports < <($DOCKER inspect "$C" --format '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}}:{{$p}}{{println}}{{end}}{{end}}' | sed '/^$/d')
mapfile -t logopts < <($DOCKER inspect "$C" --format '{{range $k, $v := .HostConfig.LogConfig.Config}}{{$k}}={{$v}}{{println}}{{end}}' | sed '/^$/d')

# Keep only the server's own arguments. Depending on how a copy was created its
# Cmd may start with tini's "--", "entrypoint.sh", or (after this script)
# "/bin/sh /hcb/start.sh". Dragonfly ignores every flag after a stray "--".
while [ "${#cmd[@]}" -gt 0 ]; do
    case "${cmd[0]}" in
        --|entrypoint.sh|/bin/sh|/hcb/start.sh) cmd=("${cmd[@]:1}") ;;
        *) break ;;
    esac
done
case "${cmd[0]:-}" in
    redis-server|dragonfly) ;;
    *) echo "unexpected $C command start '${cmd[0]:-}'; not touching it" >&2; exit 1 ;;
esac
for a in "${cmd[@]}"; do
    if [ "$a" = "--" ]; then echo "stray '--' inside $C's flags; not touching it" >&2; exit 1; fi
done

ip="" port=""
args=()
for a in "${cmd[@]}"; do
    case "$a" in
        --replicaof=*) ;;  # replaced by start.sh
        --replica_announce_ip=*) ip="${a#*=}"; args+=("$a") ;;
        --announce_port=*) port="${a#*=}"; args+=("$a") ;;
        --default_lua_flags=*)
            # Never carry `disable-atomicity` over: BullMQ needs atomic Lua scripts. With it,
            # df-v2.0.2 handed one job to two workers ("Lock mismatch"). Other flags are kept.
            lua=$(printf '%s\n' "${a#*=}" | tr ',' '\n' | grep -vx 'disable-atomicity' | paste -sd, - || true)
            [ -n "$lua" ] && args+=("--default_lua_flags=$lua") ;;
        *) args+=("$a") ;;
    esac
done
if [ -z "$ip" ] && [ -n "${ANNOUNCE_IP:-}" ]; then ip="$ANNOUNCE_IP"; args+=("--replica_announce_ip=$ip"); fi
if [ -z "$port" ] && [ -n "${ANNOUNCE_PORT:-}" ]; then port="$ANNOUNCE_PORT"; args+=("--announce_port=$port"); fi
if [ -n "${REPLICA_PRIORITY:-}" ] && ! printf '%s\n' "${args[@]}" | grep -q '^--replica_priority='; then
    args+=("--replica_priority=$REPLICA_PRIORITY")
fi
[ -n "$ip" ] && [ -n "$port" ] || { echo "no --replica_announce_ip/--announce_port in $C's flags; set ANNOUNCE_IP and ANNOUNCE_PORT" >&2; exit 1; }
[ -n "$volume" ] || { echo "$C has no named volume at /data" >&2; exit 1; }

# The Sentinels' view of the master, asked from inside the running copy
# (it has redis-cli); the password goes over stdin.
master=$($DOCKER exec -i "$C" sh -c 'export REDISCLI_AUTH="$(cat)"; for s in 10.201.0.1 10.201.0.8 10.201.0.7; do
    timeout 3 redis-cli -h $s -p 6579 --no-auth-warning sentinel get-master-addr-by-name dragonfly 2>/dev/null | paste -sd: -; done' \
    < "$SENTINEL_PASSWORD_FILE" | grep -E ':[0-9]+$' | sort | uniq -c | sort -rn | awk '$1 >= 2 { print $2; exit }')
if [ -z "$master" ] || [ "$master" = "$ip:$port" ]; then
    echo "Sentinel master is '${master:-no majority}', this copy is $ip:$port. Fail over first: SENTINEL FAILOVER dragonfly" >&2
    exit 1
fi

install -d -m 700 "$DIR"
install -m 755 start.sh "$DIR/start.sh"
if [ "$(realpath "$SENTINEL_PASSWORD_FILE")" != "$(realpath -m "$DIR/sentinel.password")" ]; then
    install -m 600 "$SENTINEL_PASSWORD_FILE" "$DIR/sentinel.password"
fi
chmod 600 "$DIR/sentinel.password"

# shellcheck disable=SC2206 # DOCKER may be "sudo -n docker"
run=($DOCKER run -d --name "$C" --restart unless-stopped --network "$network"
     -v "$volume:/data" -v "$DIR:/hcb:ro" -e "HCB_SELF=$ip:$port"
     --entrypoint /usr/bin/tini)
for p in "${ports[@]}"; do run+=(-p "${p%/tcp}"); done
for o in "${logopts[@]}"; do run+=(--log-opt "$o"); done

$DOCKER rm -f "$C" >/dev/null
"${run[@]}" "$image" -- /bin/sh /hcb/start.sh "${args[@]}" >/dev/null
echo "$C recreated on $image; waiting for it to sync"
for _ in $(seq 1 60); do
    sleep 2
    if $DOCKER logs "$C" 2>&1 | grep -q 'hcb-dragonfly-start: starting as a replica'; then
        $DOCKER logs "$C" 2>&1 | grep 'hcb-dragonfly-start' | tail -1
        exit 0
    fi
done
echo "$C has not started yet; see: $DOCKER logs $C" >&2
exit 1
