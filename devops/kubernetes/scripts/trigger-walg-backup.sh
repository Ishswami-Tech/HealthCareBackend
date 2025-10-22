#!/usr/bin/env bash
set -euo pipefail

# Triggers a WAL-G base backup using the wal-g sidecar in the postgres pod

NAMESPACE=${NAMESPACE:-healthcare-backend}
POD_NAME=${POD_NAME:-postgres-0}
CONTAINER=${CONTAINER:-wal-g-scheduler}

echo "[walg-backup] Triggering base backup on pod=$POD_NAME container=$CONTAINER namespace=$NAMESPACE"

kubectl -n "$NAMESPACE" exec "$POD_NAME" -c "$CONTAINER" -- \
  /wal-g-bin/wal-g backup-push /var/lib/postgresql/data/pgdata

echo "[walg-backup] Pruning old backups (retain 7)"
kubectl -n "$NAMESPACE" exec "$POD_NAME" -c "$CONTAINER" -- \
  /wal-g-bin/wal-g delete retain 7 --confirm || true

echo "[walg-backup] Done"

