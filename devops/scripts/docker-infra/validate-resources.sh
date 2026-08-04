#!/bin/bash
# ============================================================================
# validate-resources.sh — Disk space & resource validation before deploy
# ----------------------------------------------------------------------------
# Ensures the VPS has enough free disk space and emits a summary of running
# containers/images for the GitHub Step Summary.
#
# Usage:
#   validate-resources.sh [--min-gb N] [--docker-dir PATH]
#
# Exit codes:
#   0 - Sufficient resources
#   1 - Insufficient disk space (with diagnostic + cleanup suggestions)
#
# Requirements: 12.1, 12.2, 12.3
# ============================================================================

set -euo pipefail

MIN_GB=3
DOCKER_DIR="/var/lib/docker"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --min-gb)     MIN_GB="$2"; shift 2 ;;
        --docker-dir) DOCKER_DIR="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--min-gb N] [--docker-dir PATH]"
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

# Find the partition hosting the Docker data directory
PARTITION=$(df -P "$DOCKER_DIR" 2>/dev/null | awk 'NR==2 {print $1}')
if [[ -z "$PARTITION" ]]; then
    echo "ERROR: Could not determine partition for $DOCKER_DIR" >&2
    exit 1
fi

# Available space in GB (rounded down)
AVAIL_KB=$(df -P "$DOCKER_DIR" | awk 'NR==2 {print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
TOTAL_KB=$(df -P "$DOCKER_DIR" | awk 'NR==2 {print $2}')
TOTAL_GB=$((TOTAL_KB / 1024 / 1024))

# Count running containers per environment
PROD_COUNT=$(docker ps --filter "label=env=production" --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')
PREPROD_COUNT=$(docker ps --filter "label=env=preprod" --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')

# Count unused Docker images
UNUSED_IMAGES=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l | tr -d ' ')

# Emit JSON summary to stdout (used by GitHub Step Summary)
cat <<EOF
{
  "available_gb": ${AVAIL_GB},
  "total_gb": ${TOTAL_GB},
  "min_required_gb": ${MIN_GB},
  "partition": "${PARTITION}",
  "running_containers_production": ${PROD_COUNT},
  "running_containers_preprod": ${PREPROD_COUNT},
  "unused_images_count": ${UNUSED_IMAGES},
  "status": "$([ "$AVAIL_GB" -ge "$MIN_GB" ] && echo "ok" || echo "insufficient")"
}
EOF

# Gate decision
if [[ "$AVAIL_GB" -lt "$MIN_GB" ]]; then
    cat >&2 <<EOF

ERROR: Insufficient disk space for deployment.
  Partition:        ${PARTITION}
  Available:        ${AVAIL_GB} GB
  Required (min):   ${MIN_GB} GB

Suggested cleanup commands (run on the VPS as root):
  docker image prune -af
  docker container prune -f
  docker volume prune -f
  docker system prune -af --volumes

EOF
    exit 1
fi

echo "OK: ${AVAIL_GB} GB free >= ${MIN_GB} GB required." >&2
exit 0
