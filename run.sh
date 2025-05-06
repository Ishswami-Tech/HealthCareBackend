#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}Error: Docker is not running${NC}"
        echo -e "${YELLOW}Please start Docker Desktop and try again${NC}"
        exit 1
    fi
}

# Run the Docker check
check_docker

# Function to display usage
show_usage() {
    echo "Usage: ./run.sh [dev|prod] [start|stop|logs|restart|rebuild]"
    echo "  dev    - Run in development mode"
    echo "  prod   - Run in production mode"
    echo "  start  - Start the services"
    echo "  stop   - Stop the services"
    echo "  logs   - Show logs"
    echo "  restart- Restart services"
    echo "  rebuild- Rebuild and restart services"
    exit 1
}

# Check if environment argument is provided
if [ "$#" -lt 2 ]; then
    show_usage
fi

ENV=$1
ACTION=$2
COMPOSE_FILE=""
ENV_FILE=""

# Set the appropriate compose and env files based on environment
case $ENV in
    "dev")
        COMPOSE_FILE="docker-compose.dev.yml"
        ENV_FILE=".env.development"
        ;;
    "prod")
        COMPOSE_FILE="docker-compose.prod.yml"
        ENV_FILE=".env.production"
        ;;
    *)
        echo -e "${RED}Invalid environment. Use 'dev' or 'prod'${NC}"
        show_usage
        ;;
esac

# Check if required files exist
if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}Error: $COMPOSE_FILE not found!${NC}"
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: $ENV_FILE not found!${NC}"
    exit 1
fi

# Export environment variables
set -a
source $ENV_FILE
set +a

# Function to display help
show_help() {
  echo -e "${BLUE}Healthcare Backend Run Script${NC}"
  echo "Usage: ./run.sh [environment] [command] [options]"
  echo ""
  echo "Environments:"
  echo "  dev, development   Run in development mode with hot-reloading"
  echo "  prod, production   Run in production mode"
  echo ""
  echo "Commands:"
  echo "  start              Start services"
  echo "  stop               Stop services"
  echo "  restart            Restart services"
  echo "  rebuild            Rebuild and restart services"
  echo "  logs               Show logs"
  echo "  status             Show status of services"
  echo "  backup             Create database backup (dev mode only)"
  echo "  restore            Restore database from backup (dev mode only)"
  echo "  clean              Remove containers and volumes"
  echo "  studio             Start Prisma Studio on port 5555"
  echo ""
  echo "Options:"
  echo "  --volumes          With clean command, also removes volumes"
  echo ""
  echo "Examples:"
  echo "  ./run.sh dev start"
  echo "  ./run.sh prod start"
  echo "  ./run.sh dev logs"
  echo "  ./run.sh dev backup"
  echo "  ./run.sh dev restore backup_file.sql"
  echo "  ./run.sh dev clean --volumes"
  echo "  ./run.sh dev studio"
}

# Check if docker-compose is installed
check_docker_compose() {
  if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: docker-compose is not installed. Please install docker-compose and try again.${NC}"
    exit 1
  fi
}

# Create a backup of the database
create_backup() {
  echo -e "${YELLOW}Creating database backup...${NC}"
  
  mkdir -p backups
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  BACKUP_FILE="backups/backup_${TIMESTAMP}.sql"
  
  docker-compose -f docker-compose.dev.yml exec -T postgres pg_dump -U postgres userdb > "${BACKUP_FILE}"
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup created successfully: ${BACKUP_FILE}${NC}"
  else
    echo -e "${RED}Failed to create backup.${NC}"
    exit 1
  fi
}

# Restore a backup of the database
restore_backup() {
  echo -e "${YELLOW}Available backups:${NC}"
  ls -1 backups/*.sql 2>/dev/null || echo "No backups found."
  
  echo -e "${YELLOW}Enter the backup file to restore (or press Enter to cancel):${NC}"
  read BACKUP_FILE
  
  if [ -z "$BACKUP_FILE" ]; then
    echo -e "${YELLOW}Restore cancelled.${NC}"
    return
  fi
  
  if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Backup file not found: ${BACKUP_FILE}${NC}"
    return
  fi
  
  echo -e "${YELLOW}Restoring backup from ${BACKUP_FILE}...${NC}"
  
  docker-compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d userdb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  cat "${BACKUP_FILE}" | docker-compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d userdb
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup restored successfully.${NC}"
  else
    echo -e "${RED}Failed to restore backup.${NC}"
    exit 1
  fi
}

# Create a production backup before switching to production
create_production_backup() {
  echo -e "${YELLOW}Creating backup before switching to production...${NC}"
  create_backup
  echo -e "${GREEN}Backup created successfully. Proceeding to production mode.${NC}"
}

# Add a function to start Prisma Studio
start_prisma_studio() {
  if [[ "$ENV" == "production" ]]; then
    echo -e "${RED}Prisma Studio is disabled in production mode.${NC}"
    exit 1
  else
    echo -e "${YELLOW}Starting Prisma Studio on port 5555...${NC}"
    docker-compose -f docker-compose.dev.yml exec -d api npx prisma studio --schema=src/shared/database/prisma/schema.prisma --port 5555 --hostname 0.0.0.0
    echo -e "${GREEN}Prisma Studio started! Access it at http://localhost:5555${NC}"
    echo -e "${YELLOW}Press Ctrl+C if this command doesn't return to the prompt automatically.${NC}"
  fi
}

# Execute docker compose commands based on action
case $ACTION in
    "up"|"start")
        echo -e "${YELLOW}Starting services in $ENV mode...${NC}"
        docker compose -f $COMPOSE_FILE up -d
        echo -e "${GREEN}Services started successfully!${NC}"
        ;;
    "down"|"stop")
        echo -e "${YELLOW}Stopping services...${NC}"
        docker compose -f $COMPOSE_FILE down
        echo -e "${GREEN}Services stopped successfully!${NC}"
        ;;
    "logs")
        echo -e "${YELLOW}Showing logs...${NC}"
        docker compose -f $COMPOSE_FILE logs -f
        ;;
    "restart")
        echo -e "${YELLOW}Restarting services...${NC}"
        docker compose -f $COMPOSE_FILE down
        docker compose -f $COMPOSE_FILE up -d
        echo -e "${GREEN}Services restarted successfully!${NC}"
        ;;
    "rebuild")
        echo -e "${YELLOW}Rebuilding services in $ENV mode...${NC}"
        docker compose -f $COMPOSE_FILE down
        docker compose -f $COMPOSE_FILE build --no-cache
        docker compose -f $COMPOSE_FILE up -d
        echo -e "${GREEN}Services rebuilt and started successfully!${NC}"
        ;;
    *)
        echo -e "${RED}Invalid action${NC}"
        show_usage
        ;;
esac

# Show running containers after start, restart, or rebuild
if [ "$ACTION" = "up" ] || [ "$ACTION" = "start" ] || [ "$ACTION" = "restart" ] || [ "$ACTION" = "rebuild" ]; then
    echo -e "\n${BLUE}Running containers:${NC}"
    docker compose -f $COMPOSE_FILE ps
fi
