#!/bin/sh
# Entrypoint wrapper for an HA Dragonfly copy (redis-dragonfly-cache).
#
# Dragonfly cannot persist a Sentinel's REPLICAOF (no CONFIG REWRITE), so a
# fixed --replicaof flag goes stale after the first failover. Instead this
# asks the Sentinels which node is master and starts as its replica.
#
# It never starts a master on its own: a copy that boots as master would load
# its old on-disk snapshot and replicas would then resync that stale data. If
# the Sentinels still name this node as master (it restarted faster than they
# noticed), it waits; they promote another copy once this one stays down for
# down-after-milliseconds, and it then replicates from that one.
#
# Environment: HCB_SELF (this copy's announced host:port).
# /hcb/sentinel.password holds the Sentinels' password (read-only mount).
set -u

SENTINELS="${HCB_SENTINELS:-10.201.0.1:6579 10.201.0.8:6579 10.201.0.7:6579}"
NAME="${HCB_SENTINEL_NAME:-dragonfly}"
QUORUM="${HCB_SENTINEL_QUORUM:-2}"
: "${HCB_SELF:?HCB_SELF must be this copy's announced host:port}"

master_by_majority() {
    for s in $SENTINELS; do
        REDISCLI_AUTH="$(cat /hcb/sentinel.password)" timeout 3 \
            redis-cli -h "${s%:*}" -p "${s#*:}" --no-auth-warning \
            sentinel get-master-addr-by-name "$NAME" 2>/dev/null | paste -sd: -
    done | grep -E '^[0-9a-fA-F.:]+:[0-9]+$' | sort | uniq -c | sort -rn \
        | awk -v q="$QUORUM" '$1 >= q { print $2; exit }'
}

while :; do
    master="$(master_by_majority)"
    if [ -n "$master" ] && [ "$master" != "$HCB_SELF" ]; then
        break
    fi
    echo "hcb-dragonfly-start: not starting yet (Sentinel master: ${master:-no majority}, this copy: $HCB_SELF)" >&2
    sleep 5
done

echo "hcb-dragonfly-start: starting as a replica of $master" >&2
exec entrypoint.sh "$@" "--replicaof=$master"
