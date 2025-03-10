#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Stopping Healthcare Backend Docker Environment${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
  exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
  echo -e "${RED}Error: docker-compose is not installed. Please install docker-compose and try again.${NC}"
  exit 1
fi

# Stop the containers
echo -e "${YELLOW}Stopping Docker containers...${NC}"
docker-compose down

# Check if containers are stopped
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Docker containers stopped successfully!${NC}"
else
  echo -e "${RED}Error: Failed to stop Docker containers. Check the logs for more information.${NC}"
  docker-compose logs
  exit 1
fi

# Ask if user wants to remove volumes
read -p "Do you want to remove all data volumes? This will delete all database data. (y/N): " remove_volumes

if [[ $remove_volumes =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Removing Docker volumes...${NC}"
  docker-compose down -v
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Docker volumes removed successfully!${NC}"
  else
    echo -e "${RED}Error: Failed to remove Docker volumes. Check the logs for more information.${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}Docker environment stopped successfully.${NC}" 