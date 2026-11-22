#!/usr/bin/env bash
# Last-resort placement for the Temps apps: contabo-ds runs an app only while ALL of its
# primary nodes are down.
#
# Every app's environment targets the three India primaries, temps-worker, oracle-main and
# oracle-vm2-dss (target_nodes [6,10,11], one copy on each). Temps itself moves a copy between
# them when one fails, but it has no
# notion of a node that may only be used once the others are gone: with contabo-ds among the
# targets it would place copies there in normal operation, and Europe must never serve beside
# India (2026-11-17: an API copy on contabo-ds broke doctor loading). So contabo-ds stays out of
# the targets, and this script, run every minute from a timer on the control plane, does the
# rest:
#
#   fallback  once every primary node of an app has been down for DOWN_SECS, its public URL no
#             longer answers, and contabo-ds is up: target_nodes [9] and redeploy the app's
#             current deployment (Temps' rollback to it: same image, no rebuild, no new code).
#   restore   once one of the app's primaries has been up for UP_SECS: target_nodes back to
#             NORMAL_TARGETS and redeploy the current deployment again, which places it on the
#             primaries. Data (Postgres, Dragonfly) follows via hcb-ha-failback as before.
#
# An app's primaries are the nodes its image can run on: apps built only for amd64 (Temps builds
# them on the amd64 control plane) list just temps-worker, since Temps never places them on the
# arm64 oracle-main / oracle-vm2-dss; for them, temps-worker down is "all primaries down".
#
# A node is up while its Temps agent accepts a TCP connection on AGENT_PORT over the mesh: a
# stopped, rebooting or frozen VM does not. The public URL check guards against the control
# plane alone losing the mesh: if anyone still serves the app, it is not moved.
#
# Env overrides: APPS, PRIMARY_NODES, FALLBACK_NODE, NORMAL_TARGETS, DOWN_SECS, UP_SECS,
# RETRY_SECS, AGENT_PORT, PROBE_TIMEOUT_SECS, DEPLOY_TIMEOUT_SECS, ROLLBACK_TIMEOUT_SECS, STATE_DIR, TEMPS_CONTEXTS,
# TEMPS_CONTEXT, DRY_RUN=1 (log what would happen, change nothing),
# FAKE_DOWN_NODES=6,10 (testing: treat these node ids as down without probing them).
set -euo pipefail

# id:name:mesh-address
PRIMARY_NODES="${PRIMARY_NODES:-6:temps-worker-ubuntu:10.201.0.5 10:main-server:10.201.0.8 11:oracale-vm2-dss:10.201.0.6}"
FALLBACK_NODE="${FALLBACK_NODE:-9:contabo-ds:10.201.0.7}"
NORMAL_TARGETS="${NORMAL_TARGETS:-[6,10,11]}"
# project|environment|slug|primary node ids|public URL that answers only while a copy serves it.
# In priority order: the patient-facing API first, workers last.
APPS="${APPS:-
4|4|healthcarebackend|6,10,11|https://api-in.ishswami.in/health
12|13|dataspace-one|6,10,11|https://one.dataspacesecurity.com/
8|8|social-media-web|6,10,11|https://social-media.ishswami.in/api/health
7|7|governance-ops|6|https://governanceops.dataspacesecurity.com/
6|6|vishwayog|6|https://www.shreevishwayogayurved.com/
5|5|healthcarebackend-worker|6,10,11|https://healthcare-worker.ishswami.in/health
9|9|social-media-worker|6,10,11|https://social-media-worker.ishswami.in/health
}"
DOWN_SECS="${DOWN_SECS:-300}"       # Temps marks a node offline after 90 s and fails over after 300 s
UP_SECS="${UP_SECS:-300}"
RETRY_SECS="${RETRY_SECS:-600}"     # after a failed move, wait this long before trying again
AGENT_PORT="${AGENT_PORT:-3100}"
PROBE_TIMEOUT_SECS="${PROBE_TIMEOUT_SECS:-5}"
DEPLOY_TIMEOUT_SECS="${DEPLOY_TIMEOUT_SECS:-900}"
ROLLBACK_TIMEOUT_SECS="${ROLLBACK_TIMEOUT_SECS:-300}"  # how long to wait for the rollback call itself
DRY_RUN="${DRY_RUN:-0}"
FAKE_DOWN_NODES="${FAKE_DOWN_NODES:-}"
STATE_DIR="${STATE_DIR:-/var/lib/temps-ds-fallback}"
TEMPS_CONTEXTS="${TEMPS_CONTEXTS:-/home/deploy/.temps/.contexts.json}"
TEMPS_CONTEXT="${TEMPS_CONTEXT:-temps-local}"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || { echo "ds-fallback: previous run still busy"; exit 0; }
now=$(date +%s)

log() { echo "ds-fallback: $*"; }
# Logs a message once per state change, not every minute.
log_once() {
  local key="$1"; shift
  local f="$STATE_DIR/$key.said"
  [[ -f "$f" && "$(cat "$f")" == "$*" ]] && return 0
  echo "$*" >"$f"; log "$*"
}

# The Temps API, with the key of the CLI context the other HA scripts use. Commands:
#   targets PROJECT ENV JSON   set the environment's target_nodes, and nothing else (never the
#                              console's Save, which also rewrites the security settings and
#                              unpublishes the tunnels)
#   redeploy PROJECT ENV TARGETS TRACK_FILE
#                              redeploy the environment's current deployment where its targets
#                              now point (Temps' rollback to it: same image, no rebuild), and wait
#                              until that deployment finishes; fails unless it completed
#
# The rollback call can take minutes to answer: Temps first copies the image to the node (4 GB for
# governance-ops) but has already created the deployment. On 2026-11-22 a 60 s client timeout made
# every attempt look failed although the deployment came up, and each retry started a new
# deployment over the running one (seven needless restarts). So: a timed-out rollback is followed
# up by finding the deployment it created; the deployment started for a move is remembered in
# TRACK_FILE ("<targets> <id>") and a later run follows it instead of starting another; and a
# deployment superseded by a newer one hands over to that one.
temps_api() {
  python3 - "$TEMPS_CONTEXTS" "$TEMPS_CONTEXT" "$DEPLOY_TIMEOUT_SECS" "$ROLLBACK_TIMEOUT_SECS" "$@" <<'PY'
import json, socket, sys, time, urllib.error, urllib.request
contexts, name, timeout, rollback_timeout, cmd, project, env = sys.argv[1:8]
ctx = next(c for c in json.load(open(contexts)) if c["name"] == name)

def call(method, path, body=None, timeout=60):
    req = urllib.request.Request(
        ctx["url"] + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + ctx["apiKey"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None

if cmd == "targets":
    call("PUT", f"/projects/{project}/environments/{env}/settings", {"target_nodes": json.loads(sys.argv[8])})
    sys.exit(0)

def timed_out(e):
    return isinstance(e, (TimeoutError, socket.timeout)) or (
        isinstance(e, urllib.error.URLError) and not isinstance(e, urllib.error.HTTPError)
        and isinstance(e.reason, (TimeoutError, socket.timeout)))

if cmd == "redeploy":
    targets, track = sys.argv[8], sys.argv[9]
    BAD = ("failed", "cancelled")
    deadline = time.time() + int(timeout)

    def env_deps():
        deps = call("GET", f"/projects/{project}/deployments?environment_id={env}&per_page=50")["deployments"]
        return [d for d in deps if str(d.get("environment_id")) == env]

    def remember(i):
        with open(track, "w") as f:
            f.write(f"{targets} {i}\n")

    def follow(i):
        """Wait for deployment i; if something newer supersedes it, follow that one instead."""
        while True:
            status = call("GET", f"/projects/{project}/deployments/{i}").get("status")
            if status == "completed":
                sys.exit(0)
            if status in BAD:
                sys.exit(f"deployment {i} {status}")
            if status == "stopped":
                newer = [d for d in env_deps() if d["id"] > i]
                if not newer:
                    sys.exit(f"deployment {i} stopped")
                i = max(d["id"] for d in newer)
                print(f"superseded; following deployment {i}", flush=True)
                remember(i)
                continue
            if time.time() > deadline:
                sys.exit(f"deployment {i} not finished after {timeout}s")
            time.sleep(10)

    # A deployment an earlier run started for this same move: follow it, never start another over it.
    try:
        prev_targets, prev_id = open(track).read().split()
        prev_id = int(prev_id)
    except (OSError, ValueError):
        prev_targets = prev_id = None
    if prev_id is not None and prev_targets == targets:
        status = call("GET", f"/projects/{project}/deployments/{prev_id}").get("status")
        superseded = status == "stopped" and any(d["id"] > prev_id for d in env_deps())
        if status not in BAD and (status != "stopped" or superseded):
            print(f"following deployment {prev_id} started earlier ({status})", flush=True)
            follow(prev_id)

    deps = env_deps()
    current = [d for d in deps if d.get("is_current")]
    if not current:
        sys.exit("no current deployment to redeploy")
    newest_before = max(d["id"] for d in deps)
    try:
        new_id = call("POST", f"/projects/{project}/deployments/{current[0]['id']}/rollback",
                      timeout=int(rollback_timeout))["id"]
        print(f"redeploying deployment {current[0]['id']} as {new_id}", flush=True)
    except Exception as e:
        if not timed_out(e):
            raise
        new_id = None
        for _ in range(30):
            newer = [d["id"] for d in env_deps() if d["id"] > newest_before]
            if newer:
                new_id = max(newer)
                break
            time.sleep(10)
        if new_id is None:
            sys.exit(f"rollback of deployment {current[0]['id']} timed out and no new deployment appeared")
        print(f"rollback of deployment {current[0]['id']} still running after {rollback_timeout}s; "
              f"following deployment {new_id}", flush=True)
    remember(new_id)
    follow(new_id)
sys.exit(f"unknown command {cmd}")
PY
}
set_targets() { temps_api targets "$1" "$2" "$3"; }
# redeploy_current PROJECT ENV SLUG TARGETS
redeploy_current() {
  local out rc=0
  out=$(temps_api redeploy "$1" "$2" "$4" "$STATE_DIR/$3.deploy" 2>&1) || rc=$?
  log "$3: ${out//$'\n'/; }"
  return "$rc"
}

# ---------------------------------------------------------------- nodes
node_up() {
  local id="$1" address="$2" attempt
  [[ ",$FAKE_DOWN_NODES," == *",$id,"* ]] && return 1
  for attempt in 1 2; do
    timeout "$PROBE_TIMEOUT_SECS" bash -c "exec 3<>/dev/tcp/$address/$AGENT_PORT" 2>/dev/null && return 0
  done
  return 1
}

# For each node: NODE_UP_SECS[id] (>= 0 while up) and NODE_DOWN_SECS[id] (>= 0 while down).
declare -A NODE_UP_SECS NODE_DOWN_SECS NODE_NAME
track_node() {
  local id="$1" name="$2" address="$3" up_f="$STATE_DIR/node-$1.up-since" down_f="$STATE_DIR/node-$1.down-since"
  NODE_NAME[$id]="$name"
  if node_up "$id" "$address"; then
    rm -f "$down_f"; [[ -f "$up_f" ]] || echo "$now" >"$up_f"
    NODE_UP_SECS[$id]=$((now - $(cat "$up_f"))); NODE_DOWN_SECS[$id]=-1
    log_once "node-$id" "$name is up"
  else
    rm -f "$up_f"; [[ -f "$down_f" ]] || echo "$now" >"$down_f"
    NODE_DOWN_SECS[$id]=$((now - $(cat "$down_f"))); NODE_UP_SECS[$id]=-1
    log_once "node-$id" "$name is DOWN (agent $address:$AGENT_PORT not answering)"
  fi
}

for spec in $PRIMARY_NODES; do IFS=: read -r id name address <<<"$spec"; track_node "$id" "$name" "$address"; done
IFS=: read -r FALLBACK_ID FALLBACK_NAME FALLBACK_ADDRESS <<<"$FALLBACK_NODE"
track_node "$FALLBACK_ID" "$FALLBACK_NAME" "$FALLBACK_ADDRESS"

# Seconds all of these primaries have been down together (-1 if one is up).
all_down_secs() {
  local ids="$1" id least=-1
  for id in ${ids//,/ }; do
    (( ${NODE_DOWN_SECS[$id]:--1} < 0 )) && { echo -1; return; }
    (( least < 0 || NODE_DOWN_SECS[$id] < least )) && least=${NODE_DOWN_SECS[$id]}
  done
  echo "$least"
}
# Longest any of these primaries has been up (-1 if all are down).
any_up_secs() {
  local ids="$1" id most=-1
  for id in ${ids//,/ }; do
    (( ${NODE_UP_SECS[$id]:--1} > most )) && most=${NODE_UP_SECS[$id]}
  done
  echo "$most"
}

# 2xx–4xx from the public URL means some copy is serving it (Cloudflare answers 5xx when no
# origin does).
serving() {
  local code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$1" || true)
  [[ "$code" =~ ^[234][0-9][0-9]$ ]]
}

retry_wait() {
  local f="$STATE_DIR/$1.last-attempt"
  [[ -f "$f" ]] && (( now - $(cat "$f") < RETRY_SECS ))
}

# ---------------------------------------------------------------- apps
# STATE_DIR/<slug>.on-fallback exists while an app's targets point at the fallback node; it holds
# "moving" until the deploy there completed, then "moved".
move() {
  local project="$1" env="$2" slug="$3" targets="$4" where="$5"
  echo "$now" >"$STATE_DIR/$slug.last-attempt"
  set_targets "$project" "$env" "$targets" || { log "$slug: could not set its targets; retrying in ${RETRY_SECS}s"; return 1; }
  [[ "$targets" == "[$FALLBACK_ID]" ]] && echo moving >"$STATE_DIR/$slug.on-fallback"
  if redeploy_current "$project" "$env" "$slug" "$targets"; then
    rm -f "$STATE_DIR/$slug.last-attempt" "$STATE_DIR/$slug.deploy"; log "$slug: now on $where"; return 0
  fi
  log "$slug: deploy to $where failed; retrying in ${RETRY_SECS}s"; return 1
}

while IFS='|' read -r project env slug primaries url; do
  [[ -n "$project" ]] || continue
  on_fallback="$STATE_DIR/$slug.on-fallback"
  up=$(any_up_secs "$primaries")

  if [[ -f "$on_fallback" ]]; then
    if (( up < 0 )); then
      if [[ "$(cat "$on_fallback")" == moving ]] && ! retry_wait "$slug"; then
        log "$slug: retrying the deploy to $FALLBACK_NAME"
        [[ "$DRY_RUN" == 1 ]] && { log "$slug: DRY_RUN, not moving"; continue; }
        move "$project" "$env" "$slug" "[$FALLBACK_ID]" "$FALLBACK_NAME" && echo moved >"$on_fallback"
      else
        log_once "$slug" "$slug: on $FALLBACK_NAME, primaries still down"
      fi
      continue
    fi
    if (( up < UP_SECS )); then
      log_once "$slug" "$slug: on $FALLBACK_NAME, a primary is back; moving home once it has been up ${UP_SECS}s"
      continue
    fi
    retry_wait "$slug" && continue
    log "$slug: a primary has been up ${up}s; moving back to $NORMAL_TARGETS"
    [[ "$DRY_RUN" == 1 ]] && { log "$slug: DRY_RUN, not moving"; continue; }
    move "$project" "$env" "$slug" "$NORMAL_TARGETS" "its primaries" && rm -f "$on_fallback"
    continue
  fi

  down=$(all_down_secs "$primaries")
  (( down < 0 )) && { log_once "$slug" "$slug: on its primaries"; continue; }
  if (( down < DOWN_SECS )); then
    log_once "$slug" "$slug: its primaries are down; falling back after ${DOWN_SECS}s"
    continue
  fi
  if serving "$url"; then
    log_once "$slug" "$slug: primaries unreachable from here, but $url still answers; not moving"
    continue
  fi
  if (( ${NODE_UP_SECS[$FALLBACK_ID]} < 0 )); then
    log_once "$slug" "$slug: primaries down and $FALLBACK_NAME down too; nowhere to move"
    continue
  fi
  retry_wait "$slug" && continue
  log "$slug: primaries ($primaries) down for ${down}s and $url not answering; moving to $FALLBACK_NAME"
  [[ "$DRY_RUN" == 1 ]] && { log "$slug: DRY_RUN, not moving"; continue; }
  move "$project" "$env" "$slug" "[$FALLBACK_ID]" "$FALLBACK_NAME" && echo moved >"$on_fallback"
done <<<"$APPS"
