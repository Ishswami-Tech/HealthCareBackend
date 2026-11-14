#!/usr/bin/env bash
# Install the postgres-main primary forwarder on one node. Run from this directory.
#   MESH_IP=10.201.0.5 MEMBER=postgres-postgres-main-1 PGPORT=6261 bash install.sh
# FORWARDER=0 installs only the role agent (nodes where no pzxq-using app runs).
set -euo pipefail
cd "$(dirname "$0")"
: "${MESH_IP:?}" "${MEMBER:?}" "${PGPORT:?}"
DIR=${DIR:-/etc/hcb-pg-forwarder}  # contabo-ds (no passwordless sudo): DIR=$HOME/hcb-pg-forwarder
SUDO=$([ -w "$(dirname "$DIR")" ] && echo "" || echo "sudo -n")
$SUDO mkdir -p $DIR
$SUDO install -m 0755 role.sh $DIR/role.sh
$SUDO install -m 0644 haproxy.cfg $DIR/haproxy.cfg
docker rm -f hcb-pg-role >/dev/null 2>&1 || true
docker run -d --name hcb-pg-role --restart unless-stopped \
  -e MEMBER="$MEMBER" -e PGPORT="$PGPORT" \
  -v /var/run/docker.sock:/var/run/docker.sock -v $DIR/role.sh:/role.sh:ro \
  -p "$MESH_IP:6268:5000" alpine:3.20 \
  sh -c 'apk add --no-cache docker-cli socat >/dev/null && exec socat TCP-LISTEN:5000,fork,reuseaddr SYSTEM:/role.sh' >/dev/null
echo "hcb-pg-role started"
if [ "${FORWARDER:-1}" = 1 ]; then
  docker rm -f hcb-pg-forwarder >/dev/null 2>&1 || true
  docker run -d --name hcb-pg-forwarder --restart unless-stopped \
    --network temps-app-network --network-alias postgres-postgres-pzxq \
    -v $DIR/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro haproxy:lts-alpine >/dev/null
  # Temps also puts some app containers on its per-node network (temps0, temps1, ...)
  # instead of temps-app-network; answer on those too, under the same name.
  for net in $(docker network ls --format '{{.Name}}' | grep -E '^temps[0-9]+$'); do
    docker network connect --alias postgres-postgres-pzxq "$net" hcb-pg-forwarder
  done
  echo "hcb-pg-forwarder started (alias postgres-postgres-pzxq on: $(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' hcb-pg-forwarder))"
fi
