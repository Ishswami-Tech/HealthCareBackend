#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-healthcare-backend}

log() { printf "[validate] %s\n" "$*"; }
fail=false

check_secret() {
  local name=$1
  if ! kubectl get secret "$name" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "ERROR: secret '$name' not found in namespace '$NAMESPACE'"
    fail=true
    return 1
  fi
  return 0
}

check_key() {
  local secret=$1 key=$2 label=${3:-$2}
  if ! kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath="{.data.$key}" >/dev/null 2>&1; then
    log "ERROR: key '$key' missing in secret '$secret'"
    fail=true
    return 1
  fi
  return 0
}

log "Validating required secrets in namespace: $NAMESPACE"

# healthcare-secrets
if check_secret healthcare-secrets; then
  for key in database-url database-migration-url postgres-user postgres-password redis-password jwt-secret; do
    check_key healthcare-secrets "$key" || true
  done
fi

# wal-g-secrets
if check_secret wal-g-secrets; then
  for key in WALG_S3_PREFIX AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION WALG_S3_ENDPOINT; do
    check_key wal-g-secrets "$key" || true
  done
fi

if [ "$fail" = true ]; then
  log "Validation FAILED"
  exit 1
else
  log "Validation PASSED"
fi

