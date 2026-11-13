#!/usr/bin/env bash
# Automatic failback for the HA Postgres (pg_auto_failover) and Dragonfly (Sentinel) pair.
#
# Failover is automatic in both systems; failback is not: once the preferred node
# returns it stays a replica forever. Run from a timer on the control plane (which
# hosts the pg_auto_failover monitor and Sentinel), this moves each primary back to
# the preferred node once that node has been a healthy, caught-up replica for
# STABLE_SECS in a row, and at most once per COOLDOWN_SECS, so a node that keeps
# dropping out cannot make the primary flap.
#
# Postgres: pgautofailover.perform_promotion() — the monitor's own planned switchover
#           (same as `pg_autoctl perform promotion`); writes pause for a few seconds.
# Dragonfly: SENTINEL FAILOVER — Sentinel picks the replica with the lowest
#           replica-priority, which must be the preferred node.
#
# The app follows both moves by itself (PrismaService primary tracker + Sentinel client).
#
# Apps: once both data primaries are back, redeploys the current image of each app
#       that has no replica on the preferred node, so Temps spreads the replicas again.
#
# Env overrides: PREFERRED_PG_NODE, PREFERRED_CACHE, PREFERRED_NODE_NAME, APPS, APP_CHECK_SECS,
# TEMPS_CLI_VERSION,
# STABLE_SECS, COOLDOWN_SECS, MAX_LAG_BYTES, DRY_RUN=1 (log what would happen, change nothing).
set -euo pipefail

PREFERRED_PG_NODE="${PREFERRED_PG_NODE:-postgres-postgres-main-1}"   # temps-worker
PREFERRED_CACHE="${PREFERRED_CACHE:-10.201.0.5:6512}"                 # temps-worker
STABLE_SECS="${STABLE_SECS:-300}"
COOLDOWN_SECS="${COOLDOWN_SECS:-1800}"
MAX_LAG_BYTES="${MAX_LAG_BYTES:-16777216}"
DRY_RUN="${DRY_RUN:-0}"
PREFERRED_NODE_NAME="${PREFERRED_NODE_NAME:-temps-worker-ubuntu}"     # Temps node name
APPS="${APPS:-4:4:healthcarebackend 5:5:healthcarebackend-worker}"     # project:env:slug
APP_CHECK_SECS="${APP_CHECK_SECS:-300}"
TEMPS_CLI_VERSION="${TEMPS_CLI_VERSION:-0.1.38}"
# The pinned CLI installed by install-ha-failback.sh; npx (needs the npm registry) only as fallback.
TEMPS_CLI_HOME="${TEMPS_CLI_HOME:-/home/deploy/.local/share/hcb-temps-cli}"
# A deployment still not finished after this long is stuck (e.g. paused), not in flight.
IN_FLIGHT_MAX_SECS="${IN_FLIGHT_MAX_SECS:-7200}"
# After a failback redeploy that still left no copy on the preferred node (drained or offline
# in Temps), wait this long before trying again instead of redeploying every cooldown.
APP_BACKOFF_SECS="${APP_BACKOFF_SECS:-21600}"

MONITOR_CONTAINER="postgres-postgres-main-monitor"
MONITOR_PORT=6260
FORMATION="default"
SENTINEL_CONTAINER="dragonfly-sentinel"
SENTINEL_MASTER="dragonfly"
SENTINEL_PASSWORD_FILE="/home/deploy/dragonfly-sentinel/sentinel.password"
STATE_DIR="${STATE_DIR:-/var/lib/hcb-ha-failback}"

mkdir -p "$STATE_DIR"
now=$(date +%s)

log() { echo "ha-failback: $*"; }

# Healthy-since bookkeeping: `stable KEY` prints how long KEY has been healthy,
# `unstable KEY` resets it.
stable() {
  local f="$STATE_DIR/$1.healthy-since"
  [[ -f "$f" ]] || echo "$now" >"$f"
  echo $((now - $(cat "$f")))
}
unstable() { rm -f "$STATE_DIR/$1.healthy-since"; }

cooling_down() {
  local f="$STATE_DIR/$1.last-failback"
  [[ -f "$f" ]] && (( now - $(cat "$f") < COOLDOWN_SECS ))
}
mark_failback() { echo "$now" >"$STATE_DIR/$1.last-failback"; unstable "$1"; }

# ---------------------------------------------------------------- Postgres
monitor_sql() {
  docker exec -i -u postgres "$MONITOR_CONTAINER" \
    psql -X -q -At -F'|' -v ON_ERROR_STOP=1 -p "$MONITOR_PORT" -d pg_auto_failover "$@"
}

failback_postgres() {
  local rows pref primary lag age
  # nodename|goal|reported|health|age_s|lag_bytes_behind_primary
  rows=$(monitor_sql <<'SQL'
WITH p AS (SELECT reportedlsn FROM pgautofailover.node
           WHERE goalstate = 'primary' AND reportedstate = 'primary' LIMIT 1)
SELECT n.nodename, n.goalstate, n.reportedstate, n.health,
       round(extract(epoch FROM now() - n.reporttime)),
       coalesce(pg_wal_lsn_diff((SELECT reportedlsn FROM p), n.reportedlsn)::bigint, -1)
FROM pgautofailover.node n WHERE n.formationid = 'default' ORDER BY n.nodeid;
SQL
  ) || { log "postgres: monitor unreachable; skipping"; return 0; }

  pref=$(grep "^$PREFERRED_PG_NODE|" <<<"$rows" || true)
  if [[ -z "$pref" ]]; then
    log "postgres: preferred node $PREFERRED_PG_NODE not registered with the monitor"
    return 0
  fi
  if [[ "$(cut -d'|' -f2 <<<"$pref")" == primary ]]; then
    echo 1 >"$STATE_DIR/pg.at-home"; unstable pg; return 0   # already in its default position
  fi
  echo 0 >"$STATE_DIR/pg.at-home"

  primary=$(awk -F'|' '$2=="primary" && $3=="primary" && $4==1' <<<"$rows")
  IFS='|' read -r _ goal reported health age lag <<<"$pref"
  if [[ -z "$primary" || "$goal" != secondary || "$reported" != secondary || "$health" != 1 \
        || "$age" -gt 30 || "$lag" -lt 0 || "$lag" -gt "$MAX_LAG_BYTES" ]]; then
    [[ -f "$STATE_DIR/pg.healthy-since" ]] && log "postgres: $PREFERRED_PG_NODE not ready (goal=$goal reported=$reported health=$health age=${age}s lag=${lag}B); restarting stability window"
    unstable pg; return 0
  fi

  local up; up=$(stable pg)
  if (( up < STABLE_SECS )); then return 0; fi
  if cooling_down pg; then return 0; fi

  log "postgres: $PREFERRED_PG_NODE healthy secondary for ${up}s (lag ${lag}B); promoting it back to primary"
  if [[ "$DRY_RUN" == 1 ]]; then log "postgres: DRY_RUN, not promoting"; return 0; fi
  monitor_sql -c "SELECT pgautofailover.perform_promotion('$FORMATION', '$PREFERRED_PG_NODE')" >/dev/null
  mark_failback pg
}

# ---------------------------------------------------------------- Dragonfly
sentinel() {
  local pass=""
  [[ -r "$SENTINEL_PASSWORD_FILE" ]] && pass=$(cat "$SENTINEL_PASSWORD_FILE")
  docker exec "$SENTINEL_CONTAINER" redis-cli -p 26379 ${pass:+-a "$pass"} --no-auth-warning "$@"
}

failback_cache() {
  local master replicas entry flags link
  master=$(sentinel SENTINEL get-master-addr-by-name "$SENTINEL_MASTER" | paste -sd: -) \
    || { log "cache: sentinel unreachable; skipping"; return 0; }
  if [[ "$master" == "$PREFERRED_CACHE" ]]; then
    echo 1 >"$STATE_DIR/cache.at-home"; unstable cache; return 0
  fi
  echo 0 >"$STATE_DIR/cache.at-home"

  # One line per replica: "name <ip:port> flags <f> master-link-status <s> ..."
  replicas=$(sentinel SENTINEL replicas "$SENTINEL_MASTER" | paste - - | awk -F'\t' '
    $1=="name" && NR>1 {print line; line=""} {line=line" "$1" "$2} END {print line}')
  entry=$(grep -F " name $PREFERRED_CACHE " <<<"$replicas" || true)
  flags=$(grep -oE ' flags [^ ]+' <<<"$entry" | awk '{print $2}')
  link=$(grep -oE ' master-link-status [^ ]+' <<<"$entry" | awk '{print $2}')
  if [[ "$flags" != slave || "$link" != ok ]]; then
    [[ -f "$STATE_DIR/cache.healthy-since" ]] && log "cache: $PREFERRED_CACHE not ready (flags=${flags:-missing} link=${link:-?}); restarting stability window"
    unstable cache; return 0
  fi

  # Sentinel promotes the healthy replica with the lowest non-zero priority; make sure
  # that is ours, or a failover would move the master somewhere else entirely.
  local winner
  winner=$(awk '{name=""; f=""; p=""
      for (i=1; i<NF; i++) { if ($i=="name") name=$(i+1); if ($i=="flags") f=$(i+1); if ($i=="slave-priority") p=$(i+1) }
      if (f=="slave" && p>0) print p, name}' <<<"$replicas" | sort -n | head -1 | awk '{print $2}')
  if [[ "$winner" != "$PREFERRED_CACHE" ]]; then
    log "cache: Sentinel would promote ${winner:-nothing}, not $PREFERRED_CACHE; set its replica-priority lowest. Not failing over"
    unstable cache; return 0
  fi

  local up; up=$(stable cache)
  if (( up < STABLE_SECS )); then return 0; fi
  if cooling_down cache; then return 0; fi

  log "cache: $PREFERRED_CACHE healthy replica for ${up}s; asking Sentinel to fail over from $master"
  if [[ "$DRY_RUN" == 1 ]]; then log "cache: DRY_RUN, not failing over"; return 0; fi
  sentinel SENTINEL failover "$SENTINEL_MASTER" >/dev/null
  mark_failback cache
}

# ---------------------------------------------------------------- App replicas
# targetNodes [6,9] with 2 replicas means one API and one worker on each node, but
# Temps never rebalances: replicas rescheduled onto contabo-ds while temps-worker was
# down stay there. Once the data layer is back on the preferred node (which also
# proves that node is up), redeploy the current image so Temps spreads them again.
#
# Uses only the Temps CLI (the supported API), pinned to the version this was tested
# with, never Temps' internal database, so Temps upgrades cannot break it.
temps_cli() {
  local bin="$TEMPS_CLI_HOME/node_modules/.bin/temps"
  if [[ -x "$bin" ]]; then
    (cd "$HOME" && "$bin" --target-context temps-local "$@")
  else
    (cd "$HOME" && npx -y "@temps-sdk/cli@$TEMPS_CLI_VERSION" --target-context temps-local "$@")
  fi
}

# Prints "slug|image of the current deployment|running copies on PREFERRED_NODE_NAME|deploys in flight".
app_rows() {
  local spec pid eid slug deps ctrs
  for spec in $APPS; do
    IFS=: read -r pid eid slug <<<"$spec"
    deps=$(temps_cli deployments list -p "$slug" --environment-id "$eid" -n 10 --json) || return 1
    ctrs=$(temps_cli containers list -p "$pid" -e "$eid" --json) || return 1
    DEPS="$deps" CTRS="$ctrs" python3 - "$slug" "$PREFERRED_NODE_NAME" "$IN_FLIGHT_MAX_SECS" <<'PY' || return 1
import json, os, sys, time
slug, node, max_age = sys.argv[1], sys.argv[2], int(sys.argv[3])
deps = json.loads(os.environ["DEPS"]); deps = deps.get("deployments", deps) if isinstance(deps, dict) else deps
ctrs = json.loads(os.environ["CTRS"])
running = [c for c in ctrs if c.get("status") == "running"]
images = {c.get("image_name") for c in running if c.get("image_name")}
done = ("completed", "failed", "stopped", "cancelled")
now_ms = time.time() * 1000
busy = 0
for d in deps:
    if d.get("status") in done:
        continue
    created = d.get("created_at") or 0
    if now_ms - created <= max_age * 1000:
        busy += 1          # recent and unfinished: in flight
    else:                  # old and unfinished (paused, or a status this script does not know)
        print(f"ha-failback: apps: {slug} deployment {d.get('id')} has been '{d.get('status')}' "
              f"for over {max_age}s; treating it as stuck, not in flight", file=sys.stderr)
if len(images) != 1:
    busy += 1          # zero or mixed images: something is mid-change, leave it alone
on_node = sum(1 for c in running if c.get("node_name") == node)
print(f"{slug}|{next(iter(images), '')}|{on_node}|{busy}")
PY
  done
}

failback_apps() {
  local rows slug image on_node
  # Only once Postgres and Dragonfly are both back home: whole-site failback.
  [[ "$(cat "$STATE_DIR/pg.at-home" 2>/dev/null)" == 1 && "$(cat "$STATE_DIR/cache.at-home" 2>/dev/null)" == 1 ]] || return 0
  if [[ -f "$STATE_DIR/apps.backoff-until" ]] && (( now < $(cat "$STATE_DIR/apps.backoff-until") )); then
    return 0
  fi
  # The CLI call costs a few seconds; when everything is in place, look only every APP_CHECK_SECS.
  if [[ ! -f "$STATE_DIR/apps.healthy-since" && -f "$STATE_DIR/apps.last-check" ]] \
     && (( now - $(cat "$STATE_DIR/apps.last-check") < APP_CHECK_SECS )); then
    return 0
  fi
  echo "$now" >"$STATE_DIR/apps.last-check"

  rows=$(app_rows) || { log "apps: Temps CLI failed; skipping"; return 0; }
  if grep -q '|[1-9][0-9]*$' <<<"$rows"; then
    unstable apps; return 0                    # a deploy is running
  fi
  if ! awk -F'|' '$3==0 {found=1} END {exit !found}' <<<"$rows"; then
    unstable apps; return 0                    # every app already has a copy there
  fi

  local up; up=$(stable apps)
  if (( up < STABLE_SECS )); then return 0; fi
  if cooling_down apps; then return 0; fi

  [[ "$DRY_RUN" == 1 ]] || mark_failback apps
  # One app at a time: parallel deploys of the same image raced on the image import.
  while IFS='|' read -r slug image on_node _; do
    [[ "$on_node" == 0 && -n "$image" ]] || continue
    log "apps: $slug has no copy on $PREFERRED_NODE_NAME; redeploying $image to spread it"
    if [[ "$DRY_RUN" == 1 ]]; then log "apps: DRY_RUN, not deploying"; continue; fi
    temps_cli deploy:image --image "$image" -p "$slug" -e production -y --timeout 900 \
      || log "apps: redeploy of $slug failed; will retry after the cooldown"
  done <<<"$rows"
  [[ "$DRY_RUN" == 1 ]] && return 0

  # Temps decides placement. If it still put no copy on the preferred node (drained or offline
  # there, which this CLI key cannot see), redeploying again every cooldown would only churn
  # production: back off.
  local after
  after=$(app_rows) || return 0
  if awk -F'|' '$3==0 {found=1} END {exit !found}' <<<"$after"; then
    echo $((now + APP_BACKOFF_SECS)) >"$STATE_DIR/apps.backoff-until"
    log "apps: Temps still placed no copy on $PREFERRED_NODE_NAME (drained or offline there?); not redeploying again for ${APP_BACKOFF_SECS}s"
  else
    rm -f "$STATE_DIR/apps.backoff-until"
  fi
}

failback_postgres
failback_cache
failback_apps
