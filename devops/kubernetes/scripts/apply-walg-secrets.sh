#!/usr/bin/env bash
set -euo pipefail

# Reads required values from env and applies/creates wal-g-secrets
# Required env: WALG_S3_PREFIX, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, WALG_S3_ENDPOINT

NAMESPACE=${NAMESPACE:-healthcare-backend}

require() {
  local var=$1
  if [ -z "${!var:-}" ]; then
    echo "[apply-walg-secrets] ERROR: $var is required" >&2
    exit 1
  fi
}

require WALG_S3_PREFIX
require AWS_ACCESS_KEY_ID
require AWS_SECRET_ACCESS_KEY
require AWS_REGION
require WALG_S3_ENDPOINT

kubectl create secret generic wal-g-secrets \
  --dry-run=client -o yaml \
  --namespace "$NAMESPACE" \
  --from-literal=WALG_S3_PREFIX="$WALG_S3_PREFIX" \
  --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  --from-literal=AWS_REGION="$AWS_REGION" \
  --from-literal=WALG_S3_ENDPOINT="$WALG_S3_ENDPOINT" \
  --from-literal=WALG_S3_FORCE_PATH_STYLE="true" \
  | kubectl apply -f -

echo "[apply-walg-secrets] Applied secret 'wal-g-secrets' in namespace '$NAMESPACE'"

