#!/usr/bin/env bash
set -euo pipefail

# Reads required values from env and applies/creates healthcare-secrets
# Required env: DB_URL, DB_MIGRATION_URL, POSTGRES_USER, POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET
# Optional env: SESSION_SECRET, COOKIE_SECRET (defaults generated if not provided)

NAMESPACE=${NAMESPACE:-healthcare-backend}

require() {
  local var=$1
  if [ -z "${!var:-}" ]; then
    echo "[apply-healthcare-secrets] ERROR: $var is required" >&2
    exit 1
  fi
}

require DB_URL
require DB_MIGRATION_URL
require POSTGRES_USER
require POSTGRES_PASSWORD
require REDIS_PASSWORD
require JWT_SECRET

# Generate session secrets if not provided (minimum 32 characters)
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
COOKIE_SECRET="${COOKIE_SECRET:-$(openssl rand -hex 32)}"

kubectl create secret generic healthcare-secrets \
  --dry-run=client -o yaml \
  --namespace "$NAMESPACE" \
  --from-literal=database-url="$DB_URL" \
  --from-literal=database-migration-url="$DB_MIGRATION_URL" \
  --from-literal=postgres-user="$POSTGRES_USER" \
  --from-literal=postgres-password="$POSTGRES_PASSWORD" \
  --from-literal=redis-password="$REDIS_PASSWORD" \
  --from-literal=jwt-secret="$JWT_SECRET" \
  --from-literal=session-secret="$SESSION_SECRET" \
  --from-literal=cookie-secret="$COOKIE_SECRET" \
  | kubectl apply -f -

echo "[apply-healthcare-secrets] Applied secret 'healthcare-secrets' in namespace '$NAMESPACE'"

