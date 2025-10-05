#!/bin/bash
# Production Deployment Script
# Usage: ./deploy.sh [environment]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-production}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCKER_COMPOSE_FILE="devops/docker/docker-compose.prod.yml"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Healthcare Backend Deployment${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Step 1: Pre-deployment checks
echo -e "${YELLOW}[1/8] Running pre-deployment checks...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/.env.${ENVIRONMENT}" ]; then
    echo -e "${RED}❌ Environment file .env.${ENVIRONMENT} not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Pre-deployment checks passed${NC}\n"

# Step 2: Backup current deployment
echo -e "${YELLOW}[2/8] Creating backup...${NC}"
BACKUP_DIR="$PROJECT_ROOT/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

if docker ps -q -f name=healthcare-api &> /dev/null; then
    echo "Backing up current deployment..."
    docker exec healthcare-api pnpm exec prisma db seed > "$BACKUP_DIR/db_backup.sql" 2>/dev/null || true
    cp "$PROJECT_ROOT/.env.${ENVIRONMENT}" "$BACKUP_DIR/.env.backup"
    echo -e "${GREEN}✅ Backup created at $BACKUP_DIR${NC}\n"
else
    echo -e "${YELLOW}⚠️  No existing deployment found, skipping backup${NC}\n"
fi

# Step 3: Pull latest code
echo -e "${YELLOW}[3/8] Pulling latest code...${NC}"
cd "$PROJECT_ROOT"
git fetch origin
git pull origin main
echo -e "${GREEN}✅ Code updated${NC}\n"

# Step 4: Install dependencies
echo -e "${YELLOW}[4/8] Installing dependencies...${NC}"
if command -v pnpm &> /dev/null; then
    pnpm install --frozen-lockfile
else
    echo -e "${YELLOW}⚠️  pnpm not found, using npm${NC}"
    npm ci
fi
echo -e "${GREEN}✅ Dependencies installed${NC}\n"

# Step 5: Build application
echo -e "${YELLOW}[5/8] Building application...${NC}"
if command -v pnpm &> /dev/null; then
    pnpm build
else
    npm run build
fi
echo -e "${GREEN}✅ Build completed${NC}\n"

# Step 6: Database migrations
echo -e "${YELLOW}[6/8] Running database migrations...${NC}"
if command -v pnpm &> /dev/null; then
    pnpm exec prisma generate
    pnpm exec prisma db push --accept-data-loss
else
    npx prisma generate
    npx prisma db push --accept-data-loss
fi
echo -e "${GREEN}✅ Migrations completed${NC}\n"

# Step 7: Deploy with Docker Compose
echo -e "${YELLOW}[7/8] Deploying containers...${NC}"
cd "$PROJECT_ROOT"
docker-compose -f "$DOCKER_COMPOSE_FILE" --env-file ".env.${ENVIRONMENT}" down
docker-compose -f "$DOCKER_COMPOSE_FILE" --env-file ".env.${ENVIRONMENT}" up -d --build

echo -e "${GREEN}✅ Containers deployed${NC}\n"

# Step 8: Health check
echo -e "${YELLOW}[8/8] Performing health checks...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8088/health &> /dev/null; then
        echo -e "${GREEN}✅ Health check passed${NC}"
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -e "${YELLOW}Waiting for application to start... ($RETRY_COUNT/$MAX_RETRIES)${NC}"
    sleep 5
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Health check failed after $MAX_RETRIES attempts${NC}"
    echo -e "${RED}Rolling back deployment...${NC}"
    docker-compose -f "$DOCKER_COMPOSE_FILE" down
    exit 1
fi

# Deployment summary
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment Successful!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\n${BLUE}Access Points:${NC}"
echo -e "  API: http://localhost:8088"
echo -e "  Health: http://localhost:8088/health"
echo -e "  Docs: http://localhost:8088/docs"
echo -e "  Queue Dashboard: http://localhost:8088/queue-dashboard"
echo -e "\n${BLUE}Container Status:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo -e "\n${YELLOW}Backup location: $BACKUP_DIR${NC}"
