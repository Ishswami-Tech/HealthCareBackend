#!/usr/bin/env bash
# Bash script to setup local development secrets
# This creates secrets with default values suitable for local development

set -euo pipefail

echo "🔐 Setting up local development secrets..."

# Check if namespace exists
if ! kubectl get namespace healthcare-backend &> /dev/null; then
    echo "   Creating namespace..."
    kubectl create namespace healthcare-backend
fi

# Default values for local development
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres123}"
REDIS_PASSWORD="${REDIS_PASSWORD:-redis123}"
JWT_SECRET="${JWT_SECRET:-local-dev-jwt-secret-change-in-production-$(openssl rand -hex 16)}"
SESSION_SECRET="${SESSION_SECRET:-local-dev-session-secret-$(openssl rand -hex 32)}"
COOKIE_SECRET="${COOKIE_SECRET:-local-dev-cookie-secret-$(openssl rand -hex 32)}"

# Database URLs
DB_URL="${DB_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/userdb?schema=public}"
DB_MIGRATION_URL="${DB_MIGRATION_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/userdb?schema=public}"

echo "   Creating healthcare-secrets..."

# Delete existing secret if it exists
kubectl delete secret healthcare-secrets -n healthcare-backend 2>&1 || true

# Create secret
kubectl create secret generic healthcare-secrets \
    --namespace healthcare-backend \
    --from-literal=postgres-user="$POSTGRES_USER" \
    --from-literal=postgres-password="$POSTGRES_PASSWORD" \
    --from-literal=database-url="$DB_URL" \
    --from-literal=database-migration-url="$DB_MIGRATION_URL" \
    --from-literal=redis-password="$REDIS_PASSWORD" \
    --from-literal=jwt-secret="$JWT_SECRET" \
    --from-literal=session-secret="$SESSION_SECRET" \
    --from-literal=cookie-secret="$COOKIE_SECRET"

echo "✅ Secrets created successfully"
echo ""
echo "📝 Default values used (override with environment variables):"
echo "   POSTGRES_USER: $POSTGRES_USER"
echo "   POSTGRES_PASSWORD: $POSTGRES_PASSWORD"
echo "   REDIS_PASSWORD: $REDIS_PASSWORD"
echo "   JWT_SECRET: ${JWT_SECRET:0:20}..."
echo ""
echo "⚠️  These are default values for local development only!"
echo "   Use strong, unique values in production."

