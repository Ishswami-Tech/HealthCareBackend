#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Healthcare Backend Docker Environment${NC}"

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

# Check if .env file exists
if [ ! -f .env ]; then
  echo -e "${YELLOW}Warning: .env file not found. Creating a default one...${NC}"
  cat > .env << EOL
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb?schema=public
POSTGRES_PASSWORD=postgres
NODE_ENV=development
APP_ENV=development
IS_DEV=true
RESET_DB=false
EOL
  echo -e "${GREEN}Created default .env file.${NC}"
fi

# Build and start the containers
echo -e "${GREEN}Building and starting Docker containers...${NC}"
docker-compose up -d --build

# Check if containers are running
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Docker containers started successfully!${NC}"
  echo -e "${GREEN}API is running at: http://localhost:8088${NC}"
  echo -e "${GREEN}Prisma Studio is running at: http://localhost:5555${NC}"
  echo -e "${GREEN}PgAdmin is running at: http://localhost:5050${NC}"
  echo -e "${GREEN}Redis Commander is running at: http://localhost:8082${NC}"
else
  echo -e "${RED}Error: Failed to start Docker containers. Check the logs for more information.${NC}"
  docker-compose logs
  exit 1
fi

# Show logs
echo -e "${YELLOW}Showing logs from the API container. Press Ctrl+C to exit logs (containers will keep running).${NC}"
docker-compose logs -f api 