#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display usage
show_usage() {
    echo "Usage: ./run.sh [dev|prod] [up|down|logs|restart]"
    echo "  dev    - Run in development mode"
    echo "  prod   - Run in production mode"
    echo "  up     - Start the services"
    echo "  down   - Stop the services"
    echo "  logs   - Show logs"
    echo "  restart- Restart services"
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
        echo "Invalid environment. Use 'dev' or 'prod'"
        show_usage
        ;;
esac

# Check if required files exist
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: $COMPOSE_FILE not found!"
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found!"
    exit 1
fi

# Export environment variables
export $(cat $ENV_FILE | grep -v '^#' | xargs)

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

# Check if Docker is running
check_docker() {
  if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
    exit 1
  fi
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

# Execute docker-compose commands based on action
case $ACTION in
    "up")
        echo "Starting services in $ENV mode..."
        docker-compose -f $COMPOSE_FILE up -d
        ;;
    "down")
        echo "Stopping services..."
        docker-compose -f $COMPOSE_FILE down
        ;;
    "logs")
        echo "Showing logs..."
        docker-compose -f $COMPOSE_FILE logs -f
        ;;
    "restart")
        echo "Restarting services..."
        docker-compose -f $COMPOSE_FILE down
        docker-compose -f $COMPOSE_FILE up -d
        ;;
    *)
        echo "Invalid action"
        show_usage
        ;;
esac

# Show running containers after up or restart
if [ "$ACTION" = "up" ] || [ "$ACTION" = "restart" ]; then
    echo "Running containers:"
    docker-compose -f $COMPOSE_FILE ps
fi
