#!/usr/bin/env bash
# Post-deploy check, run on the Temps control plane (CI pipes it over SSH: `bash -s -- IMAGE`).
# Passes only when, for the API and the worker project:
#   - exactly one running copy is on each node in EXPECTED_NODES (one per India node: temps-worker
#     amd64, oracle-main and oracle-vm2-dss arm64) and no copy runs anywhere else;
#   - every running copy runs IMAGE (the image this pipeline just deployed);
# and every API copy answers /infra-health on its node's mesh address, and the public API URL
# answers /health with 200.
# Retries until VERIFY_TIMEOUT_SECS, since Temps may still be removing the previous copies.
#
# Uses only the Temps CLI (pinned install of ha-failback, npx fallback), never Temps' database.
set -euo pipefail

IMAGE="${1:?usage: verify-temps-deploy.sh IMAGE}"
# project:environment:label
APPS="${APPS:-4:4:api 5:5:worker}"
# node name:mesh address
EXPECTED_NODES="${EXPECTED_NODES:-temps-worker-ubuntu:10.201.0.5 main-server:10.201.0.8 oracale-vm2-dss:10.201.0.6}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://api-in.ishswami.in/health}"
VERIFY_TIMEOUT_SECS="${VERIFY_TIMEOUT_SECS:-300}"
TEMPS_CLI_HOME="${TEMPS_CLI_HOME:-$HOME/.local/share/hcb-temps-cli}"
TEMPS_CLI_VERSION="${TEMPS_CLI_VERSION:-0.1.38}"

temps_cli() {
  local bin="$TEMPS_CLI_HOME/node_modules/.bin/temps"
  if [[ -x "$bin" ]]; then
    (cd "$HOME" && "$bin" --target-context temps-local "$@")
  else
    (cd "$HOME" && npx -y "@temps-sdk/cli@$TEMPS_CLI_VERSION" --target-context temps-local "$@")
  fi
}

# Prints one problem per line for project $1 / environment $2 (nothing when it is as expected),
# then "CONTAINER <node> <container id>" for each running copy. Never fails: an unreadable answer
# from the CLI (e.g. an HTML error page during a deploy) is reported as a problem, so the retry
# loop below tries again instead of `set -e` ending the check on the first glitch.
check_app() {
  local pid="$1" eid="$2" label="$3" ctrs
  ctrs=$(temps_cli containers list -p "$pid" -e "$eid" --json) || {
    echo "$label: Temps CLI could not list containers"
    return 0
  }
  CTRS="$ctrs" python3 - "$label" "$IMAGE" "$EXPECTED_NODES" <<'PY' || echo "$label: could not read the container list"
import json, os, sys
label, image, expected = sys.argv[1], sys.argv[2], sys.argv[3].split()
nodes = [e.split(":")[0] for e in expected]
try:
    containers = json.loads(os.environ["CTRS"])
except ValueError:
    print(f"{label}: the Temps CLI answered something other than JSON")
    sys.exit(0)
running = [c for c in containers if isinstance(c, dict) and c.get("status") == "running"]
for node in nodes:
    n = sum(1 for c in running if c.get("node_name") == node)
    if n != 1:
        print(f"{label}: {n} running copies on {node} (expected 1)")
for c in running:
    if c.get("node_name") not in nodes:
        print(f"{label}: unexpected copy {c.get('container_name')} on {c.get('node_name')}")
    if c.get("image_name") != image:
        print(f"{label}: {c.get('container_name')} on {c.get('node_name')} runs {c.get('image_name')}")
for c in running:
    print(f"CONTAINER {c.get('node_name')} {c.get('container_id')}")
PY
}

probe_api_copies() {
  local pid="$1" eid="$2" containers="$3" node id port addr
  while read -r _ node id; do
    [[ -n "$id" ]] || continue
    addr=""
    for entry in $EXPECTED_NODES; do
      [[ "${entry%%:*}" == "$node" ]] && addr="${entry#*:}"
    done
    [[ -n "$addr" ]] || continue
    port=$(temps_cli containers show -p "$pid" -e "$eid" -c "$id" --json \
      | python3 -c 'import json, sys; print(json.load(sys.stdin).get("host_port") or "")') || port=""
    if [[ ! "$port" =~ ^[0-9]+$ ]]; then
      echo "api: no host port for the copy on $node"
    elif ! curl -fsS -m 10 -o /dev/null "http://$addr:$port/infra-health"; then
      echo "api: the copy on $node ($addr:$port) does not answer /infra-health"
    fi
  done <<<"$containers"
}

deadline=$(( $(date +%s) + VERIFY_TIMEOUT_SECS ))
while :; do
  problems=""
  for spec in $APPS; do
    IFS=: read -r pid eid label <<<"$spec"
    out=$(check_app "$pid" "$eid" "$label" || echo "$label: check failed")
    problems+=$(grep -v '^CONTAINER ' <<<"$out" || true)$'\n'
    if [[ "$label" == api ]]; then
      problems+=$(probe_api_copies "$pid" "$eid" "$(grep '^CONTAINER ' <<<"$out" || true)")$'\n'
    fi
  done
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$PUBLIC_HEALTH_URL" || true)
  [[ "$code" == 200 ]] || problems+="public $PUBLIC_HEALTH_URL answered $code"$'\n'

  problems=$(sed '/^[[:space:]]*$/d' <<<"$problems")
  if [[ -z "$problems" ]]; then
    echo "verify: OK - API and worker run $IMAGE, one copy on each of: $(sed -E 's/:[^ ]+//g' <<<"$EXPECTED_NODES")"
    exit 0
  fi
  if (( $(date +%s) >= deadline )); then
    echo "verify: FAILED after ${VERIFY_TIMEOUT_SECS}s:"
    echo "$problems" | sed 's/^/  - /'
    exit 1
  fi
  echo "verify: not yet ($(wc -l <<<"$problems") problem(s)); retrying in 15s"
  sleep 15
done
