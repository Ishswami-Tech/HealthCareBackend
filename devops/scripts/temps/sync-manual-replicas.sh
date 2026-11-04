#!/usr/bin/env bash
# Re-applies the manual fixes a normal Temps deploy can't do on its own:
#
#   1. Temps's "Docker Image" deploy type always runs the image's baked-in
#      default command — there is no start-command override. So every time
#      the Worker service redeploys, Temps hands it the API's default command
#      (dist/main.js) instead of dist/worker-bootstrap.js. This script builds
#      a one-line wrapper image (same base, CMD overridden) and swaps it in
#      for whatever Temps just created on the x86 node (temps-worker).
#
#   2. Temps's scheduler cannot reach the arm64 node (oracle-main) at all, so
#      both the API and Worker replicas there are entirely manual — this
#      script rebuilds/redeploys both with the new image tag.
#
# Must run somewhere that can SSH to contabo-healthcare (Temps control-plane +
# DB), temps-worker (x86 node) and oracle-main (arm64 node). temps-worker is a
# private-LAN VM with no path from any cloud host — including the Temps
# control-plane itself (its firewall only allows Temps's own control traffic
# over the mesh) — so today that means the self-hosted CI runner on the local
# hypervisor, which already holds the SSH config/keys for all three hosts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_FULL="$1"                 # e.g. ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:preprod-<sha>
GHCR_TOKEN="${2:?GHCR_TOKEN required (oracle-main has no stored registry credentials)}"
GHCR_ACTOR="${3:?GHCR_ACTOR (github.actor) required for docker login}"

TAG="${IMAGE_FULL##*:}"
WRAPPER_TAG="healthcare-worker-local:${TAG}"
WORKER_ENV_ID=5
API_ENV_ID=4
WORKER_NODE_ID_TEMPS_WORKER=6
ORACLE_NODE_ID=4

run_psql_script() {
  ssh contabo-healthcare "sudo python3 -I - $2" < "${SCRIPT_DIR}/$1"
}

latest_deployment_id() {
  ssh contabo-healthcare "sudo docker exec -i temps-timescaledb psql -U temps -d temps -t -A -c \"SELECT id FROM deployments WHERE environment_id = $1 ORDER BY id DESC LIMIT 1;\""
}

echo "== Syncing manual replicas to ${IMAGE_FULL} =="

# ---------------------------------------------------------------------------
# 1. x86 Worker wrapper (temps-worker) — find whatever Temps's own deploy
#    just created for the worker environment on this node, and replace it.
# ---------------------------------------------------------------------------
echo "-- temps-worker: worker wrapper --"

WRONG_ROW=$(run_psql_script find_latest_container.py "${WORKER_ENV_ID} ${WORKER_NODE_ID_TEMPS_WORKER}")

if [ -z "$WRONG_ROW" ]; then
  echo "No running worker container found on temps-worker for this deployment — skipping."
else
  WRONG_ROW_ID=$(echo "$WRONG_ROW" | cut -f1)
  WRONG_CONTAINER_ID=$(echo "$WRONG_ROW" | cut -f2)
  HOST_PORT=$(echo "$WRONG_ROW" | cut -f3)
  echo "Replacing Temps-created container ${WRONG_CONTAINER_ID} (row ${WRONG_ROW_ID}, port ${HOST_PORT})"

  cat <<DOCKERFILE | ssh temps-worker "sudo docker build -t '${WRAPPER_TAG}' -f - /tmp"
FROM ${IMAGE_FULL}
CMD ["node", "dist/worker-bootstrap.js"]
DOCKERFILE

  run_psql_script export_env.py "${WORKER_ENV_ID}" > /tmp/worker_env_sync
  scp -q /tmp/worker_env_sync temps-worker:/tmp/worker_env_sync
  rm -f /tmp/worker_env_sync

  ssh temps-worker "
    set -e
    sudo docker rm -f '${WRONG_CONTAINER_ID}' healthcarebackend-worker-local >/dev/null 2>&1 || true
    sudo docker run -d --name healthcarebackend-worker-local --restart unless-stopped \
      --network temps-app-network -p 10.201.0.5:${HOST_PORT}:8088 \
      --env-file /tmp/worker_env_sync '${WRAPPER_TAG}'
    sudo docker network connect temps2 healthcarebackend-worker-local
    sudo docker restart healthcarebackend-worker-local
  "

  NEW_CONTAINER_ID=$(ssh temps-worker "sudo docker inspect healthcarebackend-worker-local --format '{{.Id}}'")
  run_psql_script register_container.py "update ${WRONG_ROW_ID} ${NEW_CONTAINER_ID} healthcarebackend-worker-local ${WRAPPER_TAG} ${HOST_PORT} 8088"
fi

# ---------------------------------------------------------------------------
# 2. oracle-main (arm64) — Temps never schedules here, so refresh both
#    replicas from the new tag by hand. Needs a real registry login: unlike
#    temps-worker (which Temps's own pipeline just pulled the tag onto),
#    nothing pulls new tags onto oracle-main automatically.
# ---------------------------------------------------------------------------
echo "-- oracle-main: docker login + pull new tag --"
printf '%s' "${GHCR_TOKEN}" | ssh oracle-main "sudo docker login ghcr.io -u '${GHCR_ACTOR}' --password-stdin"
ssh oracle-main "sudo docker pull '${IMAGE_FULL}'"

echo "-- oracle-main: API replica --"
API_DEPLOYMENT_ID=$(latest_deployment_id "${API_ENV_ID}")
run_psql_script export_env.py "${API_ENV_ID}" > /tmp/api_env_sync
scp -q /tmp/api_env_sync oracle-main:/tmp/api_env_sync
rm -f /tmp/api_env_sync
ssh oracle-main "
  set -e
  sudo docker rm -f healthcarebackend-oracle-arm64 >/dev/null 2>&1 || true
  sudo docker run -d --name healthcarebackend-oracle-arm64 --restart unless-stopped \
    --network temps-app-network -p 10.201.0.2:32900:8088 \
    --env-file /tmp/api_env_sync '${IMAGE_FULL}'
  sudo docker network connect temps2 healthcarebackend-oracle-arm64
  sudo docker restart healthcarebackend-oracle-arm64
"
API_CONTAINER_ID=$(ssh oracle-main "sudo docker inspect healthcarebackend-oracle-arm64 --format '{{.Id}}'")
run_psql_script register_container.py "insert ${API_DEPLOYMENT_ID} ${ORACLE_NODE_ID} ${API_CONTAINER_ID} healthcarebackend-oracle-arm64 ${IMAGE_FULL} 32900 8088"

echo "-- oracle-main: worker replica --"
WORKER_DEPLOYMENT_ID=$(latest_deployment_id "${WORKER_ENV_ID}")
ssh oracle-main "sudo docker build -t '${WRAPPER_TAG}' -f - /tmp" <<DOCKERFILE
FROM ${IMAGE_FULL}
CMD ["node", "dist/worker-bootstrap.js"]
DOCKERFILE

run_psql_script export_env.py "${WORKER_ENV_ID}" > /tmp/worker_env_sync_oracle
scp -q /tmp/worker_env_sync_oracle oracle-main:/tmp/worker_env_sync_oracle
rm -f /tmp/worker_env_sync_oracle
ssh oracle-main "
  set -e
  sudo docker rm -f healthcarebackend-worker-oracle-arm64 >/dev/null 2>&1 || true
  sudo docker run -d --name healthcarebackend-worker-oracle-arm64 --restart unless-stopped \
    --network temps-app-network -p 10.201.0.2:32901:8088 \
    --env-file /tmp/worker_env_sync_oracle '${WRAPPER_TAG}'
  sudo docker network connect temps2 healthcarebackend-worker-oracle-arm64
  sudo docker restart healthcarebackend-worker-oracle-arm64
"
WORKER_CONTAINER_ID=$(ssh oracle-main "sudo docker inspect healthcarebackend-worker-oracle-arm64 --format '{{.Id}}'")
run_psql_script register_container.py "insert ${WORKER_DEPLOYMENT_ID} ${ORACLE_NODE_ID} ${WORKER_CONTAINER_ID} healthcarebackend-worker-oracle-arm64 ${WRAPPER_TAG} 32901 8088"

echo "== Sync complete =="
echo "Verifying health..."
for host in temps-worker oracle-main; do
  for name in healthcarebackend-worker-local healthcarebackend-oracle-arm64 healthcarebackend-worker-oracle-arm64; do
    ssh "$host" "sudo docker ps --filter name='^${name}\$' --format '{{.Names}}: {{.Status}}'" 2>/dev/null || true
  done
done
