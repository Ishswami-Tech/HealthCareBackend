#!/bin/bash
# Deployment script for Healthcare Backend
# This script is executed on the server via SSH from GitHub Actions

set -e  # Exit on any error

# Cleanup function for failed deployments ONLY
# Preserves successful deployments (with docker-compose.prod.yml) for rollback
cleanup_failed_deployment_artifacts() {
    if [ -n "${DEPLOY_PATH}" ] && [ -d "${DEPLOY_PATH}" ]; then
        cd "${DEPLOY_PATH}" 2>/dev/null || return
        
        # Only clean up if there's NO successful deployment
        if [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
            echo -e "${YELLOW}🧹 Cleaning up failed deployment artifacts (no successful deployment found)...${NC}"
            
            # Remove partial git clones (failed clone attempt)
            [ -d ".git" ] && rm -rf .git 2>/dev/null && echo -e "${YELLOW}  → Removed .git directory from failed clone${NC}" || true
            
            # Remove incomplete source code (failed clone)
            if [ -d "src" ]; then
                echo -e "${YELLOW}  → Removing incomplete source code from failed clone...${NC}"
                rm -rf src package.json package-lock.json yarn.lock tsconfig.json .eslintrc* .prettierrc* 2>/dev/null || true
            fi
            
            # Remove build artifacts from failed builds
            [ -d "node_modules" ] && rm -rf node_modules 2>/dev/null && echo -e "${YELLOW}  → Removed node_modules from failed build${NC}" || true
            [ -d "dist" ] && rm -rf dist 2>/dev/null && echo -e "${YELLOW}  → Removed dist from failed build${NC}" || true
        else
            echo -e "${GREEN}  ✓ Successful deployment found (docker-compose exists) - preserving for rollback${NC}"
        fi
    fi
}

# Register cleanup trap for script failures
trap 'EXIT_CODE=$?; if [ $EXIT_CODE -ne 0 ]; then cleanup_failed_deployment_artifacts; fi' EXIT

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_PATH="${SERVER_DEPLOY_PATH:-/opt/healthcare-backend}"
# COMPOSE_FILE will be set after we cd to DEPLOY_PATH (relative path)
IMAGE_FULL="${IMAGE:-ghcr.io/your-username/your-repo/healthcare-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Rollback configuration
ROLLBACK_FILE="${DEPLOY_PATH}/.deployment-rollback"
PREVIOUS_IMAGE_TAG=""

echo -e "${GREEN}🚀 Starting deployment...${NC}"
echo -e "${GREEN}📋 Deploy script version: 2.0 (no repository cloning required)${NC}"

# Navigate to deployment directory (create if it doesn't exist)
echo -e "${YELLOW}📁 Navigating to deployment directory: ${DEPLOY_PATH}${NC}"
mkdir -p "${DEPLOY_PATH}"
cd "${DEPLOY_PATH}" || {
    echo -e "${RED}❌ Failed to navigate to deployment directory: ${DEPLOY_PATH}${NC}"
    exit 1
}

# Cleanup function for FAILED deployments only
# This only removes incomplete/failed deployment artifacts, not successful ones
cleanup_failed_deployment_only() {
    echo -e "${YELLOW}🧹 Cleaning up FAILED deployment artifacts only...${NC}"
    
    # Remove partial git clones (indicates failed clone attempt)
    if [ -d ".git" ]; then
        echo -e "${YELLOW}  → Removing .git directory (from failed clone attempt)...${NC}"
        rm -rf .git || true
    fi
    
    # Remove incomplete source code ONLY if docker-compose is missing (indicates failed clone)
    # If docker-compose exists, it's a successful deployment - keep it for rollback
    if [ -d "src" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
        echo -e "${YELLOW}  → Removing incomplete source code (failed clone - no docker-compose found)...${NC}"
        rm -rf src package.json package-lock.json yarn.lock tsconfig.json .eslintrc* .prettierrc* 2>/dev/null || true
    fi
    
    # Remove build artifacts ONLY if they're from failed builds (no docker-compose)
    if [ -d "node_modules" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
        echo -e "${YELLOW}  → Removing node_modules from failed build...${NC}"
        rm -rf node_modules || true
    fi
    
    if [ -d "dist" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
        echo -e "${YELLOW}  → Removing dist from failed build...${NC}"
        rm -rf dist || true
    fi
    
    # Remove temporary files from failed deployments
    find . -maxdepth 1 -name "*.tmp" -o -name "*.bak" -o -name "*.old" 2>/dev/null | while read -r file; do
        echo -e "${YELLOW}  → Removing temporary file: ${file}${NC}"
        rm -f "${file}" || true
    done
    
    # Remove empty directories (except essential ones)
    find . -mindepth 1 -maxdepth 1 -type d ! -name 'devops' ! -name 'logs' -empty -exec rmdir {} + 2>/dev/null || true
}

# Clean up ONLY failed/incomplete deployments
# Successful deployments are kept for rollback purposes
echo -e "${YELLOW}🧹 Checking for failed deployment artifacts...${NC}"

# Check for failed clone attempts (.git without docker-compose = failed)
if [ -d ".git" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
    echo -e "${YELLOW}  → Found failed git clone attempt (git exists but no docker-compose)...${NC}"
    cleanup_failed_deployment_only
elif [ -d ".git" ] && [ -f "devops/docker/docker-compose.prod.yml" ]; then
    # Git exists but docker-compose also exists - might be from old deployment method
    # Remove git but keep docker-compose (successful deployment)
    echo -e "${YELLOW}  → Removing .git directory (not needed, but keeping successful deployment files)...${NC}"
    rm -rf .git || true
fi

# Check for incomplete deployments (src exists but no docker-compose = failed)
if [ -d "src" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
    echo -e "${YELLOW}  → Found incomplete deployment (src exists but no docker-compose)...${NC}"
    cleanup_failed_deployment_only
elif [ -d "src" ] && [ -f "devops/docker/docker-compose.prod.yml" ]; then
    # Source code AND docker-compose exist - this is a successful deployment
    # Keep it for rollback, but we can remove git if it exists
    echo -e "${GREEN}  ✓ Found successful deployment (docker-compose exists) - keeping for rollback${NC}"
fi

# Remove build artifacts ONLY if they're from failed builds (no docker-compose)
if [ -d "node_modules" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
    echo -e "${YELLOW}  → Removing node_modules from failed build...${NC}"
    rm -rf node_modules || true
fi

if [ -d "dist" ] && [ ! -f "devops/docker/docker-compose.prod.yml" ]; then
    echo -e "${YELLOW}  → Removing dist from failed build...${NC}"
    rm -rf dist || true
fi

# Ensure devops/docker directory exists
mkdir -p devops/docker

echo -e "${GREEN}✅ Cleanup completed (only failed deployments removed)${NC}"

# Set COMPOSE_FILE relative to current directory (we're now in DEPLOY_PATH)
COMPOSE_FILE="devops/docker/docker-compose.prod.yml"

# Ensure docker-compose file exists (copied by GitHub Actions, no need to clone entire repo)
echo -e "${YELLOW}🔍 Checking for docker-compose file: ${COMPOSE_FILE}${NC}"
if [ ! -f "${COMPOSE_FILE}" ]; then
    echo -e "${RED}❌ Docker Compose file not found: ${COMPOSE_FILE}${NC}"
    echo -e "${YELLOW}⚠️  The docker-compose.prod.yml file should be copied by GitHub Actions.${NC}"
    echo -e "${YELLOW}⚠️  If this is a manual deployment, ensure the file exists at: ${COMPOSE_FILE}${NC}"
    echo -e "${YELLOW}📂 Current directory: $(pwd)${NC}"
    echo -e "${YELLOW}📂 Directory contents:${NC}"
    ls -la . || true
    if [ -d "devops" ]; then
        echo -e "${YELLOW}📂 devops/ contents:${NC}"
        ls -la devops/ || true
        if [ -d "devops/docker" ]; then
            echo -e "${YELLOW}📂 devops/docker/ contents:${NC}"
            ls -la devops/docker/ || true
        else
            echo -e "${YELLOW}⚠️  devops/docker/ directory does not exist${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  devops/ directory does not exist${NC}"
    fi
    exit 1
fi

echo -e "${GREEN}✅ Docker Compose file found: ${COMPOSE_FILE}${NC}"

# Check if .env.production already exists (created by GitHub Actions)
if [ -f ".env.production" ]; then
    echo -e "${GREEN}✅ .env.production file already exists (created by GitHub Actions)${NC}"
    chmod 600 ".env.production"
else
    echo -e "${YELLOW}⚠️  .env.production not found, creating from environment variables...${NC}"
    ENV_FILE=".env.production"
    
    # Write environment variables to .env.production
    # Only write variables that are set and not empty
    {
    # Application Configuration
    [ -n "${NODE_ENV}" ] && echo "NODE_ENV=${NODE_ENV}"
    [ -n "${IS_DEV}" ] && echo "IS_DEV=${IS_DEV}"
    
    # Database Configuration
    [ -n "${DATABASE_URL}" ] && echo "DATABASE_URL=${DATABASE_URL}"
    [ -n "${DIRECT_URL}" ] && echo "DIRECT_URL=${DIRECT_URL}"
    [ -n "${DATABASE_SQL_INJECTION_PREVENTION_ENABLED}" ] && echo "DATABASE_SQL_INJECTION_PREVENTION_ENABLED=${DATABASE_SQL_INJECTION_PREVENTION_ENABLED}"
    [ -n "${DATABASE_ROW_LEVEL_SECURITY_ENABLED}" ] && echo "DATABASE_ROW_LEVEL_SECURITY_ENABLED=${DATABASE_ROW_LEVEL_SECURITY_ENABLED}"
    [ -n "${DATABASE_DATA_MASKING_ENABLED}" ] && echo "DATABASE_DATA_MASKING_ENABLED=${DATABASE_DATA_MASKING_ENABLED}"
    [ -n "${DATABASE_RATE_LIMITING_ENABLED}" ] && echo "DATABASE_RATE_LIMITING_ENABLED=${DATABASE_RATE_LIMITING_ENABLED}"
    
    # Cache Configuration
    [ -n "${CACHE_ENABLED}" ] && echo "CACHE_ENABLED=${CACHE_ENABLED}"
    [ -n "${CACHE_PROVIDER}" ] && echo "CACHE_PROVIDER=${CACHE_PROVIDER}"
    
    # Dragonfly Configuration
    [ -n "${DRAGONFLY_ENABLED}" ] && echo "DRAGONFLY_ENABLED=${DRAGONFLY_ENABLED}"
    [ -n "${DRAGONFLY_HOST}" ] && echo "DRAGONFLY_HOST=${DRAGONFLY_HOST}"
    [ -n "${DRAGONFLY_PORT}" ] && echo "DRAGONFLY_PORT=${DRAGONFLY_PORT}"
    [ -n "${DRAGONFLY_KEY_PREFIX}" ] && echo "DRAGONFLY_KEY_PREFIX=${DRAGONFLY_KEY_PREFIX}"
    [ -n "${DRAGONFLY_PASSWORD}" ] && echo "DRAGONFLY_PASSWORD=${DRAGONFLY_PASSWORD}"
    
    # Redis Configuration
    [ -n "${REDIS_HOST}" ] && echo "REDIS_HOST=${REDIS_HOST}"
    [ -n "${REDIS_PORT}" ] && echo "REDIS_PORT=${REDIS_PORT}"
    [ -n "${REDIS_TTL}" ] && echo "REDIS_TTL=${REDIS_TTL}"
    [ -n "${REDIS_PREFIX}" ] && echo "REDIS_PREFIX=${REDIS_PREFIX}"
    [ -n "${REDIS_ENABLED}" ] && echo "REDIS_ENABLED=${REDIS_ENABLED}"
    [ -n "${REDIS_PASSWORD}" ] && echo "REDIS_PASSWORD=${REDIS_PASSWORD}"
    
    # Application URLs
    [ -n "${PORT}" ] && echo "PORT=${PORT}"
    [ -n "${API_PREFIX}" ] && echo "API_PREFIX=${API_PREFIX}"
    [ -n "${HOST}" ] && echo "HOST=${HOST}"
    [ -n "${BIND_ADDRESS}" ] && echo "BIND_ADDRESS=${BIND_ADDRESS}"
    [ -n "${BASE_URL}" ] && echo "BASE_URL=${BASE_URL}"
    [ -n "${API_URL}" ] && echo "API_URL=${API_URL}"
    [ -n "${FRONTEND_URL}" ] && echo "FRONTEND_URL=${FRONTEND_URL}"
    [ -n "${MAIN_DOMAIN}" ] && echo "MAIN_DOMAIN=${MAIN_DOMAIN}"
    [ -n "${API_DOMAIN}" ] && echo "API_DOMAIN=${API_DOMAIN}"
    [ -n "${FRONTEND_DOMAIN}" ] && echo "FRONTEND_DOMAIN=${FRONTEND_DOMAIN}"
    
    # Clinic-Specific Frontend URLs (Multi-Tenant)
    # ============================================
    # ARCHITECTURE: Single Backend API, Multiple Frontends
    # - Each clinic has its own frontend URL (e.g., https://vishwamurti.viddhakarma.com)
    # - All frontends connect to the SAME backend API (API_URL)
    # - Each frontend automatically sends X-Clinic-ID header in all requests
    # - Backend uses X-Clinic-ID to identify which clinic the request is for
    #
    # IMPORTANT: All clinic frontend URLs MUST be added to CORS_ORIGIN variable
    # Format: Comma-separated list (no spaces after commas)
    # Example: "https://ishswami.in,https://vishwamurti.viddhakarma.com,https://clinic2.viddhakarma.com"
    #
    # Pattern: CLINIC_{SANITIZED_CLINIC_NAME}_FRONTEND_URL
    # Example: "Vishwamurti Ayurvedelay" → "VISHWAMURTI_AYURVEDELAY"
    #
    # To add more clinics, duplicate the pattern below with the clinic's sanitized name
    # Example for "Aadesh Ayurvedalay":
    # [ -n "${CLINIC_AADESH_AYURVEDELAY_FRONTEND_URL}" ] && echo "CLINIC_AADESH_AYURVEDELAY_FRONTEND_URL=${CLINIC_AADESH_AYURVEDELAY_FRONTEND_URL}"
    #
    # Vishwamurti Ayurvedelay (CL0001)
    [ -n "${CLINIC_VISHWAMURTI_AYURVEDELAY_FRONTEND_URL}" ] && echo "CLINIC_VISHWAMURTI_AYURVEDELAY_FRONTEND_URL=${CLINIC_VISHWAMURTI_AYURVEDELAY_FRONTEND_URL}"
    
    # JWT Configuration
    [ -n "${JWT_SECRET}" ] && echo "JWT_SECRET=${JWT_SECRET}"
    [ -n "${JWT_EXPIRATION}" ] && echo "JWT_EXPIRATION=${JWT_EXPIRATION}"
    [ -n "${JWT_ACCESS_EXPIRES_IN}" ] && echo "JWT_ACCESS_EXPIRES_IN=${JWT_ACCESS_EXPIRES_IN}"
    [ -n "${JWT_REFRESH_EXPIRES_IN}" ] && echo "JWT_REFRESH_EXPIRES_IN=${JWT_REFRESH_EXPIRES_IN}"
    [ -n "${JWT_REFRESH_SECRET}" ] && echo "JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}"
    
    # Prisma Configuration
    [ -n "${PRISMA_SCHEMA_PATH}" ] && echo "PRISMA_SCHEMA_PATH=${PRISMA_SCHEMA_PATH}"
    
    # Logging Configuration
    [ -n "${LOG_LEVEL}" ] && echo "LOG_LEVEL=${LOG_LEVEL}"
    [ -n "${ENABLE_AUDIT_LOGS}" ] && echo "ENABLE_AUDIT_LOGS=${ENABLE_AUDIT_LOGS}"
    
    # Rate Limiting
    [ -n "${RATE_LIMIT_ENABLED}" ] && echo "RATE_LIMIT_ENABLED=${RATE_LIMIT_ENABLED}"
    [ -n "${RATE_LIMIT_TTL}" ] && echo "RATE_LIMIT_TTL=${RATE_LIMIT_TTL}"
    [ -n "${RATE_LIMIT_MAX}" ] && echo "RATE_LIMIT_MAX=${RATE_LIMIT_MAX}"
    [ -n "${API_RATE_LIMIT}" ] && echo "API_RATE_LIMIT=${API_RATE_LIMIT}"
    [ -n "${AUTH_RATE_LIMIT}" ] && echo "AUTH_RATE_LIMIT=${AUTH_RATE_LIMIT}"
    [ -n "${HEAVY_RATE_LIMIT}" ] && echo "HEAVY_RATE_LIMIT=${HEAVY_RATE_LIMIT}"
    [ -n "${USER_RATE_LIMIT}" ] && echo "USER_RATE_LIMIT=${USER_RATE_LIMIT}"
    [ -n "${HEALTH_RATE_LIMIT}" ] && echo "HEALTH_RATE_LIMIT=${HEALTH_RATE_LIMIT}"
    
    # Security Configuration
    [ -n "${SECURITY_RATE_LIMIT}" ] && echo "SECURITY_RATE_LIMIT=${SECURITY_RATE_LIMIT}"
    [ -n "${SECURITY_RATE_LIMIT_MAX}" ] && echo "SECURITY_RATE_LIMIT_MAX=${SECURITY_RATE_LIMIT_MAX}"
    [ -n "${SECURITY_RATE_LIMIT_WINDOW_MS}" ] && echo "SECURITY_RATE_LIMIT_WINDOW_MS=${SECURITY_RATE_LIMIT_WINDOW_MS}"
    [ -n "${TRUST_PROXY}" ] && echo "TRUST_PROXY=${TRUST_PROXY}"
    
    # Email Configuration
    [ -n "${EMAIL_PROVIDER}" ] && echo "EMAIL_PROVIDER=${EMAIL_PROVIDER}"
    [ -n "${ZEPTOMAIL_ENABLED}" ] && echo "ZEPTOMAIL_ENABLED=${ZEPTOMAIL_ENABLED}"
    [ -n "${ZEPTOMAIL_SEND_MAIL_TOKEN}" ] && echo "ZEPTOMAIL_SEND_MAIL_TOKEN=${ZEPTOMAIL_SEND_MAIL_TOKEN}"
    [ -n "${ZEPTOMAIL_FROM_EMAIL}" ] && echo "ZEPTOMAIL_FROM_EMAIL=${ZEPTOMAIL_FROM_EMAIL}"
    [ -n "${ZEPTOMAIL_FROM_NAME}" ] && echo "ZEPTOMAIL_FROM_NAME=${ZEPTOMAIL_FROM_NAME}"
    [ -n "${ZEPTOMAIL_BOUNCE_ADDRESS}" ] && echo "ZEPTOMAIL_BOUNCE_ADDRESS=${ZEPTOMAIL_BOUNCE_ADDRESS}"
    [ -n "${ZEPTOMAIL_API_BASE_URL}" ] && echo "ZEPTOMAIL_API_BASE_URL=${ZEPTOMAIL_API_BASE_URL}"
    
    # CORS Configuration
    [ -n "${CORS_ORIGIN}" ] && echo "CORS_ORIGIN=${CORS_ORIGIN}"
    [ -n "${CORS_CREDENTIALS}" ] && echo "CORS_CREDENTIALS=${CORS_CREDENTIALS}"
    [ -n "${CORS_METHODS}" ] && echo "CORS_METHODS=${CORS_METHODS}"
    
    # Service URLs
    [ -n "${SWAGGER_URL}" ] && echo "SWAGGER_URL=${SWAGGER_URL}"
    [ -n "${BULL_BOARD_URL}" ] && echo "BULL_BOARD_URL=${BULL_BOARD_URL}"
    [ -n "${SOCKET_URL}" ] && echo "SOCKET_URL=${SOCKET_URL}"
    
    # WhatsApp Configuration
    [ -n "${WHATSAPP_ENABLED}" ] && echo "WHATSAPP_ENABLED=${WHATSAPP_ENABLED}"
    [ -n "${WHATSAPP_API_URL}" ] && echo "WHATSAPP_API_URL=${WHATSAPP_API_URL}"
    [ -n "${WHATSAPP_API_KEY}" ] && echo "WHATSAPP_API_KEY=${WHATSAPP_API_KEY}"
    [ -n "${WHATSAPP_PHONE_NUMBER_ID}" ] && echo "WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}"
    [ -n "${WHATSAPP_BUSINESS_ACCOUNT_ID}" ] && echo "WHATSAPP_BUSINESS_ACCOUNT_ID=${WHATSAPP_BUSINESS_ACCOUNT_ID}"
    
    # Video Configuration
    [ -n "${VIDEO_ENABLED}" ] && echo "VIDEO_ENABLED=${VIDEO_ENABLED}"
    [ -n "${VIDEO_PROVIDER}" ] && echo "VIDEO_PROVIDER=${VIDEO_PROVIDER}"
    [ -n "${OPENVIDU_URL}" ] && echo "OPENVIDU_URL=${OPENVIDU_URL}"
    [ -n "${OPENVIDU_SECRET}" ] && echo "OPENVIDU_SECRET=${OPENVIDU_SECRET}"
    [ -n "${OPENVIDU_DOMAIN}" ] && echo "OPENVIDU_DOMAIN=${OPENVIDU_DOMAIN}"
    [ -n "${OPENVIDU_WEBHOOK_ENABLED}" ] && echo "OPENVIDU_WEBHOOK_ENABLED=${OPENVIDU_WEBHOOK_ENABLED}"
    [ -n "${OPENVIDU_WEBHOOK_ENDPOINT}" ] && echo "OPENVIDU_WEBHOOK_ENDPOINT=${OPENVIDU_WEBHOOK_ENDPOINT}"
    [ -n "${OPENVIDU_WEBHOOK_EVENTS}" ] && echo "OPENVIDU_WEBHOOK_EVENTS=${OPENVIDU_WEBHOOK_EVENTS}"
    
    # Google OAuth
    [ -n "${GOOGLE_CLIENT_ID}" ] && echo "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
    [ -n "${GOOGLE_CLIENT_SECRET}" ] && echo "GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"
    [ -n "${GOOGLE_REDIRECT_URI}" ] && echo "GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}"
    
    # Session Configuration
    [ -n "${SESSION_SECRET}" ] && echo "SESSION_SECRET=${SESSION_SECRET}"
    [ -n "${SESSION_TIMEOUT}" ] && echo "SESSION_TIMEOUT=${SESSION_TIMEOUT}"
    [ -n "${SESSION_SECURE_COOKIES}" ] && echo "SESSION_SECURE_COOKIES=${SESSION_SECURE_COOKIES}"
    [ -n "${SESSION_SAME_SITE}" ] && echo "SESSION_SAME_SITE=${SESSION_SAME_SITE}"
    [ -n "${COOKIE_SECRET}" ] && echo "COOKIE_SECRET=${COOKIE_SECRET}"
    
    # Firebase Configuration
    [ -n "${FIREBASE_PROJECT_ID}" ] && echo "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}"
    [ -n "${FIREBASE_PRIVATE_KEY}" ] && echo "FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY}"
    [ -n "${FIREBASE_CLIENT_EMAIL}" ] && echo "FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL}"
    [ -n "${FIREBASE_DATABASE_URL}" ] && echo "FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}"
    [ -n "${FIREBASE_VAPID_KEY}" ] && echo "FIREBASE_VAPID_KEY=${FIREBASE_VAPID_KEY}"
    
    # Social Auth
    [ -n "${FACEBOOK_APP_ID}" ] && echo "FACEBOOK_APP_ID=${FACEBOOK_APP_ID}"
    [ -n "${FACEBOOK_APP_SECRET}" ] && echo "FACEBOOK_APP_SECRET=${FACEBOOK_APP_SECRET}"
    [ -n "${APPLE_CLIENT_ID}" ] && echo "APPLE_CLIENT_ID=${APPLE_CLIENT_ID}"
    [ -n "${APPLE_CLIENT_SECRET}" ] && echo "APPLE_CLIENT_SECRET=${APPLE_CLIENT_SECRET}"
    
    # S3 Storage
    [ -n "${S3_ENABLED}" ] && echo "S3_ENABLED=${S3_ENABLED}"
    [ -n "${S3_PROVIDER}" ] && echo "S3_PROVIDER=${S3_PROVIDER}"
    [ -n "${S3_ENDPOINT}" ] && echo "S3_ENDPOINT=${S3_ENDPOINT}"
    [ -n "${S3_REGION}" ] && echo "S3_REGION=${S3_REGION}"
    [ -n "${S3_BUCKET}" ] && echo "S3_BUCKET=${S3_BUCKET}"
    [ -n "${S3_ACCESS_KEY_ID}" ] && echo "S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}"
    [ -n "${S3_SECRET_ACCESS_KEY}" ] && echo "S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}"
    
    # Docker Configuration
    [ -n "${DOCKER_ENV}" ] && echo "DOCKER_ENV=${DOCKER_ENV}"
    [ -n "${DOCKER_NETWORK}" ] && echo "DOCKER_NETWORK=${DOCKER_NETWORK}"
    } > "${ENV_FILE}"
    
    # Set secure permissions (owner read/write only)
    chmod 600 "${ENV_FILE}"
    echo -e "${GREEN}✅ Created .env.production with secure permissions${NC}"
fi

# Login to GitHub Container Registry
echo -e "${YELLOW}🔐 Logging in to GitHub Container Registry...${NC}"
if [ -n "${GITHUB_TOKEN}" ]; then
    echo "${GITHUB_TOKEN}" | docker login "${REGISTRY:-ghcr.io}" -u "${GITHUB_USERNAME}" --password-stdin
else
    echo -e "${YELLOW}⚠️  GITHUB_TOKEN not set, skipping registry login${NC}"
fi


# Rollback function
# Only rollback if there was a successful deployment (docker-compose exists)
rollback_deployment() {
    echo -e "${RED}🔄 Rolling back deployment...${NC}"
    
    # Only rollback if docker-compose exists (indicates successful deployment)
    if [ ! -f "${COMPOSE_FILE}" ]; then
        echo -e "${YELLOW}⚠️  No successful deployment found (docker-compose missing) - cannot rollback${NC}"
        return 1
    fi
    
    if [ -f "${ROLLBACK_FILE}" ]; then
        PREVIOUS_IMAGE=$(cat "${ROLLBACK_FILE}")
        if [ -n "${PREVIOUS_IMAGE}" ]; then
            echo -e "${YELLOW}Rolling back to previous image: ${PREVIOUS_IMAGE}${NC}"
            export DOCKER_IMAGE="${PREVIOUS_IMAGE}"
            docker compose -f "${COMPOSE_FILE}" up -d --force-recreate || {
                echo -e "${RED}❌ Rollback failed${NC}"
                return 1
            }
            echo -e "${GREEN}✅ Rollback completed${NC}"
            return 0
        fi
    fi
    echo -e "${YELLOW}⚠️  No previous image found for rollback${NC}"
    return 1
}

# Validate image name
if [ -z "${IMAGE_FULL}" ] || [ "${IMAGE_FULL}" = "ghcr.io/your-username/your-repo/healthcare-api" ]; then
    echo -e "${RED}❌ IMAGE environment variable is not set or invalid${NC}"
    echo -e "${YELLOW}Expected format: ghcr.io/owner/repo/healthcare-api${NC}"
    exit 1
fi

# Save current image for rollback
if [ -f "${COMPOSE_FILE}" ]; then
    PREVIOUS_IMAGE_TAG=$(docker compose -f "${COMPOSE_FILE}" config 2>/dev/null | grep -oP 'image:\s*\K[^:]+' | head -1 || echo "")
    if [ -n "${PREVIOUS_IMAGE_TAG}" ]; then
        echo "${PREVIOUS_IMAGE_TAG}" > "${ROLLBACK_FILE}"
        echo -e "${GREEN}💾 Saved previous image for rollback: ${PREVIOUS_IMAGE_TAG}${NC}"
    fi
fi

# Pull latest Docker image
echo -e "${YELLOW}📦 Pulling latest Docker image: ${IMAGE_FULL}:${IMAGE_TAG}${NC}"
if ! docker pull "${IMAGE_FULL}:${IMAGE_TAG}"; then
    echo -e "${YELLOW}⚠️  Failed to pull ${IMAGE_FULL}:${IMAGE_TAG}, trying latest...${NC}"
    if ! docker pull "${IMAGE_FULL}:latest"; then
        echo -e "${RED}❌ Failed to pull Docker image${NC}"
        echo -e "${YELLOW}🔄 Attempting rollback...${NC}"
        rollback_deployment
        exit 1
    fi
    IMAGE_TAG="latest"
fi

# Tag image for docker-compose
echo -e "${YELLOW}🏷️  Tagging image for docker-compose...${NC}"
docker tag "${IMAGE_FULL}:${IMAGE_TAG}" "${IMAGE_FULL}:latest" || true

# Export image name for docker-compose
export DOCKER_IMAGE="${IMAGE_FULL}:latest"

# Stop existing containers gracefully
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
if [ -f "${COMPOSE_FILE}" ]; then
    docker compose -f "${COMPOSE_FILE}" down --timeout 30 || true
else
    echo -e "${YELLOW}⚠️  Compose file not found: ${COMPOSE_FILE}${NC}"
fi

# Pull latest images for all services
echo -e "${YELLOW}📥 Pulling latest images for all services...${NC}"
if [ -f "${COMPOSE_FILE}" ]; then
    docker compose -f "${COMPOSE_FILE}" pull || true
fi

# Trap errors for automatic rollback
trap 'rollback_deployment' ERR

# Start services with new image
echo -e "${YELLOW}🚀 Starting services...${NC}"
if [ -f "${COMPOSE_FILE}" ]; then
    DOCKER_IMAGE="${IMAGE_FULL}:latest" docker compose -f "${COMPOSE_FILE}" up -d || {
        echo -e "${RED}❌ Failed to start services${NC}"
        rollback_deployment
        exit 1
    }
else
    echo -e "${RED}❌ Compose file not found: ${COMPOSE_FILE}${NC}"
    exit 1
fi

# Wait for services to start
echo -e "${YELLOW}⏳ Waiting for services to start...${NC}"
sleep 10

# Check service status
echo -e "${YELLOW}📊 Checking service status...${NC}"
docker compose -f "${COMPOSE_FILE}" ps

# Wait for health checks
echo -e "${YELLOW}🏥 Waiting for health checks...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8088/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ API is healthy!${NC}"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -e "${YELLOW}⏳ Waiting for API to be ready... (${RETRY_COUNT}/${MAX_RETRIES})${NC}"
    sleep 5
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ API health check failed after ${MAX_RETRIES} attempts${NC}"
    echo -e "${YELLOW}📋 Recent API logs:${NC}"
    docker compose -f "${COMPOSE_FILE}" logs --tail=50 api || true
    echo -e "${YELLOW}🔄 Attempting rollback due to health check failure...${NC}"
    rollback_deployment
    exit 1
fi

# Disable error trap on success
trap - ERR

# Save successful deployment
echo "${IMAGE_FULL}:${IMAGE_TAG}" > "${ROLLBACK_FILE}"
echo -e "${GREEN}💾 Saved current image for future rollback${NC}"

# Show final status
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}📊 Service status:${NC}"
docker compose -f "${COMPOSE_FILE}" ps

echo -e "${GREEN}🎉 All done!${NC}"

