#!/usr/bin/env bash
# Install or update self-hosted ClickStack (ClickHouse + HyperDX + OTel collector + MongoDB)
# on a Linux host with Docker. Idempotent: re-running updates to the pinned commit and keeps data.
#
#   sudo HYPERDX_PUBLIC_URL=https://observe.example.com ./setup.sh
#
# Data lives in bind mounts under $CLICKSTACK_DIR/.volumes (MongoDB app state, ClickHouse data
# and logs): include that directory in host backups.
set -euo pipefail

# Upstream has no release tags; pin the commit this overlay was written against.
CLICKSTACK_REF="${CLICKSTACK_REF:-82375a74ce217016fa3525c2210b3492b529bffe}"
CLICKSTACK_DIR="${CLICKSTACK_DIR:-/opt/clickstack}"
HYPERDX_PUBLIC_URL="${HYPERDX_PUBLIC_URL:?set HYPERDX_PUBLIC_URL, e.g. https://observe.example.com}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
compose_version="$(docker compose version --short 2>/dev/null || echo 0)"
if [ "$(printf '%s\n2.24.4\n' "$compose_version" | sort -V | head -1)" != "2.24.4" ]; then
  echo "Docker Compose >= 2.24.4 is required (found ${compose_version})" >&2
  exit 1
fi

if [ ! -d "$CLICKSTACK_DIR/.git" ]; then
  git clone https://github.com/ClickHouse/ClickStack.git "$CLICKSTACK_DIR"
fi
git -C "$CLICKSTACK_DIR" fetch --quiet origin
git -C "$CLICKSTACK_DIR" checkout --quiet "$CLICKSTACK_REF"

cp "$HERE/docker-compose.override.yml" "$CLICKSTACK_DIR/docker-compose.override.yml"

# Set KEY=VALUE in upstream's .env (replace if present, append otherwise).
set_env() {
  local key="$1" value="$2" file="$CLICKSTACK_DIR/.env"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}
set_env HYPERDX_PUBLIC_URL "$HYPERDX_PUBLIC_URL"
set_env HYPERDX_APP_URL "$HYPERDX_PUBLIC_URL"
set_env HYPERDX_LOG_LEVEL info

mkdir -p "$CLICKSTACK_DIR/.volumes/db" "$CLICKSTACK_DIR/.volumes/ch_data" "$CLICKSTACK_DIR/.volumes/ch_logs"
docker compose --project-directory "$CLICKSTACK_DIR" config --quiet
docker compose --project-directory "$CLICKSTACK_DIR" up -d

echo "ClickStack is starting."
echo "  UI:   http://127.0.0.1:$(grep '^HYPERDX_APP_PORT=' "$CLICKSTACK_DIR/.env" | cut -d= -f2) (publish as ${HYPERDX_PUBLIC_URL})"
echo "  OTLP: http://127.0.0.1:4318 (publish via TLS, e.g. https://otel.<domain>)"
echo "Next: open the UI, create the first user, then copy the ingestion key from Team Settings -> API Keys."
