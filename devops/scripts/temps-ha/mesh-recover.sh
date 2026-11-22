#!/bin/bash
# hcb-mesh-recover: run once at boot on every Temps node.
#
# Docker starts containers before the Temps agent has brought up the mesh
# interface (temps-wg0). Every container that publishes a port on the mesh
# address then fails with "cannot assign requested address", Docker never
# retries a failed start, and some come back with no network attached at all.
# net.ipv4.ip_nonlocal_bind=1 (90-temps-mesh-bind.conf, installed with this) prevents the first
# part; this is the safety net for anything that still failed.
#
# It only touches containers Docker is meant to keep running (restart policy
# always / unless-stopped): ones that lost their network settings are
# reattached to their network, and ones whose last start failed on networking
# are started again, databases and caches first. Containers stopped on
# purpose have no start error and are left alone.
set -u
log() { echo "mesh-recover: $*"; }

for _ in $(seq 1 120); do
    ip -4 -o addr show dev temps-wg0 2>/dev/null | grep -q ' inet ' && break
    sleep 5
done
if ! ip -4 -o addr show dev temps-wg0 2>/dev/null | grep -q ' inet '; then
    log "temps-wg0 has no address after 10 minutes; nothing done"
    exit 1
fi
sleep 15 # let the agent finish restoring its networks first

keep_running() {
    case "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$1")" in
        always | unless-stopped) return 0 ;;
    esac
    return 1
}
name_of() { docker inspect -f '{{.Name}}' "$1" | sed 's#^/##'; }

declare -A restart_needed=()

# 1. Containers that lost their network settings.
for c in $(docker ps -aq); do
    keep_running "$c" || continue
    mode="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c")"
    case "$mode" in default | host | none | container:*) continue ;; esac
    [ "$(docker inspect -f '{{len .NetworkSettings.Networks}}' "$c")" -eq 0 ] || continue
    name="$(name_of "$c")"
    if ! docker network inspect "$mode" >/dev/null 2>&1; then
        log "$name: lost its network, and network $mode does not exist; skipped"
        continue
    fi
    was_running="$(docker inspect -f '{{.State.Running}}' "$c")"
    [ "$was_running" = true ] && docker stop -t 20 "$c" >/dev/null
    if docker network connect "$mode" "$c"; then
        log "$name: reattached to $mode"
        # Back up only if it was running; a failed start is picked up below.
        [ "$was_running" = true ] && restart_needed[$c]=1
    else
        log "$name: could not reattach to $mode"
    fi
done

# 2. Containers whose start failed on networking.
for c in $(docker ps -aq --filter status=exited --filter status=created); do
    keep_running "$c" || continue
    case "$(docker inspect -f '{{.State.Error}}' "$c")" in
        *"failed to set up container networking"* | *"cannot assign requested address"* | *"external connectivity"*)
            restart_needed[$c]=1 ;;
    esac
done

# Databases and caches first, then everything else.
first=() rest=()
for c in "${!restart_needed[@]}"; do
    if name_of "$c" | grep -qE 'postgres|dragonfly|sentinel|redis|^hcb-' ||
        [ "$(docker inspect -f '{{index .Config.Labels "sh.temps.service"}}' "$c")" = true ]; then
        first+=("$c")
    else
        rest+=("$c")
    fi
done
for c in "${first[@]}" "${rest[@]}"; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c")" = true ] && continue
    if docker start "$c" >/dev/null; then log "$(name_of "$c"): started"; else log "$(name_of "$c"): start failed"; fi
done
[ ${#restart_needed[@]} -eq 0 ] && log "nothing to recover"
exit 0
