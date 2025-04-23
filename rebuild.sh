#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Rebuilding and restarting Healthcare Backend in DEVELOPMENT mode...${NC}"

# Stop and remove existing containers
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f docker-compose.dev.yml down

# Rebuild the containers
echo -e "${YELLOW}Rebuilding containers...${NC}"
docker-compose -f docker-compose.dev.yml build

# Start the containers
echo -e "${YELLOW}Starting containers...${NC}"
docker-compose -f docker-compose.dev.yml up -d

# Show logs
echo -e "${GREEN}Rebuild completed! Showing logs...${NC}"
docker-compose -f docker-compose.dev.yml logs -f api 