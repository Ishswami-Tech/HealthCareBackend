#!/usr/bin/env bash
# Run on each node holding an HA Dragonfly copy. ACL_DIR holds social_media.pass (0600).
set -euo pipefail
cd "$(dirname "$0")"
: "${ACL_DIR:?}"
cp acl-ensure.sh "$ACL_DIR/acl-ensure.sh" 2>/dev/null || sudo -n cp acl-ensure.sh "$ACL_DIR/acl-ensure.sh"
docker rm -f hcb-dragonfly-acl >/dev/null 2>&1 || true
docker run -d --name hcb-dragonfly-acl --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock -v "$ACL_DIR":/acl:ro alpine:3.20 \
  sh -c 'apk add --no-cache docker-cli >/dev/null && exec sh /acl/acl-ensure.sh' >/dev/null
echo "hcb-dragonfly-acl started"
