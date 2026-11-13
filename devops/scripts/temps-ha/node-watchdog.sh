#!/usr/bin/env bash
# Per-node watchdog for HealthCareBackend containers on a Temps node.
#
# Temps health-checks a replica only at deploy time, and its proxy keeps sending
# every other request to a replica that is running but hung (drill 2026-11-13:
# a frozen API copy held half the requests for the whole minute it was frozen).
# A crashed or stopped replica is fine (the proxy retries on the other one), so
# this turns "hung" into "restarting":
#
#   API copies:    GET /infra-health (no DB/cache/queue checks, so a database or
#                  cache failover never triggers a restart) every CHECK_SECS;
#                  FAIL_LIMIT failures in a row -> docker restart.
#   Worker copies: Docker's own HEALTHCHECK reports unhealthy -> docker restart.
#
# Only containers built from our image are touched (OCI source label), never in
# their first GRACE_SECS, and each at most once per COOLDOWN_SECS. It also starts
# the Temps agent if it is not running (Docker can take many minutes to start on
# a loaded VM, and a slow start used to cancel the agent for good).
#
# Uses only the Docker CLI and systemctl, nothing internal to Temps, so Temps
# upgrades cannot break it.
set -uo pipefail

CHECK_SECS="${CHECK_SECS:-5}"
FAIL_LIMIT="${FAIL_LIMIT:-3}"
GRACE_SECS="${GRACE_SECS:-180}"
COOLDOWN_SECS="${COOLDOWN_SECS:-600}"
IMAGE_SOURCE="${IMAGE_SOURCE:-https://github.com/Ishswami-Tech/HealthCareBackend}"
STATE_DIR="${STATE_DIR:-/run/hcb-node-watchdog}"

mkdir -p "$STATE_DIR"
log() { echo "node-watchdog: $*"; }

ensure_agent() {
  systemctl cat temps-agent.service >/dev/null 2>&1 || return 0   # not a worker node
  if ! systemctl is-active --quiet temps-agent.service; then
    log "temps-agent is $(systemctl is-active temps-agent.service); starting it"
    systemctl start --no-block temps-agent.service
  fi
}

# Prints "name|mode|started_epoch|health|probe_url" for each running container of our image.
list_ours() {
  docker ps -q --filter "label=org.opencontainers.image.source=$IMAGE_SOURCE" \
    | xargs -r docker inspect -f \
'{{.Name}}|{{range .Config.Env}}{{if eq (index (split . "=") 0) "APP_MODE"}}{{index (split . "=") 1}}{{end}}{{end}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{with index .NetworkSettings.Ports "8088/tcp"}}{{(index . 0).HostIp}}:{{(index . 0).HostPort}}{{end}}' \
    2>/dev/null | sed 's#^/##'
}

restart() {
  local name="$1" why="$2" last=0
  [[ -f "$STATE_DIR/$name.restarted" ]] && last=$(cat "$STATE_DIR/$name.restarted")
  if (( $(date +%s) - last < COOLDOWN_SECS )); then
    log "$name $why, but it was restarted $(( $(date +%s) - last ))s ago; leaving it (cooldown ${COOLDOWN_SECS}s)"
    return
  fi
  log "$name $why; restarting it"
  date +%s >"$STATE_DIR/$name.restarted"
  rm -f "$STATE_DIR/$name.fails"
  docker unpause "$name" >/dev/null 2>&1 || true   # Docker refuses to restart a paused container
  docker restart -t 10 "$name" >/dev/null 2>&1 || log "restart of $name failed"
}

check_once() {
  local name mode started health url age fails
  while IFS='|' read -r name mode started health url; do
    [[ -n "$name" ]] || continue
    age=$(( $(date +%s) - $(date -d "$started" +%s 2>/dev/null || date +%s) ))
    (( age < GRACE_SECS )) && { rm -f "$STATE_DIR/$name.fails"; continue; }

    if [[ "$mode" == worker ]]; then
      [[ "$health" == unhealthy ]] && restart "$name" "is unhealthy (Docker health check)"
      continue
    fi

    [[ -n "$url" ]] || continue                     # no published port: nothing routes to it
    url="${url/#0.0.0.0:/127.0.0.1:}"
    if curl -fsS -m 4 -o /dev/null "http://$url/infra-health"; then
      rm -f "$STATE_DIR/$name.fails"
      continue
    fi
    fails=$(( $(cat "$STATE_DIR/$name.fails" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" >"$STATE_DIR/$name.fails"
    log "$name did not answer /infra-health ($fails/$FAIL_LIMIT)"
    (( fails >= FAIL_LIMIT )) && restart "$name" "stopped answering /infra-health"
  done < <(list_ours)
}

if [[ "${1:-}" == --once ]]; then ensure_agent; check_once; exit 0; fi
log "watching containers from $IMAGE_SOURCE every ${CHECK_SECS}s"
while true; do
  ensure_agent
  check_once
  sleep "$CHECK_SECS"
done
