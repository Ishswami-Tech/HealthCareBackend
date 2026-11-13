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
#                  cache failover never triggers a restart) every CHECK_SECS.
#                  Restarted only when FAIL_LIMIT probes in a row failed AND Docker's
#                  own health check is failing too: two independent observers over
#                  ~50 s, so a copy that is merely slow under a traffic spike is not
#                  restarted (which would push all traffic onto the other copy).
#                  Live drill 2026-11-13: frozen API copy detected and restarted.
#   Worker copies: Docker's own HEALTHCHECK reports unhealthy -> docker restart.
#
# Only containers built from our image are touched (OCI source label), never while
# Docker still reports them `starting`, and never in their first GRACE_SECS. A copy is
# restarted at most once per MIN_RESTART_GAP_SECS and MAX_RESTARTS_PER_HOUR times per
# hour: a copy that hangs again soon after a restart is restarted again, but one that
# restarting does not fix is left alone (and logged) instead of being restarted forever.
#
# It also starts the Temps agent if it is not running, but only during the first
# AGENT_GUARD_WINDOW_SECS after boot (Docker can take many minutes to start on the
# temps-worker VM, and a slow start makes systemd cancel the agent for good). Later
# a stopped agent is left alone - maintenance or a Temps upgrade stops it on purpose.
# Touch $AGENT_GUARD_DISABLE_FILE to turn the guard off entirely.
#
# Uses only the Docker CLI and systemctl, nothing internal to Temps, so Temps
# upgrades cannot break it. Every docker call has a timeout so a stuck dockerd
# cannot freeze the loop.
set -uo pipefail

CHECK_SECS="${CHECK_SECS:-5}"
PROBE_TIMEOUT_SECS="${PROBE_TIMEOUT_SECS:-5}"
FAIL_LIMIT="${FAIL_LIMIT:-5}"
GRACE_SECS="${GRACE_SECS:-180}"
MIN_RESTART_GAP_SECS="${MIN_RESTART_GAP_SECS:-120}"
MAX_RESTARTS_PER_HOUR="${MAX_RESTARTS_PER_HOUR:-3}"
DOCKER_TIMEOUT_SECS="${DOCKER_TIMEOUT_SECS:-30}"
# docker restart of a hung process: 10 s stop grace, SIGKILL, then start (measured ~50 s).
RESTART_TIMEOUT_SECS="${RESTART_TIMEOUT_SECS:-120}"
AGENT_GUARD_WINDOW_SECS="${AGENT_GUARD_WINDOW_SECS:-3600}"
AGENT_GUARD_DISABLE_FILE="${AGENT_GUARD_DISABLE_FILE:-/etc/hcb/temps-agent-guard.disabled}"
IMAGE_SOURCE="${IMAGE_SOURCE:-https://github.com/Ishswami-Tech/HealthCareBackend}"
STATE_DIR="${STATE_DIR:-/run/hcb-node-watchdog}"
UPTIME_FILE="${UPTIME_FILE:-/proc/uptime}"

mkdir -p "$STATE_DIR"
log() { echo "node-watchdog: $*"; }
dockr() { timeout "$DOCKER_TIMEOUT_SECS" docker "$@"; }

uptime_secs() { cut -d' ' -f1 "$UPTIME_FILE" | cut -d. -f1; }

ensure_agent() {
  systemctl cat temps-agent.service >/dev/null 2>&1 || return 0   # not a worker node
  if systemctl is-active --quiet temps-agent.service; then
    rm -f "$STATE_DIR/agent-left-alone"
    return 0
  fi
  [[ -e "$AGENT_GUARD_DISABLE_FILE" ]] && return 0
  local up
  up=$(uptime_secs)
  if (( up > AGENT_GUARD_WINDOW_SECS )); then
    # Outside the boot window a stopped agent is deliberate (maintenance, upgrade). Say so once.
    if [[ ! -f "$STATE_DIR/agent-left-alone" ]]; then
      log "temps-agent is $(systemctl is-active temps-agent.service), ${up}s after boot; leaving it (boot guard only covers ${AGENT_GUARD_WINDOW_SECS}s)"
      touch "$STATE_DIR/agent-left-alone"
    fi
    return 0
  fi
  log "temps-agent is $(systemctl is-active temps-agent.service) ${up}s after boot; starting it"
  systemctl start --no-block temps-agent.service
}

# One line per running container of our image:
#   name|mode|startedAt|health status|health failing streak|published host ip|published port
list_ours() {
  local ids
  ids=$(dockr ps -q --filter "label=org.opencontainers.image.source=$IMAGE_SOURCE") || return 1
  [[ -n "$ids" ]] || return 0
  # A container can vanish between ps and inspect (deploys replace them); inspect then exits
  # non-zero but still prints the others, which are judged as usual.
  # shellcheck disable=SC2086 # ids is a whitespace-separated list of container ids
  dockr inspect -f \
'{{.Name}}|{{range .Config.Env}}{{if eq (index (split . "=") 0) "APP_MODE"}}{{index (split . "=") 1}}{{end}}{{end}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}|{{.State.Health.FailingStreak}}{{else}}|0{{end}}|{{with index .NetworkSettings.Ports "8088/tcp"}}{{(index . 0).HostIp}}|{{(index . 0).HostPort}}{{else}}|{{end}}' \
    $ids 2>/dev/null | sed 's#^/##'
  return 0
}

# host:port to probe for a published binding (all-interfaces bindings are probed on loopback).
probe_address() {
  local ip="$1" port="$2"
  case "$ip" in
    "" | 0.0.0.0 | ::) echo "127.0.0.1:$port" ;;
    *:*) echo "[$ip]:$port" ;; # IPv6 literal
    *) echo "$ip:$port" ;;
  esac
}

restart() {
  local name="$1" why="$2" now last=0 recent=0 file="$STATE_DIR/$name.restarts"
  now=$(date +%s)
  # Restart times of the last hour, oldest first.
  if [[ -f "$file" ]]; then
    awk -v cutoff=$((now - 3600)) '$1 > cutoff' "$file" >"$file.tmp" && mv "$file.tmp" "$file"
    recent=$(wc -l <"$file")
    last=$(tail -1 "$file" 2>/dev/null || echo 0)
  fi
  if (( recent >= MAX_RESTARTS_PER_HOUR )); then
    log "$name $why, but it was already restarted $recent times in the last hour; leaving it - restarting does not fix it, look at its logs"
    return
  fi
  if (( now - ${last:-0} < MIN_RESTART_GAP_SECS )); then
    log "$name $why, but it was restarted $(( now - last ))s ago; waiting (minimum gap ${MIN_RESTART_GAP_SECS}s)"
    return
  fi
  log "$name $why; restarting it ($((recent + 1)) in the last hour)"
  echo "$now" >>"$file"
  rm -f "$STATE_DIR/$name.fails"
  dockr unpause "$name" >/dev/null 2>&1 || true   # Docker refuses to restart a paused container
  timeout "$RESTART_TIMEOUT_SECS" docker restart -t 10 "$name" >/dev/null 2>&1 \
    || log "restart of $name did not finish within ${RESTART_TIMEOUT_SECS}s"
}

check_once() {
  local listing name mode started health streak ip port age fails
  if ! listing=$(list_ours); then
    log "docker ps failed or did not answer within ${DOCKER_TIMEOUT_SECS}s; skipping this round"
    return
  fi
  while IFS='|' read -r name mode started health streak ip port; do
    [[ -n "$name" ]] || continue
    # Still booting by Docker's own account, or within the grace period: nothing to judge yet.
    if [[ "$health" == starting ]]; then rm -f "$STATE_DIR/$name.fails"; continue; fi
    age=$(( $(date +%s) - $(date -d "$started" +%s 2>/dev/null || date +%s) ))
    if (( age < GRACE_SECS )); then rm -f "$STATE_DIR/$name.fails"; continue; fi

    if [[ "$mode" == worker ]]; then
      [[ "$health" == unhealthy ]] && restart "$name" "is unhealthy (Docker health check)"
      continue
    fi

    [[ -n "$port" ]] || continue                    # no published port: nothing routes to it
    if curl -fsS -m "$PROBE_TIMEOUT_SECS" -o /dev/null "http://$(probe_address "$ip" "$port")/infra-health"; then
      rm -f "$STATE_DIR/$name.fails"
      continue
    fi
    fails=$(( $(cat "$STATE_DIR/$name.fails" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" >"$STATE_DIR/$name.fails"
    log "$name did not answer /infra-health ($fails/$FAIL_LIMIT, Docker health: ${health:-none}, failing streak ${streak:-0})"
    # Docker's check (same endpoint, its own schedule) must be failing too: a copy that is
    # only slow under load passes it now and then and is left alone.
    if (( fails >= FAIL_LIMIT )) && [[ "${streak:-0}" =~ ^[0-9]+$ ]] && (( streak >= 1 )); then
      restart "$name" "stopped answering /infra-health (and Docker's health check is failing)"
    fi
  done <<<"$listing"
}

if [[ "${1:-}" == --once ]]; then ensure_agent; check_once; exit 0; fi
log "watching containers from $IMAGE_SOURCE every ${CHECK_SECS}s"
while true; do
  ensure_agent
  check_once
  sleep "$CHECK_SECS"
done
