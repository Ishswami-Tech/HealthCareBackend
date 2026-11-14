#!/usr/bin/env bash
# Start the "dragonfly" cache forwarder for social-media. ACL_DIR holds social_media.pass.
set -euo pipefail
cd "$(dirname "$0")"
: "${ACL_DIR:?}"
pw=$(cat "$ACL_DIR/social_media.pass")
umask 022
sed "s/__PW__/$pw/" haproxy-redis.cfg.tmpl > "$ACL_DIR/haproxy-redis.cfg"   # dir is 0700
docker rm -f hcb-redis-forwarder >/dev/null 2>&1 || true
docker run -d --name hcb-redis-forwarder --restart unless-stopped \
  --network temps-app-network --network-alias dragonfly \
  -v "$ACL_DIR/haproxy-redis.cfg":/usr/local/etc/haproxy/haproxy.cfg:ro haproxy:lts-alpine >/dev/null
for net in $(docker network ls --format '{{.Name}}' | grep -E '^temps[0-9]+$'); do
  docker network connect --alias dragonfly "$net" hcb-redis-forwarder
done
echo "hcb-redis-forwarder started (alias dragonfly on: $(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' hcb-redis-forwarder))"
