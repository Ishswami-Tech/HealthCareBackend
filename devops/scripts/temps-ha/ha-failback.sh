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
# Env overrides: PREFERRED_PG_NODE, PREFERRED_CACHE, PREFERRED_TEMPS_NODE, APP_PROJECTS,
# STABLE_SECS, COOLDOWN_SECS, MAX_LAG_BYTES, DRY_RUN=1 (log what would happen, change nothing).
set -euo pipefail

PREFERRED_PG_NODE="${PREFERRED_PG_NODE:-postgres-postgres-main-1}"   # temps-worker
PREFERRED_CACHE="${PREFERRED_CACHE:-10.201.0.5:6512}"                 # temps-worker
STABLE_SECS="${STABLE_SECS:-300}"
COOLDOWN_SECS="${COOLDOWN_SECS:-1800}"
MAX_LAG_BYTES="${MAX_LAG_BYTES:-16777216}"
DRY_RUN="${DRY_RUN:-0}"
PREFERRED_TEMPS_NODE="${PREFERRED_TEMPS_NODE:-6}"                     # temps-worker
APP_PROJECTS="${APP_PROJECTS:-healthcarebackend healthcarebackend-worker}"

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
# down stay there. Once the data layer is back on the preferred node and that node is
# heartbeating, redeploy the current image so Temps spreads the replicas again.
temps_sql() {
  docker exec -i temps-timescaledb psql -X -q -At -F'|' -v ON_ERROR_STOP=1 -U temps -d temps "$@"
}

failback_apps() {
  local node_ok rows slug image on_node busy
  # Only once Postgres and Dragonfly are both back home: whole-site failback.
  [[ "$(cat "$STATE_DIR/pg.at-home" 2>/dev/null)" == 1 && "$(cat "$STATE_DIR/cache.at-home" 2>/dev/null)" == 1 ]] || return 0

  node_ok=$(temps_sql -c "SELECT count(*) FROM nodes WHERE id = $PREFERRED_TEMPS_NODE AND status = 'active'
      AND drain_requested_at IS NULL AND last_heartbeat > now() - interval '90 seconds'") \
    || { log "apps: Temps DB unreachable; skipping"; return 0; }
  # slug|current image|running containers on the preferred node|deployments in flight
  rows=$(temps_sql <<SQL
SELECT p.slug, d.image_name,
       (SELECT count(*) FROM deployment_containers c WHERE c.deployment_id = d.id
          AND c.node_id = $PREFERRED_TEMPS_NODE AND c.status = 'running' AND c.deleted_at IS NULL),
       (SELECT count(*) FROM deployments x WHERE x.project_id = p.id
          AND x.state NOT IN ('completed', 'failed', 'stopped', 'cancelled'))
FROM projects p
JOIN environments e ON e.project_id = p.id AND e.slug = 'production' AND e.deleted_at IS NULL
JOIN deployments d ON d.id = e.current_deployment_id
WHERE p.slug IN ($(printf "'%s'," $APP_PROJECTS | sed 's/,$//'))
  AND (e.deployment_config -> 'targetNodes') @> '[$PREFERRED_TEMPS_NODE]'
ORDER BY p.id;
SQL
  ) || { log "apps: Temps DB unreachable; skipping"; return 0; }

  if [[ "$node_ok" != 1 ]] || grep -q '|[1-9][0-9]*$' <<<"$rows"; then
    unstable apps; return 0                    # node not heartbeating, or a deploy is running
  fi
  if ! awk -F'|' '$3==0 {found=1} END {exit !found}' <<<"$rows"; then
    unstable apps; return 0                    # every project already has a replica there
  fi

  local up; up=$(stable apps)
  if (( up < STABLE_SECS )); then return 0; fi
  if cooling_down apps; then return 0; fi

  [[ "$DRY_RUN" == 1 ]] || mark_failback apps
  # One project at a time: parallel deploys of the same image raced on the image import.
  while IFS='|' read -r slug image on_node _; do
    [[ "$on_node" == 0 ]] || continue
    log "apps: $slug has no replica on node $PREFERRED_TEMPS_NODE; redeploying $image to spread it"
    if [[ "$DRY_RUN" == 1 ]]; then log "apps: DRY_RUN, not deploying"; continue; fi
    (cd "$HOME" && npx -y @temps-sdk/cli --target-context temps-local deploy:image \
       --image "$image" -p "$slug" -e production -y --timeout 900) \
      || log "apps: redeploy of $slug failed; will retry after the cooldown"
  done <<<"$rows"
}

failback_postgres
failback_cache
failback_apps
