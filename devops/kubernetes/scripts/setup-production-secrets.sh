#!/usr/bin/env bash
# Bash script to setup production secrets from .env.production

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.production"

echo "🔐 Setting up production secrets from .env.production..."

# Check if .env.production exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env.production file not found at: $ENV_FILE"
    echo "   Please create .env.production file with production values."
    exit 1
fi

# Check if namespace exists
if ! kubectl get namespace healthcare-backend &> /dev/null; then
    echo "   Creating namespace..."
    kubectl create namespace healthcare-backend
fi

# Read .env.production
echo "   Reading .env.production..."
source "$ENV_FILE" || {
    echo "⚠️  Warning: Could not source .env.production directly. Parsing manually..."
    # Fallback: parse manually
    while IFS='=' read -r key value || [ -n "$key" ]; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        
        # Remove quotes
        value=$(echo "$value" | sed "s/^['\"]\(.*\)['\"]$/\1/")
        
        # Export variable
        export "$key=$value"
    done < "$ENV_FILE"
}

# Extract required values
POSTGRES_USER="${POSTGRES_USER:-postgres}"
if [ -z "${DATABASE_URL:-}" ]; then
    echo "❌ DATABASE_URL not found in .env.production"
    exit 1
fi

# Extract password from DATABASE_URL if not set separately
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    POSTGRES_PASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
fi

# Update DATABASE_URL to use Kubernetes service names
DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/postgres:\/\//postgresql:\/\//')
DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/@localhost:/@postgres:/')
DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/@127\.0\.0\.1:/@postgres:/')

DB_MIGRATION_URL="${DATABASE_URL}"  # Same for now

REDIS_PASSWORD="${REDIS_PASSWORD:-}"
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"

JWT_SECRET="${JWT_SECRET:-}"
if [ -z "$JWT_SECRET" ] || [[ "$JWT_SECRET" =~ CHANGE_THIS ]]; then
    echo "❌ JWT_SECRET not set or still using default value in .env.production"
    echo "   Please set a secure JWT_SECRET in .env.production"
    exit 1
fi

# Session secrets (required for Fastify session with CacheService/Dragonfly)
SESSION_SECRET="${SESSION_SECRET:-}"
if [ -z "$SESSION_SECRET" ] || [ ${#SESSION_SECRET} -lt 32 ]; then
    echo "⚠️  SESSION_SECRET not set or too short (min 32 chars). Generating one..."
    SESSION_SECRET=$(openssl rand -hex 32)
fi

COOKIE_SECRET="${COOKIE_SECRET:-}"
if [ -z "$COOKIE_SECRET" ] || [ ${#COOKIE_SECRET} -lt 32 ]; then
    echo "⚠️  COOKIE_SECRET not set or too short (min 32 chars). Generating one..."
    COOKIE_SECRET=$(openssl rand -hex 32)
fi

# Optional secrets
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "   Creating healthcare-secrets..."

# Delete existing secret if it exists
kubectl delete secret healthcare-secrets -n healthcare-backend 2>&1 || true

# Build secret command
kubectl create secret generic healthcare-secrets \
    --namespace healthcare-backend \
    --from-literal=postgres-user="$POSTGRES_USER" \
    --from-literal=postgres-password="$POSTGRES_PASSWORD" \
    --from-literal=database-url="$DATABASE_URL" \
    --from-literal=database-migration-url="$DB_MIGRATION_URL" \
    --from-literal=redis-password="$REDIS_PASSWORD" \
    --from-literal=jwt-secret="$JWT_SECRET" \
    --from-literal=session-secret="$SESSION_SECRET" \
    --from-literal=cookie-secret="$COOKIE_SECRET" \
    ${GOOGLE_CLIENT_ID:+--from-literal=google-client-id="$GOOGLE_CLIENT_ID"} \
    ${GOOGLE_CLIENT_SECRET:+--from-literal=google-client-secret="$GOOGLE_CLIENT_SECRET"} \
    ${AWS_ACCESS_KEY_ID:+--from-literal=aws-access-key-id="$AWS_ACCESS_KEY_ID"} \
    ${AWS_SECRET_ACCESS_KEY:+--from-literal=aws-secret-access-key="$AWS_SECRET_ACCESS_KEY"} \
    ${AWS_REGION:+--from-literal=aws-region="$AWS_REGION"}

echo "✅ Production secrets created successfully"
echo ""
echo "📝 Secrets created:"
echo "   ✅ postgres-user: $POSTGRES_USER"
echo "   ✅ postgres-password: ****"
echo "   ✅ database-url: ${DATABASE_URL:0:50}..."
echo "   ✅ redis-password: ${REDIS_PASSWORD:+****}"
echo "   ✅ jwt-secret: ****"
[ -n "$GOOGLE_CLIENT_ID" ] && echo "   ✅ google-client-id: ****"
[ -n "$AWS_ACCESS_KEY_ID" ] && echo "   ✅ aws-access-key-id: ****"

echo ""
echo "⚠️  Make sure your .env.production file:"
echo "   1. Has secure passwords (not defaults)"
echo "   2. Uses Kubernetes service names (postgres, redis) for hosts"
echo "   3. Has a strong JWT_SECRET"

